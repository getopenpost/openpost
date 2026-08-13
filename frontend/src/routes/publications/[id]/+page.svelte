<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { loadPublicationDetail } from '$lib/api/performance-cache';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { Button } from '$lib/components/ui/button';
	import PageLoading from '$lib/components/page-loading.svelte';
	import PageContainer from '$lib/components/page-container.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PublicationDeliveryCard from '$lib/components/publication-delivery-card.svelte';
	import PublicationHistory from '$lib/components/publication-history.svelte';
	import ComposeTextPost from '$lib/components/compose-text-post.svelte';
	import * as Sheet from '$lib/components/ui/sheet';
	import { ui } from '$lib/stores/ui.svelte';
	import { m } from '$lib/paraglide/messages';
	import { getLocaleTag } from '$lib/i18n';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import HistoryIcon from '@lucide/svelte/icons/history';

	type Publication = components['schemas']['PublicationResponse'];
	let publication = $state.raw<Publication | null>(null);
	let hasLoaded = $state(false);
	let error = $state('');
	let requestedPublicationId = $state('');
	let publicationRequestSequence = 0;
	let historyOpen = $state(false);
	let retryingRenditionID = $state('');
	let recoveryMessage = $state('');
	let recoveryFailed = $state(false);

	const publicationId = $derived(page.params.id);
	const readOnlyPublication = $derived(
		publication?.status === 'published' ||
			publication?.status === 'publishing' ||
			publication?.status === 'failed' ||
			publication?.renditions?.some((rendition) => rendition.delivery !== undefined)
	);

	function statusLabel(status: string) {
		if (status === 'published') return m.activity_status_published();
		if (status === 'publishing') return m.activity_status_publishing();
		if (status === 'failed') return m.activity_status_failed();
		if (status === 'scheduled') return m.activity_status_scheduled();
		return m.activity_status_draft();
	}

	function formatDateTime(value: string) {
		return new Intl.DateTimeFormat(getLocaleTag(), {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(value));
	}

	async function loadPublication(id: string, force = false) {
		const requestSequence = ++publicationRequestSequence;
		hasLoaded = false;
		error = '';
		try {
			const data = await loadPublicationDetail(id, force);
			if (requestSequence !== publicationRequestSequence || publicationId !== id) return;
			publication = data;
		} catch (err) {
			if (requestSequence !== publicationRequestSequence || publicationId !== id) return;
			error = err instanceof Error ? err.message : m.publication_edit_load_failed();
			publication = null;
		} finally {
			if (requestSequence === publicationRequestSequence && publicationId === id) hasLoaded = true;
		}
	}

	async function handleSuccess() {
		ui.triggerRefresh();
		goto(resolve('/'));
	}

	async function retryRendition(renditionID: string) {
		const rendition = publication?.renditions?.find((item) => item.id === renditionID);
		if (!publication || !rendition) return;
		retryingRenditionID = renditionID;
		recoveryMessage = '';
		recoveryFailed = false;
		try {
			const { error: retryError } = await client.POST(
				'/publications/{id}/renditions/{account_id}/retry',
				{
					params: {
						path: { id: publication.id, account_id: rendition.social_account_id },
						query: { target_key: rendition.target_key }
					}
				}
			);
			if (retryError) throw new Error(m.publication_delivery_retry_failed());
			recoveryMessage = m.publication_delivery_retry_queued();
			await loadPublication(publication.id, true);
		} catch {
			recoveryFailed = true;
			recoveryMessage = m.publication_delivery_retry_failed();
		} finally {
			retryingRenditionID = '';
		}
	}

	async function reviewDestination(renditionID: string) {
		const accountID = publication?.renditions?.find(
			(rendition) => rendition.id === renditionID
		)?.social_account_id;
		await goto(
			resolve(
				accountID ? `/settings?tab=accounts&account_id=${accountID}` : '/settings?tab=accounts'
			)
		);
	}

	$effect(() => {
		if (publicationId && publicationId !== requestedPublicationId) {
			requestedPublicationId = publicationId;
			loadPublication(publicationId);
		}
	});
</script>

<svelte:head>
	<title
		>{publication
			? readOnlyPublication
				? m.publication_detail_title()
				: m.publication_edit_title()
			: m.publication_edit_loading_title()} - {m.common_openpost()}</title
	>
</svelte:head>

{#if !hasLoaded}
	<div class="flex flex-1 flex-col" aria-busy="true">
		<PageLoading layout="composer" label={m.publication_edit_loading()} />
	</div>
{:else if error && !publication}
	<div class="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
		<InlineNotice tone="error" message={error}>
			{#snippet actions()}
				<Button size="sm" onclick={() => publicationId && loadPublication(publicationId)}>
					{m.common_retry()}
				</Button>
				<Button variant="outline" size="sm" onclick={() => goto(resolve('/'))}>
					{m.common_back()}
				</Button>
			{/snippet}
		</InlineNotice>
	</div>
{:else if publication && readOnlyPublication}
	<PageContainer
		title={publication.title || m.publication_detail_title()}
		description={m.publication_detail_description({ status: statusLabel(publication.status) })}
	>
		{#snippet actions()}
			<Button variant="outline" onclick={() => history.back()}>
				<ArrowLeftIcon class="mr-1.5 size-4" />
				{m.common_back()}
			</Button>
		{/snippet}

		<div class="space-y-6">
			{#if publication.status !== 'failed'}
				<InlineNotice tone="info" message={m.publication_published_editing_explanation()} />
			{/if}
			{#if recoveryMessage}
				<InlineNotice tone={recoveryFailed ? 'error' : 'info'} message={recoveryMessage} />
			{/if}

			<section class="rounded-xl border bg-card p-4 sm:p-6">
				<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
					<span class="font-medium text-foreground">{statusLabel(publication.status)}</span>
					<span>·</span>
					<span>{formatDateTime(publication.actual_run_at || publication.updated_at)}</span>
				</div>
				<div class="mt-4 space-y-4">
					{#if publication.source_text}
						<p class="max-w-3xl leading-7 whitespace-pre-wrap">{publication.source_text}</p>
					{/if}
					{#each publication.segments ?? [] as segment (segment.id)}
						<div class="max-w-3xl border-t pt-4">
							{#if segment.title}<h2 class="font-semibold">{segment.title}</h2>{/if}
							{#if segment.body}<p class="mt-2 leading-7 whitespace-pre-wrap">
									{segment.body}
								</p>{/if}
						</div>
					{/each}
				</div>
			</section>

			<section aria-labelledby="publication-destinations-heading">
				<h2 id="publication-destinations-heading" class="mb-3 text-base font-semibold">
					{m.publication_destinations_heading()}
				</h2>
				<div class="grid gap-3 sm:grid-cols-2">
					{#each publication.renditions ?? [] as rendition (rendition.id)}
						<PublicationDeliveryCard
							{rendition}
							retrying={retryingRenditionID === rendition.id}
							onRetry={retryRendition}
							onManualResolution={reviewDestination}
						/>
					{/each}
				</div>
			</section>

			<PublicationHistory publicationId={publication.id} />
		</div>
	</PageContainer>
{:else if publication}
	<div class="flex flex-1 flex-col overflow-hidden">
		<div class="flex shrink-0 justify-end border-b px-3 py-2 sm:px-4">
			<Button variant="ghost" size="sm" onclick={() => (historyOpen = true)}>
				<HistoryIcon class="mr-1.5 size-4" />
				{m.image_editor_version_history()}
			</Button>
		</div>
		<ComposeTextPost
			initialPublication={publication}
			onSuccess={handleSuccess}
			onDeleted={handleSuccess}
		/>
		<Sheet.Root bind:open={historyOpen}>
			<Sheet.Content
				side="right"
				class="w-full! gap-0 overflow-hidden p-0 sm:max-w-lg!"
				data-testid="publication-history-drawer"
			>
				<Sheet.Header class="shrink-0 border-b px-4 py-3 pr-14 text-left">
					<Sheet.Title>{m.image_editor_version_history()}</Sheet.Title>
				</Sheet.Header>
				<div
					class="min-h-0 flex-1 overflow-y-auto px-4 py-4"
					data-testid="publication-history-scroll"
				>
					<PublicationHistory publicationId={publication.id} headingLevel={3} showHeading={false} />
				</div>
			</Sheet.Content>
		</Sheet.Root>
	</div>
{/if}
