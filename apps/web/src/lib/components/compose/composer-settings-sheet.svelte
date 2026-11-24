<script lang="ts">
	import { tick } from 'svelte';
	import type { components } from '$lib/api/types';
	import PublicationReviewControl from '$lib/components/publication-review-control.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Sheet from '$lib/components/ui/sheet';
	import { m } from '$lib/paraglide/messages';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';
	import ComposerRepostControl from '../composer-repost-control.svelte';
	import type { Publication } from './composer-host';

	interface Props {
		open: boolean;
		workspaceId: string;
		publicationId: string;
		reviewState: string;
		/** Saves the draft so the review link points at current content. */
		prepareReview: () => Promise<Publication>;
		onReviewChanged: (publication: Publication) => void | Promise<void>;
		sourcePlatforms: string[];
		repostOverride: components['schemas']['Override'];
		/** Disables repost edits while the composer saves or submits. */
		busy: boolean;
		onRepostChange: () => void;
		onOpenVersionHistory?: () => void;
		onCopyAsDraft?: () => void | Promise<void>;
		copyingDraft?: boolean;
	}

	// Per-post settings: version history, copying, client review, and repost behavior.
	let {
		open = $bindable(),
		workspaceId,
		publicationId,
		reviewState,
		prepareReview,
		onReviewChanged,
		sourcePlatforms,
		repostOverride = $bindable(),
		busy,
		onRepostChange,
		onOpenVersionHistory,
		onCopyAsDraft,
		copyingDraft = false
	}: Props = $props();

	async function openVersionHistory() {
		open = false;
		await tick();
		onOpenVersionHistory?.();
	}
</script>

<Sheet.Root bind:open>
	<Sheet.Content
		side="right"
		class="w-full! gap-0 overflow-y-auto p-0 sm:max-w-lg!"
		data-testid="composer-settings-sheet"
	>
		<Sheet.Header class="border-b px-5 py-5 pr-16 text-left">
			<Sheet.Title>{m.compose_post_settings()}</Sheet.Title>
			<Sheet.Description>{m.compose_post_settings_body()}</Sheet.Description>
		</Sheet.Header>
		{#if onOpenVersionHistory || onCopyAsDraft}
			<div class="grid gap-1 border-b p-3">
				{#if onOpenVersionHistory}
					<Button
						type="button"
						variant="ghost"
						class="h-11 w-full justify-start gap-3 px-3"
						onclick={openVersionHistory}
					>
						<ThemeIcon role="history" class="size-4 text-muted-foreground" />
						{m.image_editor_version_history()}
					</Button>
				{/if}
				{#if onCopyAsDraft}
					<Button
						type="button"
						variant="ghost"
						class="h-11 w-full justify-start gap-3 px-3"
						onclick={onCopyAsDraft}
						disabled={copyingDraft}
					>
						{#if copyingDraft}
							<ProtectedIcon
								icon="loading"
								class="size-4 animate-spin text-muted-foreground motion-reduce:animate-none"
							/>
							{m.publication_copying()}
						{:else}
							<ThemeIcon role="copy" class="size-4 text-muted-foreground" />
							{m.publication_copy_as_draft()}
						{/if}
					</Button>
				{/if}
			</div>
		{/if}
		<div class="px-5">
			<PublicationReviewControl
				{workspaceId}
				{publicationId}
				{reviewState}
				prepare={prepareReview}
				onChanged={onReviewChanged}
			/>
		</div>
		<div class="p-5">
			<ComposerRepostControl
				workspaceID={workspaceId}
				{sourcePlatforms}
				bind:value={repostOverride}
				disabled={!workspaceId || busy}
				onChange={onRepostChange}
			/>
		</div>
	</Sheet.Content>
</Sheet.Root>
