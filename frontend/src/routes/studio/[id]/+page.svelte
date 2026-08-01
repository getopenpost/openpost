<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { loadStudioBrandKit, loadStudioConfig, loadStudioDesign } from '$lib/studio/api';
	import { loadStudioBrandFonts } from '$lib/studio/fonts';
	import { migrateGuestStudioDesign } from '$lib/studio/guest-migration';
	import { isLocalStudioDesignID, loadGuestStudioDesign } from '$lib/studio/local-persistence';
	import { trackPublicStudioEvent } from '$lib/studio/public-telemetry';
	import { migrateStudioDocument } from '$lib/studio/document';
	import type { StudioBrandKit, StudioDocumentResponse } from '$lib/studio/types';
	import StudioShell from '$lib/studio/components/studio-shell.svelte';
	import { auth } from '$lib/stores/auth';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import { m } from '$lib/paraglide/messages';
	import { startStudioMetric } from '$lib/studio/telemetry';

	let design = $state.raw<StudioDocumentResponse | null>(null);
	let backgroundModelBaseURL = $state('/studio-models');
	let loading = $state(true);
	let error = $state('');
	let readOnlyReason = $state('');
	let brandKit = $state.raw<StudioBrandKit | null>(null);
	let guestMode = $state(false);
	let migrationBusy = $state(false);
	let loadRequest = 0;
	let returnToken = $derived(page.url.searchParams.get('return_token') || '');
	let initialAction = $derived(page.url.searchParams.get('action') || '');
	let authState = $derived($auth);

	$effect(() => {
		const designID = page.params.id ?? '';
		const request = ++loadRequest;
		void initialize(designID, request);
	});

	async function initialize(designID: string, request: number): Promise<void> {
		const finishMetric = startStudioMetric('document_load');
		loading = true;
		error = '';
		readOnlyReason = '';
		brandKit = null;
		design = null;
		guestMode = isLocalStudioDesignID(designID);
		try {
			const [config, response] = await Promise.all([
				loadStudioConfig(),
				guestMode ? loadGuestStudioDesign(designID) : loadStudioDesign(designID)
			]);
			if (request !== loadRequest) return;
			if (!config.enabled) throw new Error(m.studio_not_enabled());
			backgroundModelBaseURL = config.background_model_base_url || '/studio-models';
			const migration = migrateStudioDocument(response.document);
			if (!migration.document) throw new Error(migration.error || m.studio_invalid_document());
			response.document = migration.document;
			if (migration.readOnly) {
				response.can_edit = false;
				readOnlyReason = migration.error || m.studio_document_read_only();
			}
			const brand = guestMode ? null : await loadStudioBrandKit(response.workspace_id);
			if (brand) await loadStudioBrandFonts(brand);
			if (request !== loadRequest) return;
			brandKit = brand;
			design = response;
			finishMetric();
		} catch (cause) {
			if (request !== loadRequest) return;
			finishMetric('error');
			error = cause instanceof Error ? cause.message : m.studio_open_failed();
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
			trackPublicStudioEvent('studio_signup_clicked', { source: 'editor' });
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
			const migrated = await migrateGuestStudioDesign(design.id, workspaceID);
			if (!migrated.alreadyMigrated) {
				trackPublicStudioEvent('studio_workspace_import_completed', { source: 'editor' });
			}
			await goto(resolve(`/studio/${migrated.id}` as '/'));
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.studio_public_import_failed();
		} finally {
			migrationBusy = false;
		}
	}
</script>

<svelte:head><title>{design?.document.title ?? m.studio_title()}</title></svelte:head>

{#if loading || migrationBusy}
	<div class="flex h-dvh items-center justify-center bg-neutral-900 text-neutral-200">
		<LoaderIcon class="mr-2 size-5 animate-spin" />
		{migrationBusy ? m.studio_public_importing() : m.studio_load()}
	</div>
{:else if error || !design}
	<div class="flex h-dvh items-center justify-center bg-background p-4">
		<div class="max-w-md rounded-xl border bg-card p-6 text-center">
			<h1 class="text-lg font-semibold">{m.studio_open_failed_title()}</h1>
			<p class="mt-2 text-sm text-muted-foreground">{error}</p>
			<a
				href={resolve((guestMode ? '/studio' : '/media') as '/')}
				class="mt-5 inline-flex text-sm font-medium text-primary hover:underline"
			>
				{guestMode ? m.studio_public_return() : m.studio_return_media()}
			</a>
		</div>
	</div>
{:else}
	<StudioShell
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
