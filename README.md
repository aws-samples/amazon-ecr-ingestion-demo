Before running the CDK stack, you must build the PullerLambda layer zip file as well as enable Enhanced Scanning in ECR. See below for instructions.

**Building puller-lambda zip**
1. Install python 3.11, pip and pipenv.
1. Within the `puller-lambda` directory, run `pipenv install` and then `pipenv shell`.
1. You can then locate the `site-packages` directory of the virtualenv created by pipenv by running `pip show boto3`. You should see a path to the site-packages directory in the output.
1. This directory needs to be added to the lambda zip by running `zip -r <repo directory>/puller-lambda/build/puller-lambda-deployment.zip <directory ending with 'site-packages'>`
1. Then finally add the python code to the same lambda zip by running `zip <repo directory>/puller-lambda/build/puller-lambda-deployment.zip <repo directory>/puller-lambda/lambda_function.py`

**Enabling Enhanced Scanning**
Enhanced Scanning as of 11/26 does not support CDK. Follow [ECR documentation](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-scanning-enhanced.html#image-scanning-enhanced-enabling) to enable Enhanced Scanning (Continuous).
