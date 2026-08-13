import {
	billingPeriods,
	hostedPlanDefinition,
	hostedPlanIDs,
	planCatalog,
	type BillingPeriod,
	type HostedPlanID
} from '@openpost/plan-catalog';

export { billingPeriods, hostedPlanIDs, planCatalog, type BillingPeriod, type HostedPlanID };

export interface HostedPlan {
	id: HostedPlanID;
	name: string;
	description: string;
	monthlyPriceUSD: number;
	annualPriceUSD: number;
	featured?: boolean;
	bestFor: string;
	limits: readonly string[];
}

export const hostedPlans: readonly HostedPlan[] = planCatalog.plans.map((plan) => ({
	id: plan.id,
	name: plan.name,
	description: plan.description,
	monthlyPriceUSD: plan.monthly_price_usd,
	annualPriceUSD: plan.annual_price_usd,
	featured: plan.featured,
	bestFor: plan.best_for,
	limits: [
		`${plan.limits.social_accounts} social accounts`,
		`${plan.limits.scheduled_posts_monthly.toLocaleString('en-US')} scheduled posts / month`,
		`${plan.limits.media_bytes_stored / 1_000_000_000} GB media`,
		...(plan.limits.team_members > 1 ? [`${plan.limits.team_members} seats`] : [])
	]
}));

const hostedPlanIDSet = new Set<string>(hostedPlanIDs);

export function normalizeHostedPlanID(planID: string | null | undefined): HostedPlanID | '' {
	const normalized = planID?.trim().toLowerCase() ?? '';
	return hostedPlanIDSet.has(normalized) ? (normalized as HostedPlanID) : '';
}

export function normalizeBillingPeriod(period: string | null | undefined): BillingPeriod | '' {
	const normalized = period?.trim().toLowerCase() ?? '';
	return billingPeriods.includes(normalized as BillingPeriod) ? (normalized as BillingPeriod) : '';
}

export function hostedPlanFromSearchParams(searchParams: URLSearchParams): HostedPlanID | '' {
	return normalizeHostedPlanID(searchParams.get('plan'));
}

export function billingPeriodFromSearchParams(searchParams: URLSearchParams): BillingPeriod | '' {
	return normalizeBillingPeriod(searchParams.get('billing_period'));
}

export function hostedPlanByID(planID: string | null | undefined): HostedPlan | undefined {
	const normalized = normalizeHostedPlanID(planID);
	if (!normalized || !hostedPlanDefinition(normalized)) return undefined;
	return hostedPlans.find((plan) => plan.id === normalized);
}

export function planPriceUSD(plan: HostedPlan, period: BillingPeriod): number {
	return period === 'annual' ? plan.annualPriceUSD : plan.monthlyPriceUSD;
}

export function onboardingPathForPlan(
	planID: string | null | undefined,
	period: string | null | undefined
): string {
	const normalizedPlan = normalizeHostedPlanID(planID);
	const normalizedPeriod = normalizeBillingPeriod(period);
	if (!normalizedPlan || !normalizedPeriod) return '';
	const query = new URLSearchParams({ plan: normalizedPlan, billing_period: normalizedPeriod });
	return `/onboarding?${query}`;
}

export function checkoutPathForPlan(
	planID: string | null | undefined,
	period: string | null | undefined
): string {
	const normalizedPlan = normalizeHostedPlanID(planID);
	const normalizedPeriod = normalizeBillingPeriod(period);
	if (!normalizedPlan || !normalizedPeriod) return '';
	const query = new URLSearchParams({ plan: normalizedPlan, billing_period: normalizedPeriod });
	return `/checkout?${query}`;
}
