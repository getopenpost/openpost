import { describe, expect, it } from 'vitest';
import { isSampleCampaignRequested, sampleCampaignPathForPlan } from '$lib/sample-campaign';

describe('sample campaign navigation', () => {
	it('opens the local sample without inventing a plan', () => {
		expect(sampleCampaignPathForPlan()).toBe('/?sample=campaign');
	});

	it('preserves a valid hosted plan through the sample', () => {
		expect(sampleCampaignPathForPlan('Creator')).toBe('/?sample=campaign&plan=creator');
	});

	it('drops unknown plan values', () => {
		expect(sampleCampaignPathForPlan('enterprise')).toBe('/?sample=campaign');
	});

	it('recognizes only the explicit sample campaign value', () => {
		expect(isSampleCampaignRequested(new URLSearchParams('sample=campaign'))).toBe(true);
		expect(isSampleCampaignRequested(new URLSearchParams('sample=tour'))).toBe(false);
	});
});
