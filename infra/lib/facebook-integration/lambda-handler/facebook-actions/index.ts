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
import axios from 'axios';

export const BASE_URL = 'https://graph.facebook.com/v14.0';

export default class FacebookActions {
  private accessToken: string;
  private adAccountId: string;

  constructor(adAccountId: string, accessToken: string) {
    this.accessToken = accessToken;
    this.adAccountId = adAccountId;
  }

  public async createCustomAudience(name: string, description: string) {
    const result = await axios.post(
      `${BASE_URL}/act_${this.adAccountId}/customaudiences`,
      {
        name,
        description,
        subtype: 'CUSTOM',
        customer_file_source: 'USER_PROVIDED_ONLY',
        access_token: this.accessToken,
      },
    );

    return { customAudienceId: result.data.id };
  }

  public async createCampaign(name: string) {
    const result = await axios.post(
      `${BASE_URL}/act_${this.adAccountId}/campaigns`,
      {
        name,
        buying_type: 'AUCTION',
        objective: 'LINK_CLICKS',
        status: 'PAUSED',
        special_ad_categories: ['NONE'],
        access_token: this.accessToken,
      },
    );

    return { campaignId: result.data.id };
  }

  public async createAdSet(
    name: string,
    campaignId: number,
    customAudienceId: number,
    countries: string[] = ['VN'],
  ) {
    const result = await axios.post(
      `${BASE_URL}/act_${this.adAccountId}/adsets`,
      {
        name,
        optimization_goal: 'LINK_CLICKS',
        billing_event: 'IMPRESSIONS',
        bid_strategy: 'COST_CAP',
        bid_amount: 20,
        daily_budget: 2000,
        campaign_id: campaignId,
        targeting: {
          custom_audiences: [{ id: customAudienceId }],
          geo_locations: { countries },
        },
        status: 'PAUSED',
        access_token: this.accessToken,
      },
    );

    return { adSetId: result.data.id };
  }

  public async createAd(
    name: string,
    adSetId: number,
    pageId: string,
    webLink: string,
  ) {
    const result = await axios.post(`${BASE_URL}/act_${this.adAccountId}/ads`, {
      name,
      adset_id: adSetId,
      status: 'PAUSED',
      creative: {
        name: `${name} creative`,
        object_story_spec: {
          page_id: pageId,
          link_data: {
            link: webLink,
          },
        },
      },
      access_token: this.accessToken,
    });

    return { adId: result.data.id };
  }

  public async createUsers(
    audienceId: string,
    sessionId: number,
    sequenceId: number,
    schema: string[],
    data: string[][],
  ) {
    const result = await axios.post(`${BASE_URL}/${audienceId}/users`, {
      session: {
        session_id: sessionId,
        batch_seq: sequenceId,
        // consider always as last batch as it seems this is not influencing much of the behaviour
        // would be hard to identify what's the last message in the queue thus this must be a static value
        last_batch_flag: true,
      },
      payload: {
        schema,
        data,
      },
      access_token: this.accessToken,
    });

    return {
      records: result.data.num_received,
      invalidRecords: result.data.num_invalid_entries,
    };
  }
}
