<script lang="ts">
	import type { components } from '$lib/api/types';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import SectionHeading from '$lib/components/section-heading.svelte';
	import { hasEngagementMeasurement } from '$lib/analytics-overview';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import { m } from '$lib/paraglide/messages';
	type Content = components['schemas']['ContentOverview'];
	let {
		items,
		busy = false,
		canEdit = false,
		onrepurpose,
		formatValue
	}: {
		items: Content[];
		busy?: boolean;
		canEdit?: boolean;
		onrepurpose: (item: Content) => void;
		formatValue: (value: number) => string;
	} = $props();
</script>

{#if items.length}
	<section aria-labelledby="analytics-highlights-heading">
		<SectionHeading level={2} size="section" id="analytics-highlights-heading"
			>{m.analytics_top_posts()}</SectionHeading
		>
		<div class="mt-3 divide-y divide-border rounded-xl border border-border">
			{#each items as item, index (item.reference.publication_id || item.reference.rendition_id || index)}
				<article
					class="flex min-w-0 flex-wrap items-center gap-3 p-3"
					data-testid="analytics-highlight"
				>
					<PlatformIcon platform={item.platform} class="size-4 shrink-0" />
					<div class="min-w-0 flex-1 basis-40">
						{#if item.reference.publication_id}<a
								class="line-clamp-2 text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring"
								href={resolve('/publications/[id]', { id: item.reference.publication_id })}
								>{item.title || item.excerpt || m.analytics_untitled_publication()}</a
							>{:else}<p class="line-clamp-2 text-sm font-medium">
								{item.title || item.excerpt || m.analytics_untitled_publication()}
							</p>{/if}
						<p class="mt-1 text-xs text-muted-foreground">
							{m.analytics_visibility()}: {item.visibility
								? formatValue(item.visibility.value)
								: '—'} · {m.analytics_summary_engagement()}: {hasEngagementMeasurement(item)
								? formatValue(item.engagement)
								: '—'}
						</p>
					</div>
					<div class="flex flex-wrap gap-1">
						{#if item.external_url}<Button
								href={item.external_url}
								target="_blank"
								rel="noreferrer"
								variant="ghost"
								size="sm">{m.analytics_open_native()}</Button
							>{/if}
						{#if canEdit}<Button
								variant="outline"
								size="sm"
								disabled={busy}
								onclick={() => onrepurpose(item)}>{m.analytics_repurpose()}</Button
							>{/if}
					</div>
				</article>
			{/each}
		</div>
	</section>
{/if}
