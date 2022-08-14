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
import { Construct } from 'constructs';
import {
  FacebookIntegration,
  FacebookIntegrationConfig,
} from './facebook-integration';
import { PinpointIntegration } from './pinpoint-integration';
import { Stack, StackProps } from 'aws-cdk-lib';

export interface InfraStackConfig {
  application: string;
  stage: string;
  facebook: FacebookIntegrationConfig;
}

export interface InfraStackProps extends StackProps {
  config: InfraStackConfig;
}

export class InfraStack extends Stack {
  constructor(scope: Construct, id: string, props: InfraStackProps) {
    super(scope, id, props);

    const { config } = props;

    const fbIntegration = new FacebookIntegration(this, 'FacebookIntegration', {
      config: config.facebook,
    });

    new PinpointIntegration(this, 'PinpointIntegration', {
      queue: fbIntegration.queue,
      sqsKey: fbIntegration.sqsKey,
    });
  }
}
