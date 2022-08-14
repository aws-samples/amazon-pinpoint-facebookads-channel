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
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Arn, Duration, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';

export interface PinpointIntegrationProps {
  queue: sqs.Queue;
  sqsKey: kms.Key;
}

export class PinpointIntegration extends Construct {
  public readonly lambdaHandler: NodejsFunction;

  constructor(scope: Construct, id: string, props: PinpointIntegrationProps) {
    super(scope, id);

    const stack = Stack.of(this);

    const { queue, sqsKey } = props;

    this.lambdaHandler = new NodejsFunction(this, 'Consumer', {
      functionName: 'pinpoint-facebook-integration',
      architecture: lambda.Architecture.ARM_64,
      runtime: lambda.Runtime.NODEJS_16_X,
      timeout: Duration.seconds(15),
      memorySize: 1024,
      entry: require.resolve('./lambda-handler'),
      handler: 'handler',
      description:
        'Lambda function used by Pinpoint as custom channel to create campaign on Facebook',
      environment: {
        SQS_QUEUE_URL: queue.queueUrl,
      },
      initialPolicy: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['sqs:SendMessage'],
          resources: [queue.queueArn],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['kms:GenerateDataKey', 'kms:Decrypt'],
          resources: [sqsKey.keyArn],
        }),
      ],
    });
    this.lambdaHandler.addPermission('pinpoint', {
      principal: new iam.ServicePrincipal(
        `pinpoint.${stack.region}.amazonaws.com`,
      ),
      action: 'lambda:InvokeFunction',
      sourceAccount: stack.account,
      sourceArn: Arn.format(
        {
          service: 'mobiletargeting',
          resource: 'apps',
          resourceName: '*',
        },
        stack,
      ),
    });
  }
}
