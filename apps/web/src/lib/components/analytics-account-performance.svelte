<script lang="ts">
	import type { components } from '$lib/api/types';
	import { Button } from '$lib/components/ui/button';
	import SocialAccountIdentity from '$lib/components/social-account-identity.svelte';
	import SectionHeading from '$lib/components/section-heading.svelte';
	import { m } from '$lib/paraglide/messages';
	type Performance = components['schemas']['AccountPerformance'];
	let {
		items,
		onselect,
		formatValue
	}: {
		items: Performance[];
		onselect: (id: string) => void;
		formatValue: (value: number) => string;
	} = $props();
</script>

{#if items.length}
	<section aria-labelledby="analytics-performance-heading">
		<SectionHeading level={2} size="section" id="analytics-performance-heading"
			>{m.analytics_account_performance()}</SectionHeading
		>
		<div class="mt-3 divide-y divide-border rounded-xl border border-border">
			{#each items as item (item.account_id)}
				<div
					class="grid min-w-0 gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
					data-testid="analytics-account-performance"
				>
					<Button
						multiline
						variant="ghost"
						class="min-w-0 justify-start text-left"
						onclick={() => onselect(item.account_id)}
					>
						<SocialAccountIdentity
							name={item.username +
								(item.status === 'inactive' ? ` · ${m.settings_member_status_inactive()}` : '')}
							platform={item.platform}
							avatarUrl={item.avatar_url}
							size="sm"
						/>
					</Button>
					<dl class="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-4">
						<div>
							<dt class="text-muted-foreground">{m.analytics_visibility()}</dt>
							<dd class="mt-1 text-sm font-medium tabular-nums">
								{item.visibility.measured ? formatValue(item.visibility.value) : '—'}
							</dd>
						</div>
						<div>
							<dt class="text-muted-foreground">{m.analytics_summary_engagement()}</dt>
							<dd class="mt-1 text-sm font-medium tabular-nums">
								{item.engagement.measured ? formatValue(item.engagement.value) : '—'}
							</dd>
						</div>
						<div>
							<dt class="text-muted-foreground">{m.analytics_summary_followers()}</dt>
							<dd class="mt-1 text-sm font-medium tabular-nums">
								{item.followers === undefined
									? '—'
									: formatValue(item.followers)}{#if item.follower_delta !== undefined}<span
										class="ml-1 text-xs text-muted-foreground"
										>({item.follower_delta >= 0 ? '+' : ''}{formatValue(item.follower_delta)})</span
									>{/if}
							</dd>
						</div>
						<div>
							<dt class="text-muted-foreground">{m.analytics_distinct_posts()}</dt>
							<dd class="mt-1 text-sm font-medium tabular-nums">
								{formatValue(item.publication_count)}
							</dd>
							<dd class="mt-1 text-muted-foreground">
								{m.analytics_output_count({ count: item.published })}
							</dd>
						</div>
					</dl>
				</div>
			{/each}
		</div>
	</section>
{/if}
