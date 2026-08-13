<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		loadImageEditorBrandKit,
		loadImageEditorConfig,
		loadImageEditorDesign
	} from '$lib/image-editor/api';
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
	import { auth } from '$lib/stores/auth';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import { m } from '$lib/paraglide/messages';
	import { startImageEditorMetric } from '$lib/image-editor/telemetry';
	import { editorHandoffReturnURL } from '$lib/editor-handoff';

	let design = $state.raw<ImageEditorDocumentResponse | null>(null);
	let backgroundModelBaseURL = $state('/image-editor-models');
	let loading = $state(true);
	let error = $state('');
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
		void initialize(designID, request);
	});

	async function initialize(designID: string, request: number): Promise<void> {
		const finishMetric = startImageEditorMetric('document_load');
		loading = true;
		error = '';
		readOnlyReason = '';
		brandKit = null;
		design = null;
		guestMode = isLocalImageEditorDesignID(designID);
		try {
			const [config, response] = await Promise.all([
				loadImageEditorConfig(),
				guestMode ? loadGuestImageEditorDesign(designID) : loadImageEditorDesign(designID)
			]);
			if (request !== loadRequest) return;
			if (!config.enabled) throw new Error(m.image_editor_not_enabled());
			backgroundModelBaseURL = config.background_model_base_url || '/image-editor-models';
			const migration = migrateImageEditorDocument(response.document);
			if (!migration.document)
				throw new Error(migration.error || m.image_editor_invalid_document());
			response.document = migration.document;
			if (migration.readOnly) {
				response.can_edit = false;
				readOnlyReason = migration.error || m.image_editor_document_read_only();
			}
			const brand = guestMode ? null : await loadImageEditorBrandKit(response.workspace_id);
			if (brand) await loadImageEditorBrandFonts(brand);
			if (request !== loadRequest) return;
			brandKit = brand;
			design = response;
			finishMetric();
		} catch (cause) {
			if (request !== loadRequest) return;
			finishMetric('error');
			error = cause instanceof Error ? cause.message : m.image_editor_open_failed();
		} finally {
			if (request === loadRequest) loading = false;
		}
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
				resolve(
					`/register?redirect=${encodeURIComponent(returnURL.pathname + returnURL.search)}` as '/'
				)
			);
			return;
		}
		migrationBusy = true;
		error = '';
		try {
			await workspaceCtx.initialize();
			const workspaceID = workspaceCtx.currentWorkspace?.id;
			if (!workspaceID) {
				const returnURL = `${page.url.pathname}?import=1`;
				await goto(resolve(`/onboarding?redirect=${encodeURIComponent(returnURL)}` as '/'));
				return;
			}
			const migrated = await migrateGuestImageEditorDesign(design.id, workspaceID);
			if (!migrated.alreadyMigrated) {
				trackPublicImageEditorEvent('image_editor_workspace_import_completed', {
					source: 'editor'
				});
			}
			await goto(resolve(`/image-editor/${migrated.id}` as '/'));
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.image_editor_public_import_failed();
		} finally {
			migrationBusy = false;
		}
	}
</script>

<svelte:head><title>{design?.document.title ?? m.image_editor_title()}</title></svelte:head>

{#if loading || migrationBusy}
	<div class="flex h-dvh items-center justify-center bg-neutral-900 text-neutral-200">
		<LoaderIcon class="mr-2 size-5 animate-spin" />
		{migrationBusy ? m.image_editor_public_importing() : m.image_editor_load()}
	</div>
{:else if error || !design}
	<div class="flex h-dvh items-center justify-center bg-background p-4">
		<div class="max-w-md rounded-xl border bg-card p-6 text-center">
			<h1 class="text-lg font-semibold">{m.image_editor_open_failed_title()}</h1>
			<p class="mt-2 text-sm text-muted-foreground">{error}</p>
			<a
				href={resolve((cancelledReturnURL ?? (guestMode ? '/image-editor' : '/media')) as '/')}
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
{/if}
