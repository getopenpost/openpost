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
				['founder', 25, 250],
				['pro', 49, 490],
				['team', 99, 990],
				['agency', 199, 1990]
			]
		);
	});

	it('rejects unknown plans instead of selecting Founder', () => {
		expect(normalizeHostedPlanID('AGENCY')).toBe('agency');
		expect(normalizeHostedPlanID('enterprise')).toBe('');
		expect(hostedPlanByID('enterprise')).toBeUndefined();
	});

	it('accepts only canonical monthly and annual billing periods', () => {
		expect(normalizeBillingPeriod('annual')).toBe('annual');
		expect(billingPeriodFromSearchParams(new URLSearchParams('billing_period=annual'))).toBe(
			'annual'
		);
		expect(normalizeBillingPeriod('yearly')).toBe('');
		expect(normalizeBillingPeriod('quarterly')).toBe('');
		expect(billingPeriodFromSearchParams(new URLSearchParams())).toBe('');
	});

	it('builds an internal checkout path with a safe plan and billing period', () => {
		expect(checkoutPathForPlan('team', 'annual')).toBe('/checkout?plan=team&billing_period=annual');
		expect(checkoutPathForPlan('unknown', 'annual')).toBe('');
		expect(checkoutPathForPlan('founder', 'yearly')).toBe('');
	});

	it('preserves every sellable plan across monthly and annual checkout links', () => {
		for (const plan of hostedPlans) {
			for (const period of ['monthly', 'annual'] as const) {
				expect(checkoutPathForPlan(plan.id, period)).toBe(
					`/checkout?plan=${plan.id}&billing_period=${period}`
				);
			}
		}
	});

	it('returns the full-period price used by checkout', () => {
		const founder = hostedPlanByID('founder')!;
		expect(planPriceUSD(founder, 'monthly')).toBe(25);
		expect(planPriceUSD(founder, 'annual')).toBe(250);
	});
});
