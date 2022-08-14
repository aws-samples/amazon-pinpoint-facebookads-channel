/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this
 * software and associated documentation files (the "Software"), to deal in the Software
 * without restriction, including without limitation the rights to use, copy, modify,
 * merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
import * as ddb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEvents from 'aws-cdk-lib/aws-lambda-event-sources';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Arn, Duration, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';

export interface FacebookIntegrationConfig {
  accessToken: string;
  adAccountId: string;
  pageId: string;
  defaultWebsiteUrl: string;
}

export interface FacebookCustomChannelProps {
  config: FacebookIntegrationConfig;
}

export class FacebookIntegration extends Construct {
  public readonly lambdaHandler: NodejsFunction;

  public readonly queue: sqs.Queue;

  public readonly deadLetter: sqs.Queue;

  public readonly sqsKey: kms.Key;

  constructor(scope: Construct, id: string, props: FacebookCustomChannelProps) {
    super(scope, id);

    const stack = Stack.of(this);
    const { config } = props;

    const secret = new secretsmanager.Secret(this, 'FacebookSecrets', {
      secretName: '/pinpoint/customChannels/facebook',
      description: 'Facebook API Key and ads configuration values',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          accessToken: config.accessToken,
          adAccountId: config.adAccountId,
          pageId: config.pageId,
          defaultWebsiteUrl: config.defaultWebsiteUrl,
        }),
        // generate a dummy pwd just to be able to use the secretStringTemplate
        generateStringKey: 'dummy',
      },
    });
    // used to link pinpoint objects with Facebook campaigns IDs etc
    const dataLinkTable = new ddb.Table(this, 'DataLinkTable', {
      partitionKey: {
        name: 'applicationId',
        type: ddb.AttributeType.STRING,
      },
      sortKey: {
        name: 'campaignId',
        type: ddb.AttributeType.STRING,
      },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      encryption: ddb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
    });

    this.sqsKey = new kms.Key(this, 'Key', {
      alias: 'custom/fb-sqs-key',
      enableKeyRotation: true,
    });

    this.deadLetter = new sqs.Queue(this, 'DeadLetterQueue', {
      queueName: 'fb-int-dlq.fifo',
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: this.sqsKey,
      // max duration to reduce KMS cost
      dataKeyReuse: Duration.hours(24),
      fifo: true,
      contentBasedDeduplication: true,
    });

    this.queue = new sqs.Queue(this, 'Queue', {
      queueName: 'fb-int-queue.fifo',
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: this.sqsKey,
      // max duration to reduce KMS cost
      dataKeyReuse: Duration.hours(24),
      deadLetterQueue: {
        queue: this.deadLetter,
        maxReceiveCount: 1,
      },
      visibilityTimeout: Duration.seconds(90),
      // guarantee only one delivery
      fifo: true,
      contentBasedDeduplication: true,
    });

    const baseStatement = {
      principals: [new iam.AnyPrincipal()],
      actions: ['sqs:*'],
      effect: iam.Effect.DENY,
      conditions: {
        Bool: {
          'aws:SecureTransport': false,
        },
      },
    };

    new sqs.CfnQueuePolicy(this, 'SQSPolicy', {
      policyDocument: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            ...baseStatement,
            resources: [this.queue.queueArn],
          }),
        ],
      }),
      queues: [this.queue.queueUrl],
    });

    new sqs.CfnQueuePolicy(this, 'SQSDeadPolicy', {
      policyDocument: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            ...baseStatement,
            resources: [this.deadLetter.queueArn],
          }),
        ],
      }),
      queues: [this.deadLetter.queueUrl],
    });

    const fn = new NodejsFunction(this, 'FacebookLambda', {
      architecture: lambda.Architecture.ARM_64,
      runtime: lambda.Runtime.NODEJS_16_X,
      timeout: Duration.seconds(60),
      memorySize: 1024,
      entry: require.resolve('./lambda-handler'),
      handler: 'handler',
      description: 'Lambda function used to handle communication with Facebook',
      environment: {
        FACEBOOK_SECRET: secret.secretName,
        DATA_LINK_TABLE_NAME: dataLinkTable.tableName,
      },
      initialPolicy: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['secretsmanager:GetSecretValue'],
          resources: [secret.secretArn],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'dynamodb:PutItem',
            'dynamodb:GetItem',
            'dynamodb:UpdateItem',
          ],
          resources: [dataLinkTable.tableArn],
        }),
        new iam.PolicyStatement({
          actions: [
            'mobiletargeting:GetCampaign',
            'mobiletargeting:GetApp',
            'mobiletargeting:PutEvents',
          ],
          resources: [
            Arn.format(
              {
                service: 'mobiletargeting',
                resource: 'apps',
                resourceName: '*',
              },
              stack,
            ),
          ],
        }),
      ],
    });

    fn.addEventSource(
      new lambdaEvents.SqsEventSource(this.queue, {
        batchSize: 1,
      }),
    );

    this.addSuppressions();
  }

  private addSuppressions(): void {
    NagSuppressions.addResourceSuppressionsByPath(
      Stack.of(this),
      '/InfraStack/FacebookIntegration/FacebookSecrets/Resource',
      [
        {
          id: 'AwsSolutions-SMG4',
          reason:
            'Secret rotation is a consideration for the path to production',
        },
      ],
    );

    NagSuppressions.addResourceSuppressionsByPath(
      Stack.of(this),
      '/InfraStack/FacebookIntegration/DeadLetterQueue/Resource',
      [
        {
          id: 'AwsSolutions-SQS3',
          reason: 'Deadletter queue cannot have a dead letter queue',
        },
      ],
    );

    NagSuppressions.addResourceSuppressionsByPath(
      Stack.of(this),
      '/InfraStack/FacebookIntegration/FacebookLambda/ServiceRole/DefaultPolicy/Resource',
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'The wildcard is needed in order to target all Pinpoint apps',
        },
      ],
    );
  }
}
