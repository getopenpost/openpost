<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import { getLocaleTag } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';
	import { resolveAppPath } from '$lib/app-path';
	import {
		mediaUsageKindLabel,
		mediaUsageStatusLabel,
		type MediaItem,
		type MediaUsage
	} from '$lib/media-presentation';

	interface Props {
		usages: MediaUsage[];
		usagesLoading: boolean;
		usagesReady: boolean;
		usagesError: string;
		media: MediaItem | null;
		timeZone: string;
		onShowUsage: (media: MediaItem) => void;
	}

	let { usages, usagesLoading, usagesReady, usagesError, media, timeZone, onShowUsage }: Props =
		$props();
</script>

<div class="space-y-2 py-4">
	<h3 class="text-sm font-semibold">{m.media_used_by()}</h3>
	{#snippet usageErrorNotice()}
		<InlineNotice tone="error" message={usagesError}>
			{#snippet actions()}
				<Button variant="outline" size="sm" onclick={() => media && onShowUsage(media)}>
					{m.common_retry()}
				</Button>
			{/snippet}
		</InlineNotice>
	{/snippet}
	{#if usagesLoading && !usagesReady}
		<div class="py-4">
			<PageLoading layout="list" label={m.common_loading()} items={3} />
		</div>
	{:else if usagesError && !usagesReady}
		{@render usageErrorNotice()}
	{:else}
		{#if usagesLoading}
			<span class="sr-only" role="status">{m.common_loading()}</span>
		{/if}
		{#if usagesError}
			{@render usageErrorNotice()}
		{/if}
		{#if usages.length === 0}
			<p class="py-8 text-center text-sm text-muted-foreground">
				{m.media_usage_empty()}
			</p>
		{:else}
			{#each usages as usage (`${usage.kind}-${usage.id}`)}
				{@const href =
					usage.kind === 'publication'
						? resolveAppPath(`/publications/${encodeURIComponent(usage.id)}`)
						: undefined}
				<svelte:element
					this={href ? 'a' : 'div'}
					{href}
					class={[
						'block rounded-lg border px-3 py-2.5',
						href &&
							'hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
					]}
				>
					<p class="line-clamp-2 text-sm font-medium" dir="auto">{usage.label || usage.content}</p>
					<p class="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
						<span class="inline-block first-letter:uppercase"
							>{mediaUsageKindLabel(usage.kind)}</span
						>
						{#if usage.status}
							<span aria-hidden="true">·</span>
							<span>{mediaUsageStatusLabel(usage.status)}</span>
						{/if}
						{#if usage.scheduled_at}
							<span aria-hidden="true">·</span>
							<time datetime={usage.scheduled_at}
								>{new Date(usage.scheduled_at).toLocaleString(getLocaleTag(), {
									timeZone,
									dateStyle: 'medium',
									timeStyle: 'short'
								})}</time
							>
						{/if}
					</p>
				</svelte:element>
			{/each}
		{/if}
	{/if}
</div>
