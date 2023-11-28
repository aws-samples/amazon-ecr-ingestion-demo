import boto3
import os
import logging
import shutil
import subprocess
import sys
from aws_xray_sdk.core import xray_recorder
from aws_xray_sdk.core import patch_all
logging.basicConfig(stream=sys.stdout, level=logging.DEBUG)

ACCOUNT_ID = os.environ['EX_ACCOUNT_ID']
ECR_PUBLIC_IMAGES_TO_PULL = os.environ['EX_PUBLIC_IMAGES']
PTC_NAMESPACE = os.environ['EX_NAMESPACE']
REGION_NAME = os.environ['EX_REGION']
PROD_NAMESPACE = os.environ['EX_PROD_NAMESPACE']
ECR_SIGNING_PROFILE = os.environ['EX_SIGNER_PROFILE']

UNACCEPTABLE_FINDING_SEVERITY = ('HIGH', 'CRITICAL')
FINISHED_FINDING_STATUS = ('ACTIVE', 'COMPLETE')

logger = logging.getLogger()
logger.setLevel(logging.INFO)
patch_all()
current_env = os.environ.copy()
current_env['HOME'] = '/tmp'
#weird hack needed because notation needs the plugin to exist
# in the same writable directory it caches in
try:
  shutil.copytree('/root/.config/notation','/tmp/.config/notation')
except FileExistsError:
  logging.info("not copying root/")

client = boto3.client('ecr', region_name=REGION_NAME)

def lambda_handler(event, context):
  # sign in 
  login_command = f"aws ecr get-login-password --region {REGION_NAME} | oras login --password-stdin --username AWS \"{ACCOUNT_ID}.dkr.ecr.{REGION_NAME}.amazonaws.com\""

  for image in ECR_PUBLIC_IMAGES_TO_PULL.split(','):
    image_uri,image_tag = image.strip().split(':')

    #check for vulnerabilities, and only move forward if the image and referrers has no HIGH vulnerabilities.
    # for the reader: fill this in with whatever governance/internal policy you want to enforce. PR review rules, approvals, other code scanning solutions...whatever you want!
    logger.info(f'analyzing findings for "{PTC_NAMESPACE}/{image_uri}:{image_tag}')
    findings_response = client.describe_image_scan_findings(repositoryName=f'{PTC_NAMESPACE}/{image_uri}', imageId={'imageTag':image_tag})
    try:
      if findings_response['imageScanStatus']['status'] == 'UNSUPPORTED_IMAGE':
        #TODO: we can extend this to find all referrers of an image index/manifest list and search scan findings for them as well. I wonder if ECR is planning for a new API for this :) 
        logging.warning("Unsupport image for scanning, letting this promote to prod")
      elif findings_response['imageScanStatus']['status'] in FINISHED_FINDING_STATUS:
        if 'enhancedFindings' not in findings_response['imageScanFindings']:
          logger.info('no HIGH/MEDIUM findings found')
        else:
          failed_vulns = False
          for finding in findings_response['imageScanFindings']['enhancedFindings']:
            if finding['severity'] in UNACCEPTABLE_FINDING_SEVERITY:
              logger.error(f"Too high of a finding severity found for this image, will not sign or promote. here's the finding: {finding}")
              failed_vulns = True
              break
          if failed_vulns:
            continue
      else:
        logger.error(f"Image scan issue, delayed or potentially failed, scan state is {findings_response['imageScanStatus']['status']}")
        continue
    except Exception as e:
      logger.error("cant analyze image, skipping, error below")
      logger.error(e)
      continue
    logger.info("Image passed vulnerability verification!")

    #create prod repo if it does not exist
    logger.info(f'Creating prod repo for {PROD_NAMESPACE}/{PTC_NAMESPACE}/{image_uri}')
    try:
      client.create_repository(repositoryName=f'{PROD_NAMESPACE}/{PTC_NAMESPACE}/{image_uri}')
    except client.exceptions.RepositoryAlreadyExistsException:
      logger.info("prod repo already exists, continuing")

    # "promote" a PTC repository to a prod repository in a separate namespace
    logger.info(f'copy "{PTC_NAMESPACE}/{image_uri}:{image_tag}" to {PROD_NAMESPACE}/{PTC_NAMESPACE}/{image_uri}:{image_tag}...')
    oras_command = f"oras cp -r {ACCOUNT_ID}.dkr.ecr.{REGION_NAME}.amazonaws.com/{PTC_NAMESPACE}/{image_uri}:{image_tag} {ACCOUNT_ID}.dkr.ecr.{REGION_NAME}.amazonaws.com/{PROD_NAMESPACE}/{PTC_NAMESPACE}/{image_uri}:{image_tag}"

    result = subprocess.run(f'{login_command}; {oras_command}', shell=True,capture_output=True, text=True, env=current_env )
    logger.info(result)
    if result.returncode != 0:
      raise ValueError("Could not copy image")
    
    # sign!
    logger.info(f'signing "{PTC_NAMESPACE}/{image_uri}:{image_tag}"...')
    notation_command = f"notation sign {ACCOUNT_ID}.dkr.ecr.{REGION_NAME}.amazonaws.com/{PROD_NAMESPACE}/{PTC_NAMESPACE}/{image_uri}:{image_tag} --plugin \"com.amazonaws.signer.notation.plugin\" --id \"arn:aws:signer:{REGION_NAME}:{ACCOUNT_ID}:/signing-profiles/{ECR_SIGNING_PROFILE}\" --plugin-config aws-region={REGION_NAME}"

    result = subprocess.run(f'{login_command}; {notation_command}', shell=True,capture_output=True, text=True, env=current_env )
    logger.info(result)
    if result.returncode != 0:
      raise ValueError("Could not sign image")
