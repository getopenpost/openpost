export const hostedPlanIDs = ['starter', 'creator', 'pro', 'team', 'agency'] as const;

export type HostedPlanID = (typeof hostedPlanIDs)[number];

const hostedPlanIDSet = new Set<string>(hostedPlanIDs);

export function normalizeHostedPlanID(planID: string | null | undefined): HostedPlanID | '' {
	const normalized = planID?.toLowerCase() ?? '';
	return hostedPlanIDSet.has(normalized) ? (normalized as HostedPlanID) : '';
}

export function hostedPlanFromSearchParams(searchParams: URLSearchParams): HostedPlanID | '' {
	return normalizeHostedPlanID(searchParams.get('plan'));
}

export function onboardingPathForPlan(planID: string | null | undefined): string {
	const normalized = normalizeHostedPlanID(planID);
	return normalized ? `/onboarding?plan=${encodeURIComponent(normalized)}` : '/onboarding';
}

export function settingsPathForPlan(planID: string | null | undefined): string {
	const normalized = normalizeHostedPlanID(planID);
	return normalized ? `/settings?plan=${encodeURIComponent(normalized)}` : '/';
}
