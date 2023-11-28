FROM public.ecr.aws/lambda/python:3.11

RUN yum -y install awscli tar gzip curl unzip util-linux-ng sudo

RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
RUN unzip awscliv2.zip
RUN ./aws/install

RUN curl -LO "https://github.com/oras-project/oras/releases/download/v1.1.0/oras_1.1.0_linux_amd64.tar.gz"
RUN mkdir -p oras-install/
RUN tar -zxf oras_1.1.0_*.tar.gz -C oras-install/
RUN mv oras-install/oras /usr/local/bin/
RUN rm -rf oras_1.1.0_*.tar.gz oras-install/

RUN curl -LO https://github.com/notaryproject/notation/releases/download/v1.0.1/notation_1.0.1_linux_amd64.tar.gz
RUN tar xvzf notation_1.0.1_linux_amd64.tar.gz -C /usr/bin/ notation

RUN curl -LO https://d2hvyiie56hcat.cloudfront.net/linux/amd64/installer/rpm/latest/aws-signer-notation-cli_amd64.rpm
RUN yum install -y aws-signer-notation-cli_amd64.rpm

# Copy requirements.txt
COPY requirements.txt ${LAMBDA_TASK_ROOT}

# Install the specified packages
RUN pip install -r requirements.txt
RUN chmod -R 757 /root

# Copy function code
COPY lambda_function.py ${LAMBDA_TASK_ROOT}

# Set the CMD to your handler (could also be done as a parameter override outside of the Dockerfile)
CMD [ "lambda_function.lambda_handler" ]