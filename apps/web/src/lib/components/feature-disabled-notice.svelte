<script lang="ts">
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';
	import type { FeatureKey, FeatureState } from '$lib/feature-disabled';
	import {
		disabledNoticeText,
		featureReason,
		collectiveDisabledReason
	} from '$lib/feature-disabled';

	let {
		feature,
		features,
		staleFeature,
		recoveryHref = '/settings?tab=accounts',
		tone = 'warning'
	}: {
		feature: FeatureKey;
		features?: FeatureState[];
		staleFeature?: FeatureState | null;
		recoveryHref?: string;
		tone?: 'warning' | 'info' | 'error';
	} = $props();

	const noticeText = $derived(disabledNoticeText(feature));
	const reason = $derived(
		staleFeature
			? featureReason(staleFeature)
			: features
				? (collectiveDisabledReason(features, feature) ?? '')
				: ''
	);

	let actionTone: 'warning' | 'info' = $derived(
		staleFeature?.availability === 'plan_restricted' ||
			features?.some((f) => f.availability === 'plan_restricted')
			? 'info'
			: 'warning'
	);
</script>

<div data-testid="feature-disabled-notice">
	<InlineNotice {tone} message={noticeText}>
		{#snippet actions()}
			{#if staleFeature?.availability === 'plan_restricted' || features?.some((f) => f.availability === 'plan_restricted')}
				<Button
					href="/settings?tab=accounts"
					variant="outline"
					size="sm"
					data-testid="feature-disabled-billing-link"
				>
					{m.feature_disabled_open_billing()}
				</Button>
			{:else if staleFeature?.availability === 'missing_scope'}
				<Button
					href={recoveryHref}
					variant="outline"
					size="sm"
					data-testid="feature-disabled-recovery-link"
				>
					{m.feature_disabled_reconnect()}
				</Button>
			{:else}
				<Button
					href={recoveryHref}
					variant="outline"
					size="sm"
					data-testid="feature-disabled-recovery-link"
				>
					{m.feature_disabled_open_details()}
				</Button>
			{/if}
		{/snippet}
		{#if reason}
			<p class="mt-1 text-xs leading-5 opacity-90" data-testid="feature-disabled-reason">
				{reason}
			</p>
		{/if}
	</InlineNotice>
</div>
