import { describe, expect, it } from 'vitest';

import {
	billingPeriodFromSearchParams,
	checkoutPathForPlan,
	hostedPlanByID,
	hostedPlans,
	normalizeBillingPeriod,
	normalizeHostedPlanID,
	planPriceUSD
} from './billing';

describe('hosted billing catalog', () => {
	it('keeps the USD-first monthly and annual prices in the product catalog', () => {
		expect(hostedPlans.map((plan) => [plan.id, plan.monthlyPriceUSD, plan.annualPriceUSD])).toEqual(
			[
				['starter', 15, 150],
				['creator', 29, 290],
				['pro', 49, 490],
				['team', 99, 990],
				['agency', 199, 1990]
			]
		);
	});

	it('defaults unknown plans to Creator without accepting arbitrary ids', () => {
		expect(normalizeHostedPlanID('AGENCY')).toBe('agency');
		expect(normalizeHostedPlanID('enterprise')).toBe('');
		expect(hostedPlanByID('enterprise').id).toBe('creator');
	});

	it('normalizes yearly links to the annual billing period', () => {
		expect(normalizeBillingPeriod('yearly')).toBe('annual');
		expect(billingPeriodFromSearchParams(new URLSearchParams('billing_period=annual'))).toBe(
			'annual'
		);
		expect(normalizeBillingPeriod('quarterly')).toBe('monthly');
	});

	it('builds an internal checkout path with a safe plan and billing period', () => {
		expect(checkoutPathForPlan('team', 'annual')).toBe('/checkout?plan=team&billing_period=annual');
		expect(checkoutPathForPlan('unknown', 'yearly')).toBe(
			'/checkout?plan=creator&billing_period=annual'
		);
	});

	it('returns the full-period price used by checkout', () => {
		const creator = hostedPlanByID('creator');
		expect(planPriceUSD(creator, 'monthly')).toBe(29);
		expect(planPriceUSD(creator, 'annual')).toBe(290);
	});
});
