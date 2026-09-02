<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { resolveAppPath } from '$lib/app-path';
	import {
		queryImageEditorBrandKit,
		queryImageEditorConfig,
		queryImageEditorDesign
	} from '$lib/query/image-editor';
	import { queryClient } from '$lib/query/client';
	import { imageEditorQueryKeys, type ImageEditorConfig } from '@openpost/query-catalog';
	import { loadImageEditorBrandFonts } from '$lib/image-editor/fonts';
	import { migrateGuestImageEditorDesign } from '$lib/image-editor/guest-migration';
	import {
		isLocalImageEditorDesignID,
		loadGuestImageEditorDesign
	} from '$lib/image-editor/local-persistence';
	import { trackPublicImageEditorEvent } from '$lib/image-editor/public-telemetry';
	import { migrateImageEditorDocument } from '$lib/image-editor/document';
	import type { ImageEditorBrandKit, ImageEditorDocumentResponse } from '$lib/image-editor/types';
	import ImageEditorShell from '$lib/image-editor/components/image-editor-shell.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import { Button } from '$lib/components/ui/button';
	import { auth } from '$lib/stores/auth';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import { m } from '$lib/paraglide/messages';
	import { startImageEditorMetric } from '$lib/image-editor/telemetry';
	import { editorHandoffReturnURL } from '$lib/editor-handoff';

	let design = $state.raw<ImageEditorDocumentResponse | null>(null);
	let backgroundModelBaseURL = $state('/image-editor-models');
	let loading = $state(true);
	let refreshing = $state(false);
	let error = $state('');
	let backgroundError = $state('');
	let readOnlyReason = $state('');
	let brandKit = $state.raw<ImageEditorBrandKit | null>(null);
	let guestMode = $state(false);
	let migrationBusy = $state(false);
	let loadRequest = 0;
	let returnToken = $derived(page.url.searchParams.get('return_token') || '');
	let cancelledReturnURL = $derived(
		returnToken ? editorHandoffReturnURL(returnToken, 'image', 'cancelled') : null
	);
	let initialAction = $derived(page.url.searchParams.get('action') || '');
	let authState = $derived($auth);

	$effect(() => {
		const designID = page.params.id ?? '';
		const request = ++loadRequest;
		untrack(() => {
			void initialize(designID, request);
		});
	});

	async function initialize(designID: string, request: number): Promise<void> {
		const finishMetric = startImageEditorMetric('document_load');
		error = '';
		backgroundError = '';
		guestMode = isLocalImageEditorDesignID(designID);
		if (design?.id !== designID) {
			readOnlyReason = '';
			brandKit = null;
			design = null;
		}
		loading = !design;
		refreshing = Boolean(design);
		try {
			if (!guestMode) hydrateCachedDesign(designID, workspaceCtx.currentWorkspace?.id ?? '');
			loading = !design;
			refreshing = Boolean(design);
			const configPromise = queryImageEditorConfig();
			if (!guestMode) await workspaceCtx.initialize();
			const requestedWorkspaceID = workspaceCtx.currentWorkspace?.id ?? '';
			if (!guestMode && !requestedWorkspaceID) throw new Error(m.image_editor_open_failed());
			if (!guestMode && !design) {
				hydrateCachedDesign(designID, requestedWorkspaceID);
				loading = !design;
				refreshing = Boolean(design);
			}
			const [config, response, initialBrand] = await Promise.all([
				configPromise,
				guestMode
					? loadGuestImageEditorDesign(designID)
					: queryImageEditorDesign(requestedWorkspaceID, designID),
				guestMode ? Promise.resolve(null) : queryImageEditorBrandKit(requestedWorkspaceID)
			]);
			if (request !== loadRequest) return;
			if (!config.enabled) throw new Error(m.image_editor_not_enabled());
			applyImageEditorConfig(config);
			const brand = guestMode
				? null
				: response.workspace_id === requestedWorkspaceID
					? initialBrand
					: await queryImageEditorBrandKit(response.workspace_id);
			if (brand) await loadImageEditorBrandFonts(brand);
			if (request !== loadRequest) return;
			presentDesign(response, brand);
			finishMetric();
		} catch (cause) {
			if (request !== loadRequest) return;
			finishMetric('error');
			const message = cause instanceof Error ? cause.message : m.image_editor_open_failed();
			if (design?.id === designID) backgroundError = message;
			else error = message;
		} finally {
			if (request === loadRequest) {
				loading = false;
				refreshing = false;
			}
		}
	}

	function hydrateCachedDesign(designID: string, workspaceID: string): void {
		const cachedConfig = queryClient.getQueryData<ImageEditorConfig>(imageEditorQueryKeys.config());
		if (cachedConfig) applyImageEditorConfig(cachedConfig);
		if (!workspaceID) return;
		const cachedDesign = queryClient.getQueryData<ImageEditorDocumentResponse>(
			imageEditorQueryKeys.design(workspaceID, designID)
		);
		if (!cachedDesign) return;
		const cachedBrand = queryClient.getQueryData<ImageEditorBrandKit>(
			imageEditorQueryKeys.brandKit(cachedDesign.workspace_id)
		);
		presentDesign(cachedDesign, cachedBrand ?? null);
		if (cachedBrand) void loadImageEditorBrandFonts(cachedBrand);
	}

	function applyImageEditorConfig(config: ImageEditorConfig): void {
		backgroundModelBaseURL = config.background_model_base_url || '/image-editor-models';
	}

	function presentDesign(
		response: ImageEditorDocumentResponse,
		brand: ImageEditorBrandKit | null
	): void {
		const migration = migrateImageEditorDocument(response.document);
		if (!migration.document) throw new Error(migration.error || m.image_editor_invalid_document());
		readOnlyReason = migration.readOnly
			? migration.error || m.image_editor_document_read_only()
			: '';
		brandKit = brand;
		design = {
			...response,
			can_edit: migration.readOnly ? false : response.can_edit,
			document: migration.document
		};
	}

	function retryCurrentDesign(): void {
		const request = ++loadRequest;
		void initialize(page.params.id ?? '', request);
	}

	$effect(() => {
		if (
			!design ||
			!guestMode ||
			authState.isLoading ||
			!authState.isAuthenticated ||
			page.url.searchParams.get('import') !== '1' ||
			migrationBusy
		) {
			return;
		}
		void saveToOpenPost();
	});

	async function saveToOpenPost(): Promise<void> {
		if (!design || migrationBusy) return;
		if (!authState.isAuthenticated) {
			const returnURL = new URL(page.url);
			returnURL.searchParams.set('import', '1');
			trackPublicImageEditorEvent('image_editor_signup_clicked', { source: 'editor' });
			await goto(
				resolveAppPath(
					`/register?redirect=${encodeURIComponent(returnURL.pathname + returnURL.search)}`
				)
			);
			return;
		}
		migrationBusy = true;
		error = '';
		backgroundError = '';
		try {
			await workspaceCtx.initialize();
			const workspaceID = workspaceCtx.currentWorkspace?.id;
			if (!workspaceID) {
				const returnURL = `${page.url.pathname}?import=1`;
				await goto(resolveAppPath(`/onboarding?redirect=${encodeURIComponent(returnURL)}`));
				return;
			}
			const migrated = await migrateGuestImageEditorDesign(design.id, workspaceID);
			if (!migrated.alreadyMigrated) {
				trackPublicImageEditorEvent('image_editor_workspace_import_completed', {
					source: 'editor'
				});
			}
			await goto(resolveAppPath(`/image-editor/${migrated.id}`));
		} catch (cause) {
			backgroundError =
				cause instanceof Error ? cause.message : m.image_editor_public_import_failed();
		} finally {
			migrationBusy = false;
		}
	}
