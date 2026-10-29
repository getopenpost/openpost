<script lang="ts">
	import type { components } from '$lib/api/types';
	import { Button } from '$lib/components/ui/button';
	import SocialAccountIdentity from '$lib/components/social-account-identity.svelte';
	import SectionHeading from '$lib/components/section-heading.svelte';
	import { m } from '$lib/paraglide/messages';
	type Takeaway = components['schemas']['Takeaway'];
	type Reference = components['schemas']['ContentReference'];
	let {
		items,
		busy = false,
		canEdit = false,
		onrepurpose,
		formatValue
	}: {
		items: Takeaway[];
		busy?: boolean;
		canEdit?: boolean;
		onrepurpose: (reference: Reference) => void;
		formatValue: (value: number) => string;
	} = $props();
	let expanded = $state(false);
	let desktop = $state(false);
	$effect(() => {
		const query = matchMedia('(min-width: 1024px)');
		const update = () => (desktop = query.matches);
		update();
		query.addEventListener('change', update);
		return () => query.removeEventListener('change', update);
	});
</script>

{#snippet actionCard(item: Takeaway)}
	<article
		class="flex min-w-0 flex-col gap-3 rounded-xl border border-border p-4"
		data-testid="analytics-takeaway"
	>
		<SocialAccountIdentity name={item.username} platform={item.platform} size="sm" />
		<div class="flex-1">
			<h3 class="text-sm font-medium">
				{item.kind === 'repurpose_post'
					? m.analytics_repurpose_candidate()
					: m.analytics_restore_measurements()}
			</h3>
			{#if item.title || item.excerpt}<p class="mt-1 line-clamp-2 text-sm font-medium">
					{item.title || item.excerpt}
				</p>{/if}
			<p class="mt-1 text-sm leading-5 text-muted-foreground">
				{item.kind === 'repurpose_post' && item.baseline !== undefined
					? m.analytics_repurpose_evidence({
							value: formatValue(item.value),
							baseline: formatValue(item.baseline),
							count: item.comparison_sample
						})
					: item.kind === 'repurpose_post'
						? `${m.analytics_summary_engagement()}: ${formatValue(item.value)}`
						: m.analytics_restore_description()}
			</p>
		</div>
		{#if canEdit && item.kind === 'repurpose_post' && item.reference}
			{@const reference = item.reference}
			<Button
				variant="outline"
				class="self-start"
				disabled={busy}
				onclick={() => onrepurpose(reference)}>{m.analytics_repurpose()}</Button
			>
		{:else if item.kind === 'restore_measurements'}
			<Button href="/settings?tab=accounts" variant="outline" class="self-start"
				>{m.feature_disabled_open_details()}</Button
			>
		{/if}
	</article>
{/snippet}
<section aria-labelledby="analytics-next-heading">
	<SectionHeading level={2} size="section" id="analytics-next-heading"
		>{m.analytics_next_actions()}</SectionHeading
	>
	{#if items.length}
		<div class="mt-3 grid gap-3 lg:grid-cols-3">
			{@render actionCard(items[0])}
			{#if items.length > 1}
				<details
					class="lg:contents"
					open={desktop || expanded}
					ontoggle={(event) => {
						if (!desktop) expanded = event.currentTarget.open;
					}}
				>
					<summary
						class="min-h-11 cursor-pointer rounded-md py-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
						>{m.analytics_more_actions()}</summary
					>
					<div class="grid gap-3 lg:contents">
						{#each items.slice(1) as item (`${item.kind}:${item.account_id}`)}{@render actionCard(
								item
							)}{/each}
					</div>
				</details>
			{/if}
		</div>
	{:else}
		<p class="mt-2 text-sm leading-5 text-muted-foreground">{m.analytics_no_takeaways()}</p>
	{/if}
</section>
