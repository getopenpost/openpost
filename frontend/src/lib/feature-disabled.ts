import { m } from '$lib/paraglide/messages';
import type { components } from '$lib/api/types';
import { accountFeaturesQueryOptions } from '@openpost/query-catalog';
import { featureQueryAPI } from '$lib/query/features';
import { queryClient } from '$lib/query/client';

export type FeatureKey = 'messaging' | 'engagement' | 'analytics' | 'grow';
export type FeatureState = components['schemas']['FeatureStateResponse'];

export function isFeatureEffective(
	features: FeatureState[],
	accountId: string,
	feature: FeatureKey
): boolean {
	return features.some(
		(f) => f.social_account_id === accountId && f.feature === feature && f.effective_enabled
	);
}

export function eligibleAccounts(
	accounts: { id: string }[],
	features: FeatureState[],
	feature: FeatureKey
): { id: string }[] {
	return accounts.filter((a) => isFeatureEffective(features, a.id, feature));
}

export function allFeatureEffectiveDisabled(
	features: FeatureState[],
	feature: FeatureKey
): boolean {
	const subset = features.filter((f) => f.feature === feature);
	if (subset.length === 0) return false;
	return subset.every((f) => !f.effective_enabled);
}

export function hasAnyEffectiveEnabled(features: FeatureState[], feature: FeatureKey): boolean {
	return features.some((f) => f.feature === feature && f.effective_enabled);
}

export function featureReason(feature: FeatureState): string {
	if (feature.availability === 'missing_scope') {
		const scopes = (feature.missing_scopes ?? feature.required_scopes ?? []).join(', ');
		return m.feature_disabled_reason_missing_scope({ scopes });
	}
	if (feature.availability === 'plan_restricted') {
		return m.feature_disabled_reason_plan_restricted();
	}
	if (!feature.stored_exists) {
		return m.feature_disabled_reason_undecided();
	}
	return m.feature_disabled_reason_off();
}

export function collectiveDisabledReason(
	features: FeatureState[],
	feature: FeatureKey
): string | null {
	const subset = features.filter((f) => f.feature === feature && !f.effective_enabled);
	if (subset.length === 0) return null;
	const hasMissing = subset.find((f) => f.availability === 'missing_scope');
	if (hasMissing) {
		const scopes = (hasMissing.missing_scopes ?? hasMissing.required_scopes ?? []).join(', ');
		return m.feature_disabled_reason_missing_scope({ scopes });
	}
	const hasPlan = subset.find((f) => f.availability === 'plan_restricted');
	if (hasPlan) return m.feature_disabled_reason_plan_restricted();
	const hasUndecided = subset.find((f) => !f.stored_exists);
	if (hasUndecided) return m.feature_disabled_reason_undecided();
	return m.feature_disabled_reason_off();
}

export function disabledNoticeText(feature: FeatureKey): string {
	switch (feature) {
		case 'messaging':
			return m.messages_feature_disabled_notice();
		case 'engagement':
			return m.engagement_feature_disabled_notice();
		case 'analytics':
			return m.analytics_feature_disabled_notice();
		case 'grow':
			return m.grow_feature_disabled_notice();
	}
}

export function disabledEmptyTitle(feature: FeatureKey): string {
	switch (feature) {
		case 'messaging':
			return m.messages_feature_disabled_title();
		case 'engagement':
			return m.engagement_feature_disabled_title();
		case 'analytics':
			return m.analytics_feature_disabled_title();
		case 'grow':
			return m.grow_feature_all_disabled_title();
	}
}

export function disabledEmptyDescription(feature: FeatureKey): string {
	switch (feature) {
		case 'messaging':
			return m.messages_feature_disabled_description();
		case 'engagement':
			return m.engagement_feature_disabled_description();
		case 'analytics':
			return m.analytics_feature_disabled_description();
		case 'grow':
			return m.grow_feature_all_disabled_description();
	}
}

export function staleGrowReasonDetail(feature: FeatureState): string {
	if (feature.availability === 'missing_scope') {
		const scopes = (feature.missing_scopes ?? feature.required_scopes ?? []).join(', ');
		if (!scopes) return m.feature_disabled_reason_missing_scope({ scopes: '' });
		return m.grow_feature_missing_scope_description({ scopes });
	}
	if (feature.availability === 'plan_restricted') {
		return m.grow_feature_plan_restricted_description();
	}
	if (!feature.stored_exists) {
		return m.feature_disabled_reason_undecided();
	}
	return m.grow_feature_disabled_description();
}

export async function loadFeatureStates(
	workspaceID: string,
	accounts: { id: string }[]
): Promise<FeatureState[]> {
	if (!workspaceID || accounts.length === 0) return [];
	try {
		return await queryClient.fetchQuery(
			accountFeaturesQueryOptions(
				featureQueryAPI,
				workspaceID,
				accounts.map((account) => account.id)
			)
		);
	} catch {
		return [];
	}
}
