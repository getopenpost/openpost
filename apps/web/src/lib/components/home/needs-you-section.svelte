<script lang="ts">
	import { resolveAppPath } from '$lib/app-path';
	import { ThemeIcon } from '$lib/themes/icons';
	import type { ThemeIconRole } from '$lib/themes/contracts.js';
	import { m } from '$lib/paraglide/messages';

	export interface PendingReview {
		id: string;
		title: string;
	}

	interface Props {
		failedCount?: number;
		unreadReplies?: number;
		unreadMessages?: number;
		disconnectedCount?: number;
		pendingReviews?: PendingReview[];
	}

	let {
		failedCount = 0,
		unreadReplies = 0,
		unreadMessages = 0,
		disconnectedCount = 0,
		pendingReviews = []
	}: Props = $props();

	interface AttentionRow {
		id: string;
		icon: ThemeIconRole;
		label: string;
		href: string;
	}

	const rows = $derived.by(() => {
		const list: AttentionRow[] = [];
		if (failedCount > 0) {
			list.push({
				id: 'failed',
				icon: 'publications',
				label:
					failedCount === 1
						? m.home_needs_failed_one()
						: m.home_needs_failed({ count: failedCount }),
				href: resolveAppPath('/publications?tab=failed')
			});
		}
		if (unreadReplies > 0) {
			list.push({
				id: 'replies',
				icon: 'inbox',
				label:
					unreadReplies === 1
						? m.home_needs_replies_one()
						: m.home_needs_replies({ count: unreadReplies }),
				href: resolveAppPath('/inbox/engagement')
			});
		}
		if (unreadMessages > 0) {
			list.push({
				id: 'messages',
				icon: 'mail',
				label:
					unreadMessages === 1
						? m.home_needs_messages_one()
						: m.home_needs_messages({ count: unreadMessages }),
				href: resolveAppPath('/inbox/messages')
			});
		}
		for (const review of pendingReviews.slice(0, 3)) {
			list.push({
				id: `review-${review.id}`,
				icon: 'communications',
				label: review.title.trim() || m.home_needs_approval_badge(),
				href: resolveAppPath(`/publications/${encodeURIComponent(review.id)}`)
			});
		}
		if (disconnectedCount > 0) {
			list.push({
				id: 'disconnected',
				icon: 'unlink',
				label:
					disconnectedCount === 1
						? m.home_needs_disconnected_one()
						: m.home_needs_disconnected({ count: disconnectedCount }),
				href: resolveAppPath('/accounts')
			});
		}
		return list;
	});
</script>

{#if rows.length > 0}
	<section aria-labelledby="home-needs-you-heading" data-testid="home-needs-you">
		<h2 id="home-needs-you-heading" class="text-sm font-medium text-muted-foreground">
			{m.home_section_needs_you()}
		</h2>
		<ul class="mt-2 divide-y rounded-lg border">
			{#each rows as row (row.id)}
				<li>
					<a
						href={row.href}
						class="flex min-h-11 items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
					>
						<ThemeIcon role={row.icon} class="size-4 shrink-0 text-muted-foreground" />
						<span class="min-w-0 flex-1 truncate">{row.label}</span>
						<ThemeIcon
							role="chevron-right"
							class="size-4 shrink-0 text-muted-foreground"
							aria-hidden="true"
						/>
					</a>
				</li>
			{/each}
		</ul>
	</section>
{/if}
