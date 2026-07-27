import { normalizeHostedPlanID } from '$lib/billing';

export const SAMPLE_CAMPAIGN_QUERY_VALUE = 'campaign';
export const SAMPLE_CAMPAIGN_DISMISSED_KEY = 'openpost.sample-campaign-entry-dismissed';

export function sampleCampaignPathForPlan(planID?: string | null): string {
	const searchParams = new URLSearchParams({ sample: SAMPLE_CAMPAIGN_QUERY_VALUE });
	const plan = normalizeHostedPlanID(planID);
	if (plan) searchParams.set('plan', plan);
	return `/?${searchParams.toString()}`;
}

export function isSampleCampaignRequested(searchParams: URLSearchParams): boolean {
	return searchParams.get('sample') === SAMPLE_CAMPAIGN_QUERY_VALUE;
}
