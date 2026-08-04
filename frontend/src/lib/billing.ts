export const hostedPlanIDs = ['starter', 'creator', 'pro', 'team', 'agency'] as const;
export const billingPeriods = ['monthly', 'annual'] as const;

export type HostedPlanID = (typeof hostedPlanIDs)[number];
export type BillingPeriod = (typeof billingPeriods)[number];

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

export const hostedPlans: readonly HostedPlan[] = [
	{
		id: 'starter',
		name: 'Starter',
		description: 'Start a repeatable content habit for one company.',
		monthlyPriceUSD: 15,
		annualPriceUSD: 150,
		bestFor: 'Your first content system',
		limits: ['3 social accounts', '100 scheduled posts / month', '1 GB media']
	},
	{
		id: 'creator',
		name: 'Creator',
		description: 'Run your company’s content across more channels.',
		monthlyPriceUSD: 29,
		annualPriceUSD: 290,
		featured: true,
		bestFor: 'Solo founders publishing consistently',
		limits: ['6 social accounts', '500 scheduled posts / month', '5 GB media']
	},
	{
		id: 'pro',
		name: 'Pro',
		description: 'A complete content operation for one founder.',
		monthlyPriceUSD: 49,
		annualPriceUSD: 490,
		bestFor: 'Founder-led companies with high output',
		limits: ['15 social accounts', '2,500 scheduled posts / month', '25 GB media']
	},
	{
		id: 'team',
		name: 'Team',
		description: 'Shared planning and publishing for a small team.',
		monthlyPriceUSD: 99,
		annualPriceUSD: 990,
		bestFor: 'Growing marketing teams',
		limits: ['25 social accounts', '5,000 scheduled posts / month', '3 seats']
	},
	{
		id: 'agency',
		name: 'Agency',
		description: 'Many clients, workspaces, and campaigns.',
		monthlyPriceUSD: 199,
		annualPriceUSD: 1990,
		bestFor: 'Agencies and multi-brand operators',
		limits: ['150 social accounts', '25,000 scheduled posts / month', '5 seats']
	}
] as const;

const hostedPlanIDSet = new Set<string>(hostedPlanIDs);

export function normalizeHostedPlanID(planID: string | null | undefined): HostedPlanID | '' {
	const normalized = planID?.toLowerCase() ?? '';
	return hostedPlanIDSet.has(normalized) ? (normalized as HostedPlanID) : '';
}

export function normalizeBillingPeriod(period: string | null | undefined): BillingPeriod {
	return period?.toLowerCase() === 'annual' || period?.toLowerCase() === 'yearly'
		? 'annual'
		: 'monthly';
}

export function hostedPlanFromSearchParams(searchParams: URLSearchParams): HostedPlanID | '' {
	return normalizeHostedPlanID(searchParams.get('plan'));
}

export function billingPeriodFromSearchParams(searchParams: URLSearchParams): BillingPeriod {
	return normalizeBillingPeriod(searchParams.get('billing_period'));
}

export function hostedPlanByID(planID: string | null | undefined): HostedPlan {
	const normalized = normalizeHostedPlanID(planID) || 'creator';
	return hostedPlans.find((plan) => plan.id === normalized) ?? hostedPlans[1];
}

export function planPriceUSD(plan: HostedPlan, period: BillingPeriod): number {
	return period === 'annual' ? plan.annualPriceUSD : plan.monthlyPriceUSD;
}

export function onboardingPathForPlan(planID: string | null | undefined): string {
	const normalized = normalizeHostedPlanID(planID);
	return normalized ? `/onboarding?plan=${encodeURIComponent(normalized)}` : '/onboarding';
}

export function checkoutPathForPlan(
	planID: string | null | undefined,
	period: string | null | undefined = 'monthly'
): string {
	const plan = normalizeHostedPlanID(planID) || 'creator';
	const query = new URLSearchParams({
		plan,
		billing_period: normalizeBillingPeriod(period)
	});
	return `/checkout?${query}`;
}

export function settingsPathForPlan(planID: string | null | undefined): string {
	return checkoutPathForPlan(planID);
}
