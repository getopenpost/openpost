<script lang="ts">
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';
	import { m } from '$lib/paraglide/messages';
	import type { components } from '$lib/api/types';

	type Feature = components['schemas']['FeatureStateResponse'];

	let {
		accountId,
		features,
		selections,
		mode = 'setup',
		busy = false,
		onToggle
	}: {
		accountId: string;
		features: Feature[];
		selections: Record<string, boolean>;
		mode?: 'setup' | 'details';
		busy?: boolean;
		onToggle: (feature: string, checked: boolean) => void;
	} = $props();

	type FeatureKey = 'messaging' | 'engagement' | 'analytics' | 'grow';

	const inboxKeys: FeatureKey[] = ['messaging', 'engagement'];
	const soloKeys: FeatureKey[] = ['analytics', 'grow'];

	function featureFor(key: FeatureKey): Feature | undefined {
		return features.find((f) => f.feature === key);
	}

	function isOffered(f: Feature | undefined): boolean {
		if (!f) return false;
		return f.availability !== 'unsupported';
	}

	function labelFor(key: FeatureKey): string {
		switch (key) {
			case 'messaging':
				return m.account_setup_feature_messaging_label();
			case 'engagement':
				return m.account_setup_feature_engagement_label();
			case 'analytics':
				return m.account_setup_feature_analytics_label();
			case 'grow':
				return m.account_setup_feature_grow_label();
		}
	}

	function descriptionFor(key: FeatureKey): string {
		switch (key) {
			case 'messaging':
				return m.account_setup_feature_messaging_description();
			case 'engagement':
				return m.account_setup_feature_engagement_description();
			case 'analytics':
				return m.account_setup_feature_analytics_description();
			case 'grow':
				return m.account_setup_feature_grow_description();
		}
	}

	function availabilityNote(f: Feature): string {
		if (f.availability === 'missing_scope') {
			const scopes = (f.missing_scopes ?? f.required_scopes ?? []).join(', ');
			if (!scopes) return m.account_setup_availability_missing_scope_short({ scopes: '' });
			return m.account_setup_availability_missing_scope({ scopes });
		}
		if (f.availability === 'plan_restricted') {
			return m.account_setup_availability_plan_restricted();
		}
		return '';
	}

	function isDisabled(f: Feature): boolean {
		return f.availability === 'missing_scope' || f.availability === 'plan_restricted';
	}

	function checkedFor(key: FeatureKey): boolean {
		return Boolean(selections[key]);
	}
</script>

{#snippet featureRow(key: FeatureKey)}
	{@const f = featureFor(key)}
	{#if f && isOffered(f)}
		{@const disabled = isDisabled(f) || busy}
		{@const note = availabilityNote(f)}
		<div
			class={[
				'flex min-h-11 cursor-pointer items-start gap-3 px-3 py-3 transition-colors',
				disabled ? 'cursor-not-allowed opacity-85' : 'hover:bg-muted/30',
				checkedFor(key) && !disabled ? 'bg-primary/5' : ''
			]}
		>
			<Label
				for={`feature-${accountId}-${key}`}
				class={['min-w-0 flex-1 cursor-pointer items-start', disabled ? 'cursor-not-allowed' : '']}
			>
				<span class="min-w-0 flex-1 space-y-1">
					<span class="block text-sm leading-5 font-medium text-foreground">{labelFor(key)}</span>
					<span class="block text-xs leading-5 font-normal text-muted-foreground">
						{descriptionFor(key)}
					</span>
					{#if note}
						<span class="block text-xs leading-5 font-normal text-muted-foreground">{note}</span>
					{/if}
				</span>
			</Label>
			<Checkbox
				id={`feature-${accountId}-${key}`}
				class="mt-0.5 shrink-0"
				checked={checkedFor(key)}
				{disabled}
				onCheckedChange={(v) => onToggle(key, Boolean(v))}
			/>
		</div>
	{/if}
{/snippet}

{#if mode === 'details'}
	<div class="divide-y overflow-hidden rounded-lg border bg-card">
		{#each [...inboxKeys, ...soloKeys] as key (key)}
			{@render featureRow(key)}
		{/each}
	</div>
{:else}
	<div class="space-y-4">
		{#if inboxKeys.some((k) => isOffered(featureFor(k)))}
			<div class="space-y-3">
				<div class="space-y-1">
					<h3 class="text-sm font-semibold tracking-tight">
						{m.account_setup_inbox_title()}
					</h3>
					<p class="text-xs leading-5 text-muted-foreground">
						{m.account_setup_inbox_description()}
					</p>
				</div>
				<div class="divide-y overflow-hidden rounded-lg border bg-card">
					{#each inboxKeys as key (key)}
						{@render featureRow(key)}
					{/each}
				</div>
			</div>
		{/if}

		{#if soloKeys.some((key) => isOffered(featureFor(key)))}
			<div class="divide-y overflow-hidden rounded-lg border bg-card">
				{#each soloKeys as key (key)}
					{@render featureRow(key)}
				{/each}
			</div>
		{/if}
	</div>
{/if}
