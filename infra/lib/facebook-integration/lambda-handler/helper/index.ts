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
import aws from 'aws-sdk';
import crypto from 'crypto';

const secretsManager = new aws.SecretsManager();

const getSecret = async (secretId: string) => {
  const result = await secretsManager
    .getSecretValue({
      SecretId: secretId,
    })
    .promise();

  if (result.SecretString) {
    return result.SecretString;
  }

  const buff = Buffer.from(result.SecretBinary as string, 'base64');

  return buff.toString('ascii');
};

const getFacebookSecret = async () => {
  const secret = await getSecret(process.env.FACEBOOK_SECRET!);

  return JSON.parse(secret);
};

const sha256 = (input: string) => {
  return crypto.createHash('sha256').update(input).digest('hex');
};

const getRandomInteger = (min: number, max: number): number => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

export default {
  getFacebookSecret,
  getRandomInteger,
  getSecret,
  sha256,
};
