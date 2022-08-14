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
import DataLinkTable from './ddb/DataLinkTable';
import FacebookActions from './facebook-actions';
import aws from 'aws-sdk';
import helper from './helper';

const pinpoint = new aws.Pinpoint();

let campaign: aws.Pinpoint.GetCampaignResponse;
const getPrefix = async (applicationId: string, campaignId: string) => {
  const app = await pinpoint.getApp({ ApplicationId: applicationId }).promise();
  campaign = await pinpoint
    .getCampaign({ ApplicationId: applicationId, CampaignId: campaignId })
    .promise();

  return `Pinpoint[${app.ApplicationResponse.Name}][${campaign.CampaignResponse.Name}]:`;
};

export const handler = async (event: any) => {
  console.log('Processing SQS data to create FB objects/audience');

  if (!event.Records || event.Records.length > 1) {
    const message =
      '[Critical]: this handler can only process one message at a time. Reconfigure the queue!';
    console.error(message);

    throw new Error(message);
  }
  const { ApplicationId, CampaignId, Endpoints } = JSON.parse(
    event.Records[0].body,
  );
  const facebookAttributesList: string[][] = [];
  const facebookAttributes: string[] = ['EMAIL_SHA256'];

  Object.keys(Endpoints).forEach((endpointId) => {
    const endpoint = Endpoints[endpointId];

    if (endpoint.ChannelType !== 'EMAIL') {
      // skip this endpoint as we are creating custom audiences only based on the EMAIL address
      return;
    }

    const eFbAttributes = [helper.sha256(endpoint.Address)];

    /// NOTE: all endpoints MUST have the same list of fields, if one endpoint doens't have one of the attributes
    /// facebook will reject the schema.
    /// this block is just trying to make sure that if the attribute exists then is used
    /// as only email is actually required to import the audience
    if (
      endpoint.User.UserAttributes &&
      endpoint.User.UserAttributes.Phone &&
      endpoint.User.UserAttributes.Phone.length > 0
    ) {
      eFbAttributes.push(helper.sha256(endpoint.User.UserAttributes.Phone[0]));

      if (!facebookAttributes.includes('PHONE_SHA256')) {
        facebookAttributes.push('PHONE_SHA256');
      }
    }

    if (
      endpoint.User.UserAttributes &&
      endpoint.User.UserAttributes.Mobile_Advertiser_Id &&
      endpoint.User.UserAttributes.Mobile_Advertiser_Id.length > 0
    ) {
      eFbAttributes.push(
        helper.sha256(endpoint.User.UserAttributes.Mobile_Advertiser_Id[0]),
      );

      if (!facebookAttributes.includes('MADID_SHA256')) {
        facebookAttributes.push('MADID_SHA256');
      }
    }

    facebookAttributesList.push(eFbAttributes);
  });

  if (facebookAttributesList.length === 0) {
    console.error(
      'No EMAIL channels detected in the input, execution terminated.',
    );

    return;
  }

  const res = await DataLinkTable.getItem(ApplicationId, CampaignId);
  const facebookSecret = await helper.getFacebookSecret();
  const fbook = new FacebookActions(
    facebookSecret.adAccountId,
    facebookSecret.accessToken,
  );
  let audienceId = '';

  if (!res.Item) {
    console.info('Creating the FB objects as they do not exists');
    const prefix = await getPrefix(ApplicationId, CampaignId);

    const fbCampaign = await fbook.createCampaign(`${prefix} Campaign`);
    const fbAudience = await fbook.createCustomAudience(
      `${prefix} Audience`,
      `Custom audience imported from Pinpooint on: ${new Date().toISOString()}`,
    );
    const fbAdSet = await fbook.createAdSet(
      `${prefix} AdSet`,
      fbCampaign.campaignId,
      fbAudience.customAudienceId,
      ['SG'],
    );
    const fbAd = await fbook.createAd(
      `${prefix} Ad`,
      fbAdSet.adSetId,
      facebookSecret.pageId,
      facebookSecret.defaultWebsiteUrl,
    );

    await DataLinkTable.putItem({
      applicationId: ApplicationId,
      campaignId: CampaignId,
      fbAudience: fbAudience.customAudienceId,
      fbCampaign: fbCampaign.campaignId,
      fbAdSet: fbAdSet.adSetId,
      fbAd: fbAd.adId,
    });
    audienceId = fbAudience.customAudienceId;
  }

  let sessionId = helper.getRandomInteger(1, Number.MAX_SAFE_INTEGER);
  let sequenceId = 1;

  if (res.Item) {
    sessionId = res.Item.sessionId;
    sequenceId = res.Item.sequenceId + 1;
    audienceId = res.Item.fbAudience;
  }

  let tracking = Object.keys(Endpoints).reduce(
    (acc, endpointId) => ({
      ...acc,
      [endpointId]: createSuccessCustomEvent(
        endpointId,
        CampaignId,
        audienceId,
        Endpoints[endpointId],
      ),
    }),
    {},
  );

  try {
    const createUsersOutput = await fbook.createUsers(
      audienceId,
      sessionId,
      sequenceId,
      facebookAttributes,
      facebookAttributesList,
    );

    console.debug('Audiece details: ', createUsersOutput);

    await DataLinkTable.updateWithSessionData(
      ApplicationId,
      CampaignId,
      sessionId,
      sequenceId,
    );
  } catch (err) {
    const error = err as { response: any; message: string };
    console.error('Error creating the users in the audience: ', error.response);
    tracking = Object.keys(Endpoints).reduce(
      (acc, endpointId) => ({
        ...acc,
        [endpointId]: createFailureCustomEvent(
          endpointId,
          CampaignId,
          error.message,
          Endpoints[endpointId],
        ),
      }),
      {},
    );
  }

  await pinpoint
    .putEvents({
      ApplicationId,
      EventsRequest: {
        BatchItem: tracking,
      },
    })
    .promise();
};

const createSuccessCustomEvent = (
  endpointId: string,
  campaignId: string,
  audienceId: string,
  endpoint: any,
) => {
  return {
    Endpoint: mapEndpoint(endpoint),
    Events: {
      [`facebookads_${endpointId}_${campaignId}`]: {
        EventType: 'facebookads.success',
        Timestamp: new Date().toISOString(),
        Attributes: {
          campaign_id: campaignId,
          audience_Id: audienceId,
        },
      },
    },
  };
};

const createFailureCustomEvent = (
  endpointId: string,
  campaignId: string,
  errorMessage: string,
  endpoint: any,
) => {
  return {
    Endpoint: mapEndpoint(endpoint),
    Events: {
      [`facebookads_${endpointId}_${campaignId}`]: {
        EventType: 'facebookads.failure',
        Timestamp: new Date().toISOString(),
        Attributes: {
          campaign_id: campaignId,
          error:
            errorMessage.length > 195
              ? errorMessage.substring(0, 194)
              : errorMessage,
        },
      },
    },
  };
};

const mapEndpoint = (endpoint: any) => {
  delete endpoint.CreationDate;
  delete endpoint.CohortId;

  return endpoint;
};
