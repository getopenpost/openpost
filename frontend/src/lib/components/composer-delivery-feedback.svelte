<script lang="ts">
	import type { components } from '$lib/api/types';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';
	import PublicationDeliveryCard from './publication-delivery-card.svelte';

	type Rendition = components['schemas']['RenditionActionOutcome'];

	let {
		publicationID,
		renditions,
		accountLabels = {},
		workspaceActivated = false,
		retryingRenditionID = '',
		onRetry,
		onManualResolution,
		onCreateAnother
	}: {
		publicationID: string;
		renditions: Rendition[];
		accountLabels?: Record<string, string>;
		workspaceActivated?: boolean;
		retryingRenditionID?: string;
		onRetry: (renditionID: string) => void | Promise<void>;
		onManualResolution: (renditionID: string) => void | Promise<void>;
		onCreateAnother: () => void | Promise<void>;
	} = $props();

	function outcomeGroup(rendition: Rendition): 'succeeded' | 'pending' | 'failed' | 'manual' {
		const state = rendition.delivery?.state || rendition.status;
		if (state === 'live' || state === 'published') return 'succeeded';
		if (
			state === 'ambiguous' ||
			state === 'manual_resolution' ||
			rendition.delivery?.recovery_action === 'reconcile' ||
			rendition.delivery?.recovery_action === 'manual_resolution'
		) {
			return 'manual';
		}
		if (state === 'rejected' || state === 'failed') return 'failed';
		return 'pending';
	}

	const summary = $derived.by(() => {
		const counts = { succeeded: 0, pending: 0, failed: 0, manual: 0 };
		for (const rendition of renditions) counts[outcomeGroup(rendition)] += 1;
		return counts;
	});
</script>

<section
	class="mx-auto w-full max-w-2xl px-3 py-4 md:px-6 md:py-6"
	aria-labelledby="composer-delivery-outcomes-heading"
	data-testid="composer-delivery-feedback"
>
	<div class="space-y-4">
		{#if workspaceActivated}
			<div class="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-4">
				<h2 class="font-semibold">{m.workspace_activation_heading()}</h2>
				<p class="mt-1 text-sm/6 text-muted-foreground">
					{m.workspace_activation_description()}
				</p>
			</div>
		{/if}
		<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
			<div>
				<h2 id="composer-delivery-outcomes-heading" class="font-semibold">
					{m.composer_delivery_outcomes()}
				</h2>
				<p class="mt-1 text-sm text-muted-foreground" role="status" aria-live="polite">
					{m.composer_delivery_summary(summary)}
				</p>
			</div>
			<div class="flex flex-wrap gap-2">
				<Button variant="outline" href={`/publications/${encodeURIComponent(publicationID)}`}>
					{m.workspace_activation_view_publication()}
				</Button>
				<Button onclick={onCreateAnother}>{m.workspace_activation_create_another()}</Button>
			</div>
		</div>

		<div class="grid gap-3 sm:grid-cols-2">
			{#each renditions as rendition (rendition.id)}
				<PublicationDeliveryCard
					{rendition}
					destinationLabel={accountLabels[rendition.social_account_id]}
					retrying={retryingRenditionID === rendition.id}
					{onRetry}
					{onManualResolution}
				/>
			{/each}
		</div>
	</div>
</section>
