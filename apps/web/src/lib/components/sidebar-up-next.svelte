<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import { schedulingPublicationsQueryOptions } from '@openpost/query-catalog';
	import { schedulingQueryAPI } from '$lib/query/scheduling';
	import { queryClient } from '$lib/query/client';
	import { publicationInvalidationForWorkspace } from '$lib/publication-invalidation';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { m } from '$lib/paraglide/messages';
	import { getLocaleTag } from '$lib/i18n';

	let { onNavigate }: { onNavigate: (href: string) => void } = $props();

	const visibleCount = 3;
	const workspaceId = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const scheduledQuery = createQuery(() =>
		schedulingPublicationsQueryOptions(schedulingQueryAPI, workspaceId, {
			status: 'scheduled',
			limit: 50,
			allPages: true
		})
	);
	const scheduled = $derived(
		(scheduledQuery.data ?? [])
			.filter((publication) => publication.scheduled_at)
			.toSorted((left, right) => left.scheduled_at!.localeCompare(right.scheduled_at!))
	);

	let handledInvalidationRevision = 0;
	$effect(() => {
		const batch = ui.publicationInvalidations;
		if (batch.revision === 0 || batch.revision === handledInvalidationRevision) return;
		handledInvalidationRevision = batch.revision;
		const invalidation = publicationInvalidationForWorkspace(batch, workspaceId);
		if (!invalidation) return;
		if (!invalidation.scopes.some((scope) => scope === 'activity' || scope === 'calendar')) return;
		void queryClient.invalidateQueries({
			queryKey: schedulingPublicationsQueryOptions(schedulingQueryAPI, workspaceId, {
				status: 'scheduled',
				limit: 50,
				allPages: true
			}).queryKey,
			exact: true
		});
	});

	function startOfDay(value: Date) {
		return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
	}

	/** "Today 09:00", "Tomorrow 14:30", "Thu 09:00", then a short date. */
	function slotLabel(value: string) {
		const locale = getLocaleTag();
		const date = new Date(value);
		const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
		const days = Math.round((startOfDay(date) - startOfDay(new Date())) / 86_400_000);
		if (days === 0 || days === 1) {
			const day = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(days, 'day');
			return `${day.charAt(0).toLocaleUpperCase(locale)}${day.slice(1)} ${time}`;
		}
		if (days > 1 && days < 7) {
			return `${date.toLocaleDateString(locale, { weekday: 'short' })} ${time}`;
		}
		return `${date.toLocaleDateString(locale, { month: 'short', day: 'numeric' })} ${time}`;
	}

	function postTitle(publication: (typeof scheduled)[number]) {
		return (
			publication.source_text.trim() ||
			publication.title.trim() ||
			m.calendar_untitled_publication()
		);
	}
</script>

{#if scheduled.length > 0}
	<section class="shrink-0" aria-labelledby="sidebar-up-next-heading" data-testid="sidebar-up-next">
		<div class="mb-1 flex h-7 items-center justify-between px-2">
			<span
				id="sidebar-up-next-heading"
				class="flex items-center gap-1.5 text-xs font-medium text-sidebar-foreground/70"
			>
				{m.sidebar_up_next()}
				<span
					class="rounded-full bg-sidebar-accent px-1.5 text-xs leading-5 text-sidebar-foreground tabular-nums"
					aria-label={m.sidebar_scheduled_count({ count: scheduled.length })}
					>{scheduled.length}</span
				>
			</span>
			<button
				type="button"
				class="rounded-sm px-1.5 py-1 text-xs font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
				onclick={() => onNavigate('/publications?tab=scheduled')}
			>
				{m.sidebar_view_all()}
			</button>
		</div>
		<ul class="space-y-0.5">
			{#each scheduled.slice(0, visibleCount) as publication (publication.id)}
				{@const href = `/publications/${encodeURIComponent(publication.id)}`}
				<li>
					<a
						href={resolve(href as '/')}
						class={[
							'flex min-h-10 items-center gap-2.5 rounded-md px-2 py-1 hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none',
							page.url.pathname === href && 'bg-sidebar-accent/60'
						]}
					>
						<span class="h-7 w-0.5 shrink-0 rounded-full bg-primary/70" aria-hidden="true"></span>
						<span class="min-w-0 flex-1">
							<span class="block truncate text-xs leading-5 font-medium text-sidebar-foreground/88"
								>{postTitle(publication)}</span
							>
							<time
								datetime={publication.scheduled_at}
								class="block text-xs leading-4 text-sidebar-foreground/70 tabular-nums"
								>{slotLabel(publication.scheduled_at!)}</time
							>
						</span>
					</a>
				</li>
			{/each}
		</ul>
	</section>
{/if}
