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

const sqs = new aws.SQS();

const SQS_MAX_MESSAGE_SIZE = 262144;

// SQS message size limit would be 256k
// Pinpoint endpoints can be as big as 15k
// Each pinpoint message can include up to 50 endpoints
// in order to avoid reach SQS message limit, this small function
// would split the endpoints in half until is lower than the SQS limit
const splitMessage = (event: any): any[] => {
  if (Buffer.byteLength(JSON.stringify(event)) > SQS_MAX_MESSAGE_SIZE) {
    const endpointsIdA = Object.keys(event.Endpoints);
    const endpointsIdB = endpointsIdA.splice(
      0,
      Math.floor(endpointsIdA.length / 2),
    );

    return splitMessage({
      ...event,
      Endpoints: endpointsIdA.reduce(
        (acc, curr) => ({
          ...acc,
          [curr]: event.Endpoints[curr],
        }),
        {},
      ),
    }).concat(
      splitMessage({
        ...event,
        Endpoints: endpointsIdB.reduce(
          (acc, curr) => ({
            ...acc,
            [curr]: event.Endpoints[curr],
          }),
          {},
        ),
      }),
    );
  }

  return [event];
};

export const handler = async (event: any) => {
  console.log('Processing pinpoint endpoints and send it to a queue');
  const { ApplicationId, CampaignId } = event;

  try {
    const messages = splitMessage(event);
    const promises = messages.map((m) => {
      const message = JSON.stringify(m);

      return sqs
        .sendMessage({
          MessageBody: message,
          QueueUrl: process.env.SQS_QUEUE_URL!,
          MessageGroupId: `${ApplicationId}-${CampaignId}`,
          MessageDeduplicationId: crypto
            .createHash('sha256')
            .update(message)
            .digest('hex'),
        })
        .promise();
    });

    await Promise.all(promises);

    console.log('Message sent to SQS successfully');
  } catch (err) {
    console.error('Error sending the message to SQS: ', err);

    throw err;
  }
};
