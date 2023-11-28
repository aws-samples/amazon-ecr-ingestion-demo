import os
import logging
import boto3
import sys
from aws_xray_sdk.core import xray_recorder
from aws_xray_sdk.core import patch_all
logging.basicConfig(stream=sys.stdout, level=logging.DEBUG)

ECR_PUBLIC_IMAGES_TO_PULL = os.environ['EX_PUBLIC_IMAGES']
PTC_NAMESPACE = os.environ['EX_NAMESPACE']
REGION_NAME = os.environ['EX_REGION']

logger = logging.getLogger()
logger.setLevel(logging.INFO)
patch_all()

client = boto3.client('ecr', region_name=REGION_NAME)

def lambda_handler(event, context):
  logger.info('Starting image pull from PTC repositories')
  for image in ECR_PUBLIC_IMAGES_TO_PULL.split(','):
    image_uri,image_tag = image.strip().split(':')
    logger.info(f'pulling "{PTC_NAMESPACE}/{image_uri}:{image_tag}"...')
    client.batch_get_image(
      repositoryName=f'{PTC_NAMESPACE}/{image_uri}',
      imageIds=[{'imageTag':image_tag}]
    )
  return True
