<script lang="ts">
	import { client } from '$lib/api/client';
	import { Button } from '$lib/components/ui/button';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import { getLocaleTag } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { getPlatformName } from '$lib/utils';
	import { untrack } from 'svelte';
	import CheckIcon from '@lucide/svelte/icons/circle-check';
	import ClockIcon from '@lucide/svelte/icons/clock-3';
	import HistoryIcon from '@lucide/svelte/icons/history';
	import XIcon from '@lucide/svelte/icons/circle-x';

	type HistoryActor = {
		kind: 'user' | 'automation' | 'system';
		name?: string;
		origin?: string;
	};

	type HistoryError = {
		message?: string;
		kind?: string;
		code?: string;
		http_status?: number;
		retryable: boolean;
		action?: string;
	};

	type PublicationHistoryEvent = {
		id: string;
		type: string;
		status: string;
		summary: string;
		actor: HistoryActor;
		platform?: string;
		changed_domains?: string[];
		revision?: number;
		scheduled_at?: string;
		destination_count?: number;
		error?: HistoryError;
		created_at: string;
	};

	let {
		publicationId,
		headingLevel = 2,
		showHeading = true
	}: { publicationId: string; headingLevel?: 2 | 3; showHeading?: boolean } = $props();
	let events = $state.raw<PublicationHistoryEvent[]>([]);
	let nextCursor = $state('');
	let loading = $state(true);
	let loadingMore = $state(false);
	let error = $state('');
	let requestedPublicationId = '';
	let requestSequence = 0;

	$effect(() => {
		const id = publicationId;
		if (!id || id === requestedPublicationId) return;
		untrack(() => {
			requestedPublicationId = id;
			events = [];
			nextCursor = '';
			void loadHistory(id, '', false);
		});
	});

	async function loadHistory(id: string, cursor: string, append: boolean) {
		const request = ++requestSequence;
		if (append) loadingMore = true;
		else loading = true;
		error = '';
		try {
			const query = { limit: 30, ...(cursor ? { cursor } : {}) };
			const response = await client.GET('/publications/{id}/events', {
				params: { path: { id }, query }
			});
			if (response.error || !response.data) {
				throw new Error(response.error?.detail || m.activity_failed_load());
			}
			if (request !== requestSequence || publicationId !== id) return;
			const page = response.data as unknown as PublicationHistoryEvent[];
			if (append) {
				const existingIDs = new Set(events.map((event) => event.id));
				events = [...events, ...page.filter((event) => !existingIDs.has(event.id))];
			} else {
				events = page;
			}
			nextCursor = response.response.headers.get('X-Next-Cursor') ?? '';
		} catch (cause) {
			if (request !== requestSequence || publicationId !== id) return;
			error = cause instanceof Error ? cause.message : m.activity_failed_load();
		} finally {
			if (request === requestSequence) {
				loading = false;
				loadingMore = false;
			}
		}
	}

	function actorLabel(actor: HistoryActor) {
		if (actor.name) return actor.name;
		if (actor.kind === 'system') return m.sidebar_appearance_system();
		return actor.origin?.toUpperCase() || m.sidebar_appearance_system();
	}

	function exactDateTime(value: string) {
		return new Intl.DateTimeFormat(getLocaleTag(), {
			dateStyle: 'full',
			timeStyle: 'long',
			timeZone: workspaceCtx.settings.timezone || 'UTC'
		}).format(new Date(value));
	}

	function statusTone(status: string) {
		if (status === 'failed') return 'text-destructive bg-destructive/10';
		if (status === 'succeeded') return 'text-emerald-700 bg-emerald-500/10 dark:text-emerald-300';
		return 'text-muted-foreground bg-muted';
	}

	function eventDetails(event: PublicationHistoryEvent) {
		const details: string[] = [];
		if (event.changed_domains?.length) {
			details.push(m.draft_conflict_changed({ domains: event.changed_domains.join(', ') }));
		}
		if (event.revision) details.push(m.media_brand_revision({ revision: event.revision }));
		if (event.destination_count) {
			details.push(m.day_posts_destination_count({ count: event.destination_count }));
		}
		return details;
	}

	function errorActionLabel(action?: string) {
		switch (action) {
			case 'retry':
				return m.activity_retry_destination();
			case 'reconnect':
				return m.activity_reconnect_account();
			case 'billing':
				return m.activity_open_billing();
			case 'open_provider':
				return m.activity_review_account();
			default:
				return '';
		}
	}
