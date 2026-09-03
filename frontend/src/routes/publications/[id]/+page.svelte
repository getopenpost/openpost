<script lang="ts">
	import { goto } from '$app/navigation';
	import { ThemeIcon, ProtectedIcon } from '$lib/themes/icons';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onDestroy } from 'svelte';
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
	import { publicationDraftCopy } from '$lib/composer/publication-client';
	import * as Sheet from '$lib/components/ui/sheet';
	import { ui } from '$lib/stores/ui.svelte';
	import { m } from '$lib/paraglide/messages';
	import { getLocaleTag } from '$lib/i18n';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { auth, type AuthIdentityToken } from '$lib/stores/auth';
	import { openPostQueryKeys, seedPublicationDetail } from '@openpost/query-catalog';
	import { queryClient } from '$lib/query/client';
	import {
		loadPublicationForWorkspace,
		PublicationWorkspaceMismatchError
	} from './publication-load';
	import {
		PublicationOperationScope,
		type PublicationOperation
	} from '../publication-operation-scope';

	type Publication = components['schemas']['PublicationResponse'];
	let publication = $state.raw<Publication | null>(null);
	let hasLoaded = $state(false);
	let error = $state('');
	let requestedPublicationKey = $state('');
	let publicationRequestSequence = 0;
	let historyOpen = $state(false);
	let retryingRenditionID = $state('');
	let recoveryMessage = $state('');
	let recoveryFailed = $state(false);
	let copying = $state(false);
	let copyError = $state('');
	let copyRequestKey = '';
	let recoveryRequestSequence = 0;
	let copyRequestSequence = 0;
	const operationScope = new PublicationOperationScope<AuthIdentityToken | undefined>();

	const publicationId = $derived(page.params.id);
	const initialWorkspaceId = $derived(page.url.searchParams.get('workspace_id'));
	const publicationWorkspaceId = $derived(
		initialWorkspaceId || workspaceCtx.currentWorkspace?.id || ''
	);
	const initialMediaIds = $derived(page.url.searchParams.getAll('media_id'));
	const readOnlyPublication = $derived(
		publication?.status === 'published' ||
			publication?.status === 'publishing' ||
			publication?.status === 'failed' ||
			publication?.renditions?.some((rendition) => rendition.delivery !== undefined)
	);

	type DetailOperation = PublicationOperation<AuthIdentityToken | undefined>;

	function captureDetailOperation(id: string, workspaceId: string): DetailOperation {
		return operationScope.capture(auth.captureIdentity(), workspaceId, id);
	}

	function actorIsCurrent(operation: DetailOperation) {
		return operationScope.actorIsCurrent(operation, (identity) => auth.isIdentityCurrent(identity));
	}

	function detailViewIsCurrent(operation: DetailOperation) {
		return operationScope.viewIsCurrent(operation, {
			workspaceId: publicationWorkspaceId,
			viewKey: publicationId,
			isIdentityCurrent: (identity) => auth.isIdentityCurrent(identity)
		});
	}

	function recoveryViewIsCurrent(operation: DetailOperation, requestSequence: number) {
		return requestSequence === recoveryRequestSequence && detailViewIsCurrent(operation);
	}

	function copyViewIsCurrent(operation: DetailOperation, requestSequence: number) {
		return requestSequence === copyRequestSequence && detailViewIsCurrent(operation);
	}

	function invalidatePublicationActivity(workspaceId: string) {
		ui.invalidatePublications({ workspaceId, scopes: ['activity'] }, { immediate: true });
	}

	async function reconcilePublicationRecovery(operation: DetailOperation) {
		if (!actorIsCurrent(operation)) return false;
		const queryKey = openPostQueryKeys.publications.detail(
			operation.workspaceId,
			operation.viewKey
		);
		await queryClient.cancelQueries({ queryKey, exact: true });
		if (!actorIsCurrent(operation)) return false;
		await queryClient.invalidateQueries({ queryKey, exact: true, refetchType: 'none' });
		if (!actorIsCurrent(operation)) return false;
		invalidatePublicationActivity(operation.workspaceId);
		return true;
	}

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

	async function loadPublication(id: string, workspaceId: string, force = false) {
		const requestSequence = ++publicationRequestSequence;
		const operation = captureDetailOperation(id, workspaceId);
		hasLoaded = false;
		error = '';
		try {
			if (!workspaceId) throw new Error(m.publication_edit_load_failed());
			const data = await loadPublicationForWorkspace(loadPublicationDetail, {
				publicationId: id,
				workspaceId,
				force,
				onWorkspaceMismatch: async () => {
					if (requestSequence === publicationRequestSequence && detailViewIsCurrent(operation)) {
						await goto(resolve('/publications'));
					}
				}
			});
			if (requestSequence !== publicationRequestSequence || !detailViewIsCurrent(operation)) return;
			publication = data;
		} catch (err) {
			if (requestSequence !== publicationRequestSequence || !detailViewIsCurrent(operation)) return;
			error =
				err instanceof PublicationWorkspaceMismatchError
					? m.publication_edit_load_failed()
					: err instanceof Error
						? err.message
						: m.publication_edit_load_failed();
			publication = null;
		} finally {
			if (requestSequence === publicationRequestSequence && detailViewIsCurrent(operation))
				hasLoaded = true;
		}
	}

	async function handleSuccess() {
		ui.triggerRefresh();
		await goto(resolve('/'));
	}

	async function retryRendition(renditionID: string) {
		const currentPublication = publication;
		const rendition = currentPublication?.renditions?.find((item) => item.id === renditionID);
		if (!currentPublication || !rendition) return;
		const operation = captureDetailOperation(
			currentPublication.id,
			currentPublication.workspace_id
		);
		const requestSequence = ++recoveryRequestSequence;
		retryingRenditionID = renditionID;
		recoveryMessage = '';
		recoveryFailed = false;
		try {
			const { error: retryError } = await client.POST(
				'/publications/{id}/renditions/{account_id}/retry',
				{
					params: {
						path: { id: currentPublication.id, account_id: rendition.social_account_id },
						query: { target_key: rendition.target_key }
					}
				}
			);
			if (retryError) throw new Error(m.publication_delivery_retry_failed());
			if (!(await reconcilePublicationRecovery(operation))) return;
			if (!recoveryViewIsCurrent(operation, requestSequence)) return;
			recoveryMessage = m.publication_delivery_retry_queued();
			await loadPublication(currentPublication.id, currentPublication.workspace_id, true);
		} catch {
			if (recoveryViewIsCurrent(operation, requestSequence)) {
				recoveryFailed = true;
				recoveryMessage = m.publication_delivery_retry_failed();
			}
		} finally {
			if (recoveryViewIsCurrent(operation, requestSequence)) retryingRenditionID = '';
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

	async function toggleFailureDismissal() {
		const currentPublication = publication;
		if (!currentPublication || currentPublication.status !== 'failed') return;
		const operation = captureDetailOperation(
			currentPublication.id,
			currentPublication.workspace_id
		);
		const requestSequence = ++recoveryRequestSequence;
		const wasDismissed = Boolean(currentPublication.failure_dismissed_at);
		retryingRenditionID = '';
		recoveryMessage = '';
		recoveryFailed = false;
		try {
			const response = wasDismissed
				? await client.DELETE('/publications/{id}/failure-dismissal', {
						params: { path: { id: currentPublication.id } }
					})
				: await client.POST('/publications/{id}/failure-dismissal', {
						params: { path: { id: currentPublication.id } }
					});
			if (response.error) throw new Error(m.activity_dismiss_failed_error());
			if (!(await reconcilePublicationRecovery(operation))) return;
			if (!recoveryViewIsCurrent(operation, requestSequence)) return;
			recoveryMessage = wasDismissed ? m.activity_restore_failed() : m.activity_dismissed_failed();
			await loadPublication(currentPublication.id, currentPublication.workspace_id, true);
		} catch {
			if (recoveryViewIsCurrent(operation, requestSequence)) {
				recoveryFailed = true;
				recoveryMessage = m.activity_dismiss_failed_error();
			}
		}
	}

	async function copyAsDraft() {
		const currentPublication = publication;
		if (!currentPublication || copying) return;
		const operation = captureDetailOperation(
			currentPublication.id,
			currentPublication.workspace_id
		);
		const requestSequence = ++copyRequestSequence;
		copying = true;
		copyError = '';
		// Reuse this key after an ambiguous response so a retry cannot create a second draft.
		copyRequestKey ||= crypto.randomUUID();
		try {
			const { data, error: createError } = await client.POST('/publications', {
				params: { header: { 'Idempotency-Key': copyRequestKey } },
				body: publicationDraftCopy(currentPublication)
			});
			if (createError || !data) {
				if (copyViewIsCurrent(operation, requestSequence)) {
					copyError = createError?.detail || m.publication_copy_failed();
				}
				return;
			}
			if (!actorIsCurrent(operation)) return;
			await Promise.all([
				queryClient.cancelQueries({
					queryKey: openPostQueryKeys.publications.detail(operation.workspaceId, data.id),
					exact: true
				}),
				queryClient.cancelQueries({
					queryKey: openPostQueryKeys.publications.list(operation.workspaceId)
				})
			]);
			if (!actorIsCurrent(operation)) return;
			seedPublicationDetail(queryClient, data, operation.workspaceId);
			ui.invalidatePublications(
				{
					workspaceId: operation.workspaceId,
					scopes: ['drafts', 'activity']
				},
				{ immediate: true }
			);
			if (!copyViewIsCurrent(operation, requestSequence)) return;
			await goto(resolve(`/publications/${data.id}`));
		} catch {
			if (copyViewIsCurrent(operation, requestSequence)) {
				copyError = m.publication_copy_failed();
			}
		} finally {
			if (copyViewIsCurrent(operation, requestSequence)) copying = false;
		}
	}

	$effect(() => {
		const requestKey = `${publicationWorkspaceId}:${publicationId}`;
		if (publicationId && publicationWorkspaceId && requestKey !== requestedPublicationKey) {
			operationScope.supersedeView();
			recoveryRequestSequence += 1;
			copyRequestSequence += 1;
			retryingRenditionID = '';
			recoveryMessage = '';
			recoveryFailed = false;
			copying = false;
			copyError = '';
			copyRequestKey = '';
			requestedPublicationKey = requestKey;
			loadPublication(publicationId, publicationWorkspaceId);
		}
	});

	onDestroy(() => {
		publicationRequestSequence += 1;
		recoveryRequestSequence += 1;
		copyRequestSequence += 1;
		operationScope.destroy();
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

{#snippet copyAsDraftButton()}
	<Button variant="outline" onclick={copyAsDraft} disabled={copying}>
		{#if copying}
			<ProtectedIcon icon="loading" class="mr-1.5 size-4 animate-spin" />
			{m.publication_copying()}
		{:else}
			<ThemeIcon role="copy" class="mr-1.5 size-4" />
			{m.publication_copy_as_draft()}
		{/if}
	</Button>
{/snippet}

{#if !hasLoaded}
	<div class="flex flex-1 flex-col" aria-busy="true">
		<PageLoading layout="composer" label={m.publication_edit_loading()} />
	</div>
{:else if error && !publication}
	<div class="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
		<InlineNotice tone="error" message={error}>
			{#snippet actions()}
				<Button
					size="sm"
					onclick={() =>
						publicationId &&
						publicationWorkspaceId &&
						loadPublication(publicationId, publicationWorkspaceId)}
				>
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
			{#if publication.status === 'failed'}
				<Button variant="outline" onclick={toggleFailureDismissal}>
					{publication.failure_dismissed_at
						? m.activity_restore_failed()
						: m.activity_dismiss_failed()}
				</Button>
			{/if}
			{@render copyAsDraftButton()}
			<Button variant="outline" onclick={() => history.back()}>
				<ThemeIcon role="arrow-left" class="mr-1.5 size-4" />
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
			{#if copyError}
				<InlineNotice tone="error" message={copyError} />
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

			<PublicationHistory
				publicationId={publication.id}
				workspaceId={publication.workspace_id}
				{retryingRenditionID}
				onRetry={retryRendition}
				onManualResolution={reviewDestination}
			/>
		</div>
	</PageContainer>
{:else if publication}
	<div class="flex flex-1 flex-col overflow-hidden">
		{#if copyError}
			<div class="shrink-0 px-3 pt-2 sm:px-4">
				<InlineNotice tone="error" message={copyError} />
			</div>
		{/if}
		<ComposeTextPost
			initialPublication={publication}
			{initialWorkspaceId}
			{initialMediaIds}
			onSuccess={handleSuccess}
			onDeleted={handleSuccess}
			onOpenVersionHistory={() => (historyOpen = true)}
			onCopyAsDraft={publication.status === 'scheduled' ? copyAsDraft : undefined}
			copyingDraft={copying}
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
					<PublicationHistory
						publicationId={publication.id}
						workspaceId={publication.workspace_id}
						headingLevel={3}
						showHeading={false}
						{retryingRenditionID}
						onRetry={retryRendition}
						onManualResolution={reviewDestination}
					/>
				</div>
			</Sheet.Content>
		</Sheet.Root>
	</div>
{/if}
