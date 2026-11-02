<script lang="ts">
	import { publicationMasonry } from '$lib/publication-masonry';
	import type { components } from '$lib/api/types';
	import type { SocialAccount } from '$lib/api/client';
	import { resolveAppPath } from '$lib/app-path';
	import { getLocaleTag } from '$lib/i18n';
	import { getAuthenticatedMediaURL } from '$lib/media-url';
	import { publicationPreviewMedia, publicationPreviewText } from '$lib/publication-preview';
	import { formatSocialAccountName } from '$lib/utils';
	import { m } from '$lib/paraglide/messages';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';
	import MediaPreviewImage from '$lib/components/media-preview-image.svelte';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import { SvelteSet } from 'svelte/reactivity';

	type Publication = components['schemas']['PublicationResponse'];
	let {
		publications,
		accounts,
		selecting,
		selectedIds = $bindable([])
	}: {
		publications: Publication[];
		accounts: SocialAccount[];
		selecting: boolean;
		selectedIds?: string[];
	} = $props();
	const missingMedia = new SvelteSet<string>();
	function select(id: string, checked: boolean) {
		selectedIds = checked
			? [...selectedIds, id]
			: selectedIds.filter((selected) => selected !== id);
	}
</script>

<div class="publication-masonry" use:publicationMasonry data-testid="draft-gallery">
	{#each publications as publication (publication.id)}
		{@const text = publicationPreviewText(publication) || m.activity_untitled_post()}
		{@const media = publicationPreviewMedia(publication)}
		{@const destinations = [
			...new Map(
				(publication.renditions ?? []).map((rendition) => [rendition.social_account_id, rendition])
			).values()
		]}
		{@const hasFailure = (publication.renditions ?? []).some(
			(destination) => destination.status === 'failed'
		)}
		<article
			class="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card text-card-foreground hover:border-foreground/30"
		>
			<a
				href={resolveAppPath(`/publications/${encodeURIComponent(publication.id)}`)}
				aria-label={m.activity_edit_post({ title: text.slice(0, 80) })}
				class="flex min-h-11 flex-1 flex-col rounded-t-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
			>
				{#if media && !missingMedia.has(media.id)}
					<div class="aspect-video overflow-hidden bg-muted">
						{#if media.poster_thumbnail_url}
							<img
								src={getAuthenticatedMediaURL(media.poster_thumbnail_url)}
								alt=""
								loading="lazy"
								class="size-full object-cover"
								onerror={() => missingMedia.add(media.id)}
							/>
						{:else}
							<MediaPreviewImage
								mediaId={media.id}
								alt=""
								class="size-full object-cover"
								onMissing={() => missingMedia.add(media.id)}
							/>
						{/if}
					</div>
				{/if}
				<div class="flex flex-1 flex-col gap-3 p-4">
					<p
						class="line-clamp-6 text-sm leading-6 [overflow-wrap:anywhere] whitespace-pre-line"
						dir="auto"
					>
						{text}
					</p>
					{#if (publication.segments?.length ?? 0) > 1}
						<span class="mt-auto text-xs text-muted-foreground"
							>{m.sidebar_thread_count({ count: publication.segments!.length })}</span
						>
					{/if}
					{#if hasFailure}<span class="text-xs font-medium text-destructive"
							>{m.activity_delivery_failed()}</span
						>{/if}
					{#if publication.review_state === 'pending'}<span class="text-xs text-muted-foreground"
							>{m.review_pending()}</span
						>
					{:else if publication.review_state === 'needs_review'}<span
							class="text-xs text-muted-foreground">{m.review_needs_review()}</span
						>
					{:else if publication.review_state === 'changes_requested'}<span
							class="text-xs font-medium text-destructive">{m.review_changes_requested()}</span
						>
					{:else if publication.review_state === 'approved'}<span
							class="text-xs text-muted-foreground">{m.review_approved()}</span
						>{/if}
				</div>
			</a>
			<div
				class="flex min-h-12 items-center gap-2 border-t px-4 py-2 text-xs text-muted-foreground"
			>
				{#if selecting}
					<Label
						for={`post-select-${publication.id}`}
						class="flex min-h-11 min-w-11 shrink-0 items-center justify-center"
						><Checkbox
							id={`post-select-${publication.id}`}
							aria-label={m.batch_select_post()}
							checked={selectedIds.includes(publication.id)}
							onCheckedChange={(checked) => select(publication.id, checked === true)}
							disabled={!selectedIds.includes(publication.id) && selectedIds.length >= 20}
						/></Label
					>
				{/if}
				<div class="flex min-w-0 flex-1 items-center gap-2">
					{#each destinations.slice(0, 2) as destination (destination.social_account_id)}
						{@const account = accounts.find(
							(account) => account.id === destination.social_account_id
						)}
						<span
							class="inline-flex min-w-0 items-center gap-1"
							title={account
								? formatSocialAccountName(account.account_username, account.platform, account.alias)
								: destination.platform}
						>
							{#if destination.platform === 'youtube'}
								<span class="shrink-0">YouTube</span>
							{:else}
								<PlatformIcon platform={destination.platform} class="size-3.5 shrink-0" />
							{/if}
							{#if account}<span class="max-w-24 truncate"
									>{formatSocialAccountName(
										account.account_username,
										account.platform,
										account.alias
									)}</span
								>{/if}
						</span>
					{/each}
					{#if destinations.length > 2}<span>+{destinations.length - 2}</span>{/if}
				</div>
				<time
					datetime={publication.updated_at || publication.created_at}
					class="shrink-0"
					title={new Date(publication.updated_at || publication.created_at).toLocaleString(
						getLocaleTag()
					)}
				>
					{new Date(publication.updated_at || publication.created_at).toLocaleDateString(
						getLocaleTag(),
						{ month: 'short', day: 'numeric' }
					)}
				</time>
			</div>
		</article>
	{/each}
</div>