</script>

<section
	aria-labelledby={showHeading ? `publication-history-${publicationId}` : undefined}
	aria-label={!showHeading ? m.image_editor_version_history() : undefined}
>
	{#if showHeading}
		<div class="mb-3 flex items-center gap-2">
			<HistoryIcon class="size-4 text-muted-foreground" />
			{#if headingLevel === 3}
				<h3 id={`publication-history-${publicationId}`} class="text-base font-semibold">
					{m.image_editor_version_history()}
				</h3>
			{:else}
				<h2 id={`publication-history-${publicationId}`} class="text-base font-semibold">
					{m.image_editor_version_history()}
				</h2>
			{/if}
		</div>
	{/if}

	{#if loading}
		<PageLoading layout="list" label={m.common_loading()} items={3} />
	{:else if error && events.length === 0}
		<InlineNotice tone="error" message={error}>
			{#snippet actions()}
				<Button size="sm" variant="outline" onclick={() => loadHistory(publicationId, '', false)}>
					{m.common_retry()}
				</Button>
			{/snippet}
		</InlineNotice>
	{:else}
		{#if error}
			<InlineNotice tone="error" message={error} class="mb-3" />
		{/if}
		<ol class="relative space-y-0 border-l border-border pl-5">
			{#each events as event (event.id)}
				<li class="relative pb-5 last:pb-0">
					<span
						class={[
							'absolute top-0.5 -left-[1.7rem] flex size-5 items-center justify-center rounded-full ring-4 ring-background',
							statusTone(event.status)
						]}
						aria-hidden="true"
					>
						{#if event.status === 'failed'}
							<XIcon class="size-3" />
						{:else if event.status === 'succeeded'}
							<CheckIcon class="size-3" />
						{:else}
							<ClockIcon class="size-3" />
						{/if}
					</span>
					<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
						<p class="text-sm font-medium">{event.summary}</p>
						{#if event.platform}
							<span class="inline-flex items-center gap-1 text-xs text-muted-foreground">
								<PlatformIcon platform={event.platform} class="size-3.5" />
								{getPlatformName(event.platform)}
							</span>
						{/if}
					</div>
					<p class="mt-1 text-xs text-muted-foreground">
						<span>{actorLabel(event.actor)}</span>
						<span aria-hidden="true"> · </span>
						<time datetime={event.created_at} title={new Date(event.created_at).toISOString()}>
							{exactDateTime(event.created_at)}
						</time>
					</p>
					{#if eventDetails(event).length > 0}
						<p class="mt-1 text-xs text-muted-foreground">{eventDetails(event).join(' · ')}</p>
					{/if}
					{#if event.scheduled_at}
						<p class="mt-1 text-xs text-muted-foreground">
							{m.activity_report_scheduled()}:
							<time
								datetime={event.scheduled_at}
								title={new Date(event.scheduled_at).toISOString()}
							>
								{exactDateTime(event.scheduled_at)}
							</time>
						</p>
					{/if}
					{#if event.error}
						<p class="mt-2 text-sm text-destructive">
							{event.error.message ||
								event.error.code ||
								event.error.kind ||
								m.activity_unknown_failure()}
						</p>
						{#if errorActionLabel(event.error.action)}
							<p class="mt-1 text-xs font-medium text-destructive">
								{errorActionLabel(event.error.action)}
							</p>
						{/if}
					{/if}
				</li>
			{/each}
		</ol>
		{#if nextCursor}
			<div class="mt-4 flex justify-center">
				<Button
					variant="outline"
					size="sm"
					disabled={loadingMore}
					onclick={() => loadHistory(publicationId, nextCursor, true)}
				>
					{loadingMore ? m.notifications_loading_more() : m.notifications_load_more()}
				</Button>
			</div>
		{/if}
	{/if}
</section>
