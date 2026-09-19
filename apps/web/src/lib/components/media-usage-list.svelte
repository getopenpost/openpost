<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import { getLocaleTag } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';
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
				<div class="rounded-lg border p-3">
					<p class="line-clamp-2 text-sm font-medium">{usage.label || usage.content}</p>
					<p class="mt-1 text-xs text-muted-foreground">{mediaUsageKindLabel(usage.kind)}</p>
					<div class="mt-2 flex items-center gap-3 text-sm text-muted-foreground">
						{#if usage.status}
							<span class="rounded-full bg-muted px-2 py-0.5 text-xs">
								{mediaUsageStatusLabel(usage.status)}
							</span>
						{/if}
						{#if usage.scheduled_at}
							<span
								>{new Date(usage.scheduled_at).toLocaleString(getLocaleTag(), {
									timeZone
								})}</span
							>
						{/if}
					</div>
				</div>
			{/each}
		{/if}
	{/if}
</div>
