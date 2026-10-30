<script lang="ts">
	import type { components } from '$lib/api/types';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';
	import { resolveAppPath } from '$lib/app-path';
	import { deliveryOutcomeSummary } from '$lib/delivery-outcome';
	import InlineNotice from './inline-notice.svelte';
	import PublicationDeliveryCard from './publication-delivery-card.svelte';

	type Rendition = components['schemas']['RenditionActionOutcome'];

	let {
		publicationID,
		renditions,
		accountLabels = {},
		accountAvatars = {},
		workspaceActivated = false,
		retryingRenditionID = '',
		onRetry,
		onManualResolution,
		onCreateAnother
	}: {
		publicationID: string;
		renditions: Rendition[];
		accountLabels?: Record<string, string>;
		accountAvatars?: Record<string, string | null | undefined>;
		workspaceActivated?: boolean;
		retryingRenditionID?: string;
		onRetry: (renditionID: string) => void | Promise<void>;
		onManualResolution: (renditionID: string) => void | Promise<void>;
		onCreateAnother: () => void | Promise<void>;
	} = $props();

	const summary = $derived(deliveryOutcomeSummary(renditions));
</script>

<section
	class="mx-auto w-full max-w-2xl px-3 py-4 md:px-6 md:py-6"
	aria-labelledby="composer-delivery-outcomes-heading"
	data-testid="composer-delivery-feedback"
>
	<div class="space-y-4">
		{#if workspaceActivated}
			<InlineNotice tone="success" message={m.workspace_activation_heading()}>
				<p class="mt-0.5">{m.workspace_activation_description()}</p>
			</InlineNotice>
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
				<Button
					variant="outline"
					href={resolveAppPath(`/publications/${encodeURIComponent(publicationID)}`)}
				>
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
					accountAvatarUrl={accountAvatars[rendition.social_account_id] ?? ''}
					retrying={retryingRenditionID === rendition.id}
					{onRetry}
					{onManualResolution}
				/>
			{/each}
		</div>
	</div>
</section>
