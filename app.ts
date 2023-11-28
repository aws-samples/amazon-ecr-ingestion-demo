import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { aws_ecr as ecr } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as signer from 'aws-cdk-lib/aws-signer';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as path from "path";

export class MyStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const cfnPullThroughCacheRule = new ecr.CfnPullThroughCacheRule(this, 'ecr-public', {
          ecrRepositoryPrefix: app.node.tryGetContext('ptc_namespace'),
          upstreamRegistryUrl: 'public.ecr.aws',
        });

        const SignerPolicy = new iam.Policy(this, 'signer', {
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["signer:*"],
              resources: ["*"],
            })
          ]
        });

        const LambdaRole = new iam.Role(this, 'LambdaRole', {
          assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
          roleName: "LambdaRole",
          maxSessionDuration: cdk.Duration.seconds(3600),
          managedPolicies: [
            iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2ContainerRegistryFullAccess"),
            iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonElasticContainerRegistryPublicFullAccess"),
            iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchFullAccessV2"),
            iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonInspector2FullAccess")
          ],
          description: ""
          
      });
      LambdaRole.attachInlinePolicy(SignerPolicy);
      LambdaRole.grantAssumeRole(new iam.ServicePrincipal("lambda.amazonaws.com"));
      LambdaRole.grantAssumeRole(new iam.AccountPrincipal(app.node.tryGetContext('account_id')));

      const PullerLambda = new lambda.Function(this, 'PullerLambda', {
          description: "",
          environment: {
            'EX_ACCOUNT_ID': app.node.tryGetContext('account_id'),
            'EX_PROD_NAMESPACE': app.node.tryGetContext('prod_namespace'),
            'EX_SIGNER_PROFILE': app.node.tryGetContext('signing_profile'),
            'EX_NAMESPACE': app.node.tryGetContext('ptc_namespace'),
            'EX_REGION': app.node.tryGetContext('region'),
            'EX_PUBLIC_IMAGES': app.node.tryGetContext('public_images')
              
          },
          functionName: "PullerLambda",
          handler: "lambda_function.lambda_handler",
          architecture: lambda.Architecture.X86_64,
          code: lambda.Code.fromAsset(path.join(__dirname,'/puller-lambda/build/puller-lambda-deployment.zip')),
          memorySize: 512,
          role: LambdaRole,
          runtime: new lambda.Runtime("python3.11"),
          timeout: cdk.Duration.seconds(720),
          ephemeralStorageSize: cdk.Size.mebibytes(512)
      });

      const SignerLambda = new lambda.DockerImageFunction(this, 'SignerLambda', {
          description: "",
          environment: {
              'EX_ACCOUNT_ID': app.node.tryGetContext('account_id'),
              'EX_PROD_NAMESPACE': app.node.tryGetContext('prod_namespace'),
              'EX_SIGNER_PROFILE': app.node.tryGetContext('signing_profile'),
              'EX_NAMESPACE': app.node.tryGetContext('ptc_namespace'),
              'EX_REGION': app.node.tryGetContext('region'),
              'EX_PUBLIC_IMAGES': app.node.tryGetContext('public_images')
              
          },
          functionName: "SignerLambda",
          architecture: lambda.Architecture.X86_64,
          code: lambda.DockerImageCode.fromImageAsset("signer-lambda"),
          memorySize: 2048,
          role: LambdaRole,
          timeout: cdk.Duration.seconds(720),
          ephemeralStorageSize: cdk.Size.mebibytes(4096)
      });

      

      const StepFunctionRole = new iam.Role(this, 'IAMRole2', {
          path: "/service-role/",
          assumedBy: new iam.ServicePrincipal("states.amazonaws.com"),
          roleName: "StepFunctions-Image-Signer-role",
          maxSessionDuration: cdk.Duration.seconds(3600),
          managedPolicies: [
            iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchFullAccessV2"),
            iam.ManagedPolicy.fromAwsManagedPolicyName("AWSLambda_FullAccess"),
            iam.ManagedPolicy.fromAwsManagedPolicyName("AWSXrayFullAccess")
          ]
      });
      StepFunctionRole.grantAssumeRole(new iam.ServicePrincipal("states.amazonaws.com"));

      const SignerSigningProfile = new signer.CfnSigningProfile(this, app.node.tryGetContext('signing_profile'), {
        platformId: "Notation-OCI-SHA384-ECDSA",
          signatureValidityPeriod: {
              type: "MONTHS",
              value: 135
          }
      });

      const LogsLogGroup = new logs.CfnLogGroup(this, 'LogsLogGroup', {
        logGroupName: "/aws/vendedlogs/states/Image-Signer-Logs"
    });

      const StepFunctionsStateMachine = new stepfunctions.CfnStateMachine(this, 'StepFunctionsStateMachine', {
          stateMachineName: "Image-Signer",
          definitionString: `
            {
              "Comment": "A description of my state machine",
              "StartAt": "Invoke PullerLambda",
              "States": {
                "Invoke PullerLambda": {
                  "Type": "Task",
                  "Resource": "arn:aws:states:::lambda:invoke",
                  "OutputPath": "$.Payload",
                  "Parameters": {
                    "FunctionName": "arn:aws:lambda:us-east-1:${app.node.tryGetContext('account_id')}:function:PullerLambda:$LATEST"
                  },
                  "Retry": [
                    {
                      "ErrorEquals": [
                        "Lambda.ServiceException",
                        "Lambda.AWSLambdaException",
                        "Lambda.SdkClientException",
                        "Lambda.TooManyRequestsException"
                      ],
                      "IntervalSeconds": 1,
                      "MaxAttempts": 3,
                      "BackoffRate": 2
                    }
                  ],
                  "Next": "Wait"
                },
                "Wait": {
                  "Type": "Wait",
                  "Seconds": 720,
                  "Next": "Invoke SignerLambda"
                },
                "Invoke SignerLambda": {
                  "Type": "Task",
                  "Resource": "arn:aws:states:::lambda:invoke",
                  "OutputPath": "$.Payload",
                  "Parameters": {
                    "FunctionName": "arn:aws:lambda:us-east-1:${app.node.tryGetContext('account_id')}:function:SignerLambda:$LATEST"
                  },
                  "Retry": [
                    {
                      "ErrorEquals": [
                        "Lambda.ServiceException",
                        "Lambda.AWSLambdaException",
                        "Lambda.SdkClientException",
                        "Lambda.TooManyRequestsException"
                      ],
                      "IntervalSeconds": 1,
                      "MaxAttempts": 3,
                      "BackoffRate": 2
                    }
                  ],
                  "End": true
                }
              }
            }
            `,
          roleArn: `arn:aws:iam::${app.node.tryGetContext('account_id')}:role/service-role/StepFunctions-Image-Signer-role`,
          stateMachineType: "STANDARD",
          loggingConfiguration: {
              destinations: [
                  {
                      cloudWatchLogsLogGroup: {
                          logGroupArn: `arn:aws:logs:us-east-1:${app.node.tryGetContext('account_id')}:log-group:/aws/vendedlogs/states/Image-Signer-Logs:*`
                      }
                  }
              ],
              includeExecutionData: true,
              level: "ALL"
          }

      });



      const SchedulerSchedule = new scheduler.CfnSchedule(this, 'SchedulerSchedule', {
        name: "Schedule-Image-Signer",
        description: "Runs our Image Signer periodically to pull images, look at findings, and then push them.",
        state: "ENABLED",
        groupName: "default",
        scheduleExpression: "cron(0 9 * * *)",
        scheduleExpressionTimezone: "America/Los_Angeles",
        flexibleTimeWindow: {
            mode: "OFF"
        },
        target: {
            arn: `arn:aws:states:us-east-1:${app.node.tryGetContext('account_id')}:stateMachine:Image-Signer`,
            input: "{}",
            retryPolicy: {
                maximumEventAgeInSeconds: 86400,
                maximumRetryAttempts: 185
            },
            roleArn: `arn:aws:iam::${app.node.tryGetContext('account_id')}:role/service-role/Image_Scheduler`
        }
      });
    }
}

const app = new cdk.App();
new MyStack(app, 'Image-Puller-Stack', { env: { region: 'us-east-1' } });
app.synth();