</script>

<svelte:head><title>{design?.document.title ?? m.image_editor_title()}</title></svelte:head>

{#if loading || migrationBusy}
	<div class="flex h-dvh items-center justify-center bg-background text-foreground">
		<LoaderIcon class="mr-2 size-5 animate-spin" />
		{m.image_editor_public_importing()}
	</div>
{:else if loading && !design}
	<div class="image-editor-theme h-dvh overflow-hidden bg-neutral-900 p-4 text-neutral-200">
		<div class="mx-auto w-full max-w-5xl pt-14">
			<PageLoading layout="composer" label={m.image_editor_load()} items={3} />
		</div>
	</div>
{:else if error || !design}
	<div class="flex h-dvh items-center justify-center bg-background p-4">
		<div class="w-full max-w-md rounded-xl border bg-card p-6 text-center">
			<h1 class="text-lg font-semibold">{m.image_editor_open_failed_title()}</h1>
			<InlineNotice
				tone="error"
				message={error || m.image_editor_open_failed()}
				class="mt-4 text-left"
			>
				{#snippet actions()}
					<Button variant="outline" size="sm" onclick={retryCurrentDesign}>
						{m.common_retry()}
					</Button>
				{/snippet}
			</InlineNotice>
			<a
				href={resolveAppPath(cancelledReturnURL ?? (guestMode ? '/image-editor' : '/media'))}
				class="mt-5 inline-flex text-sm font-medium text-primary hover:underline"
			>
				{cancelledReturnURL
					? m.editor_back_to_post()
					: guestMode
						? m.image_editor_public_return()
						: m.image_editor_return_media()}
			</a>
		</div>
	</div>
{:else}
	<div class="image-editor-theme relative h-dvh overflow-hidden">
		{#if refreshing}
			<span class="sr-only" role="status">{m.image_editor_load()}</span>
		{/if}
		{#if backgroundError}
			<InlineNotice
				tone="warning"
				message={backgroundError}
				class="fixed top-14 left-1/2 z-[100] w-[calc(100%-1.5rem)] max-w-xl -translate-x-1/2 bg-popover shadow-md sm:top-3"
				dismissLabel={m.common_close()}
				onDismiss={() => (backgroundError = '')}
			>
				{#snippet actions()}
					<Button variant="outline" size="sm" onclick={retryCurrentDesign}>
						{m.common_retry()}
					</Button>
				{/snippet}
			</InlineNotice>
		{/if}
		<ImageEditorShell
			initial={design}
			{returnToken}
			{backgroundModelBaseURL}
			{initialAction}
			{readOnlyReason}
			initialBrandKit={brandKit}
			{guestMode}
			onSaveToOpenPost={saveToOpenPost}
		/>
	</div>
{/if}
