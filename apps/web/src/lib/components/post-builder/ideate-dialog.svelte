<script lang="ts">
	import { onDestroy, tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { ideate } from '$lib/post-builder/ideate.svelte';
	import { auth } from '$lib/stores/auth';
	import {
		readIdeateDraft,
		writeIdeateDraft,
		type IdeateDraft
	} from '$lib/post-builder/ideate-storage';
	import * as Dialog from '$lib/components/ui/dialog';
	import { createQuery } from '@tanstack/svelte-query';
	import {
		workspaceAccountsQueryOptions,
		voiceProfilesQueryOptions,
		mediaMetadataQueryOptions
	} from '@openpost/query-catalog';
	import { queryAPI } from '$lib/query/api';
	import { voiceProfileQueryAPI } from '$lib/query/voice-profiles';
	import { mediaQueryAPI } from '$lib/query/media';
	import {
		captureQueryMutationSession,
		queryMutationSessionIsCurrent
	} from '$lib/query/authorization-boundary';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { resolveAppPath } from '$lib/app-path';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import AppSelect from '$lib/components/app-select.svelte';
	import SocialSetControl from '$lib/components/social-set-control.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import MediaPicker from '$lib/components/media-picker.svelte';
	import MediaThumbnail from '$lib/components/media-thumbnail.svelte';
	import SeriesResults from './series-results.svelte';
	import PostOptions from '$lib/components/post-builder/post-options.svelte';
	import { ThemeIcon } from '$lib/themes/icons';
	import { m } from '$lib/paraglide/messages';
	import { uploadMediaFile } from '$lib/media-upload-client';
	import { renderOptionMedia } from '$lib/post-builder/visuals';
	import {
		discoverPublicationOpportunities,
		type PublicationOpportunity,
		createPublicationBuild,
		getPublicationBuild,
		retryPublicationBuild,
		cancelPublicationBuild,
		commitPublicationOption,
		savePublicationOption,
		recoverPublicationOption,
		type PublicationBuild,
		type PublicationBuildRequest,
		type PublicationPostOption
	} from '$lib/post-builder/client';
	const workspaceId = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const accounts = createQuery(() => workspaceAccountsQueryOptions(queryAPI, workspaceId));
	const voices = createQuery(() => voiceProfilesQueryOptions(voiceProfileQueryAPI, workspaceId));
	let editingIdea = $state(true);
	let seriesMode = $state(false);
	let seriesWorking = $state(false);
	let resultsElement = $state<HTMLDivElement>();
	let focusResults = false;
	let idea = $state('');
	let accountIds = $state<string[]>([]);
	let setId = $state('');
	let voiceId = $state('');
	let notes = $state('');
	let links = $state('');
	let direction = $state('');
	let assets = $state<IdeateDraft['assets']>([]);
	let availableAssets = $state<IdeateDraft['availableAssets']>([]);
	let mediaPickerOpen = $state(false);
	let mediaPickerCurrent: (() => boolean) | undefined;
	const assetMetadata = createQuery(() =>
		mediaMetadataQueryOptions(
			mediaQueryAPI,
			workspaceId,
			assets.map((asset) => asset.id)
		)
	);
	let uploading = $state(false);
	let build = $state.raw<PublicationBuild>();
	let options = $state.raw<PublicationPostOption[]>([]);
	const hasResults = $derived(Boolean(options.length || build?.result?.series?.length));

	let error = $state('');
	let busy = $state(false);
	let using = $state(false);
	let controller: AbortController | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let loadedKey = '';
	let saving = $state(false);
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let savePromise: Promise<void> | undefined;
	const pendingEdits = new Map<string, PublicationPostOption>();
	const savedVisuals = new Map<string, string>();
	let creationKey = '';
	let lockedDirection = $state<PublicationBuildRequest['direction']>({});
	let contextMayPublish = $state(false);
	let recovery = $state<IdeateDraft['pending']>([]);
	let initialized = false;
	let restoringBuildId = $state<string>();
	let recovering = $state(false);
	let restoreInput = false;
	let separateDraft = $state(false);
	let opportunities = $state<PublicationOpportunity[]>([]);
	let discovering = $state(false);
	let discoveryError = $state('');
	const storageKey = $derived(
		`openpost:ideate:${$auth.user?.id ?? ''}:${workspaceId}:${ideate.entry?.contextKey ?? 'navigation'}`
	);
	let requestFingerprint = '';
	const active = $derived(
		busy ||
			recovering ||
			Boolean(restoringBuildId && !build) ||
			build?.state === 'queued' ||
			build?.state === 'building'
	);
	const selectedAccounts = $derived(
		(accounts.data ?? []).filter((account) => accountIds.includes(account.id))
	);
	const missingAssets = $derived(
		availableAssets.filter((source) => !assets.some((asset) => asset.id === source.id))
	);
	const discoveryInput = $derived({
		workspace_id: workspaceId,
		focus: Array.from(idea.trim()).slice(0, 1000).join('') || undefined,
		voice_profile_id: voiceId || undefined,
		platforms: [...new Set(selectedAccounts.map((account) => account.platform))],
		limit: 4
	});
	const discoveryFingerprint = $derived(JSON.stringify([idea, discoveryInput]));

	const progress = $derived(
		build?.phase === 'sources'
			? m.ideate_loading_sources()
			: build?.phase === 'directing'
				? m.ideate_choosing_treatments()
				: build?.phase === 'reviewing'
					? m.ideate_reviewing()
					: m.ideate_writing()
	);
	function stopPolling() {
		controller?.abort();
		if (timer) clearTimeout(timer);
		timer = undefined;
	}
	function scope() {
		const workspace = workspaceId;
		const session = captureQueryMutationSession();
		const key = loadedKey;
		return () =>
			key === loadedKey && workspace === workspaceId && queryMutationSessionIsCurrent(session);
	}
	async function receive(next: PublicationBuild, current: () => boolean) {
		if (!current() || next.workspace_id !== workspaceId) return;
		build = next;
		busy = false;
		if (next.state === 'ready') {
			options = next.result?.options ?? [];
			editingIdea = false;
			if (focusResults && ideate.open) {
				focusResults = false;
				await tick();
				resultsElement?.focus();
			}
		}
		if (next.state === 'committed') return;
		if (next.state === 'failed') error = next.error_message || m.compose_ai_build_failed();
		if (next.state === 'building' || next.state === 'queued') {
			timer = setTimeout(() => void poll(next.id, current), 1200);
		}
	}
	async function poll(id: string, current: () => boolean) {
		if (!controller || controller.signal.aborted) controller = new AbortController();
		try {
			await receive(await getPublicationBuild(id, controller?.signal), current);
		} catch (cause) {
			if (current()) {
				busy = false;
				error = cause instanceof Error ? cause.message : m.compose_ai_check_build_failed();
			}
		}
	}
	function changeOption(option: PublicationPostOption) {
		options = options.map((item) => (item.id === option.id ? option : item));
		pendingEdits.set(option.id, structuredClone(option));
		persist();
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			void flushEdits().catch((cause) => {
				error = cause instanceof Error ? cause.message : m.ideate_edit_save_failed();
			});
		}, 400);
	}
	async function flushEdits(): Promise<void> {
		if (saveTimer) clearTimeout(saveTimer);
		if (savePromise) {
			await savePromise;
			if (pendingEdits.size) await flushEdits();
			return;
		}
		if (!build) return;
		if (recovery.length) await recoverEdits();
		if (!pendingEdits.size) return;
		const id = build.id;
		const current = scope();
		saving = true;
		savePromise = (async () => {
			while (current() && build?.id === id && pendingEdits.size) {
				const [optionId, option] = pendingEdits.entries().next().value!;
				pendingEdits.delete(optionId);
				recovery = [storedEdit(option, build.revision)];
				persist();
				// The exact in-flight request stays in recovery until confirmed.
				const next = await savePublicationOption(id, option, build.revision);
				if (!current() || build?.id !== id) return;
				build = next;
				recovery = [];
				persist();
			}
		})();
		try {
			await savePromise;
		} finally {
			savePromise = undefined;
			if (current()) saving = false;
		}
	}

	async function generate() {
		if (
			active ||
			using ||
			saving ||
			uploading ||
			discovering ||
			!(idea.trim() || notes.trim() || links.trim() || assets.length) ||
			accountIds.length === 0
		)
			return;
		try {
			await flushEdits();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.ideate_edit_save_failed();
			return;
		}
		const regenerate =
			build?.state === 'ready' || build?.state === 'committed' || build?.state === 'cancelled';
		stopPolling();
		const current = scope();
		busy = true;
		error = '';
		options = [];
		build = undefined;
		restoringBuildId = undefined;
		recovery = [];
		editingIdea = true;
		focusResults = true;
		pendingEdits.clear();
		savedVisuals.clear();
		const request: PublicationBuildRequest = {
			workspace_id: workspaceId,
			idea: idea.trim(),
			option_count: seriesMode ? 0 : 4,
			series_count: seriesMode ? 3 : undefined,
			account_ids: accountIds,
			social_set_id: setId || undefined,
			voice_profile_id: voiceId || undefined,
			context_notes: notes.trim() || undefined,
			context_urls: [...new Set(links.split(/\s+/).filter(Boolean))].slice(0, 10),
			assets: assets.map((asset) => ({
				media_id: asset.id,
				role: 'context',
				may_publish: asset.mayPublish
			})),
			direction: { ...lockedDirection, tone_adjustment: direction.trim() || undefined },
			context_may_publish: contextMayPublish,
			destination_policy: 'require_all'
		};
		const fingerprint = JSON.stringify(request);
		if (!creationKey || fingerprint !== requestFingerprint || regenerate) {
			creationKey = `ideate-${crypto.randomUUID()}`;
			requestFingerprint = fingerprint;
		}
		persist();
		try {
			const next = await createPublicationBuild(request, creationKey);
			if (!current()) return;
			loadedKey = `${workspaceId}:${next.id}`;
			const nextCurrent = scope();
			controller = new AbortController();
			build = next;
			if (ideate.entry) ideate.entry = { ...ideate.entry, buildId: next.id };
			persist();
			await receive(next, nextCurrent);
		} catch (cause) {
			if (current()) {
				busy = false;
				error = cause instanceof Error ? cause.message : m.compose_ai_build_failed();
			}
		}
	}
	async function upload(files: File[]) {
		if (uploading || active || using) return;
		const workspace = workspaceId;
		const current = scope();
		uploading = true;
		error = '';
		try {
			for (const file of files.slice(0, 10 - assets.length)) {
				const media = await uploadMediaFile({ workspaceId: workspace, file, source: 'upload' });
				if (!current()) return;
				setAssets([...assets, { id: media.id, name: file.name, mayPublish: false }]);
			}
		} catch (cause) {
			if (current()) error = cause instanceof Error ? cause.message : m.compose_ai_build_failed();
		} finally {
			if (current()) uploading = false;
		}
	}
	async function useOption(option: PublicationPostOption) {
		if (!build || using || active) return;
		const workspace = workspaceId;
		const buildId = build.id;
		const current = scope();
		using = true;
		error = '';
		controller = new AbortController();
		try {
			if (recovery.length) await recoverEdits();
			if (recovery.length) return;
			await flushEdits();
			if (!current()) return;
			if (!build || build.id !== buildId) return;
			const revision = build.revision;
			const rendered = await renderOptionMedia(workspace, option, savedVisuals, controller.signal);
			if (!current()) return;
			if (!separateDraft && ideate.entry?.apply) {
				const media = Object.fromEntries(
					option.destinations.map((destination) => {
						const renderedID = rendered.find(
							(item) => item.account_id === destination.account_id
						)?.media_id;
						const sourceID =
							destination.media.treatment === 'use_source' &&
							destination.media.source_ref?.startsWith('media:')
								? destination.media.source_ref.slice(6)
								: undefined;
						return [destination.account_id, renderedID ? [renderedID] : sourceID ? [sourceID] : []];
					})
				);
				await ideate.entry.apply(option, media);
				if (current()) ideate.open = false;
			} else {
				const draft = await commitPublicationOption(buildId, option.id, rendered, option, revision);
				if (current()) {
					ideate.open = false;
					await goto(resolveAppPath(draft.href));
				}
			}
		} catch (cause) {
			if (current()) error = cause instanceof Error ? cause.message : m.compose_ai_build_failed();
		} finally {
			if (current()) using = false;
		}
	}
	async function retry() {
		if (!build || busy) return;
		const current = scope();
		busy = true;
		error = '';
		try {
			await receive(await retryPublicationBuild(build.id), current);
		} catch (cause) {
			if (current()) {
				busy = false;
				error = cause instanceof Error ? cause.message : m.compose_ai_build_failed();
			}
		}
	}
	async function cancel() {
		if (!build || using) return;
		const current = scope();
		stopPolling();
		try {
			await receive(await cancelPublicationBuild(build.id), current);
		} catch (cause) {
			if (current()) error = cause instanceof Error ? cause.message : m.compose_ai_build_failed();
		}
	}
	function openAttachments() {
		mediaPickerCurrent = scope();
		mediaPickerOpen = true;
	}

	function setAssets(next: typeof assets) {
		availableAssets = Array.from(
			new Map([...availableAssets, ...assets, ...next].map((asset) => [asset.id, asset])).values()
		);
		assets = next;
	}

	async function discover() {
		if (discovering || active || using || !selectedAccounts.length) return;
		const current = scope();
		const fingerprint = discoveryFingerprint;
		const input = discoveryInput;
		discovering = true;
		discoveryError = '';
		try {
			const result = await discoverPublicationOpportunities(input);
			if (current() && fingerprint === discoveryFingerprint) {
				opportunities = result.opportunities;
				if (!opportunities.length) discoveryError = m.ideate_no_ideas();
			}
		} catch (cause) {
			if (current() && fingerprint === discoveryFingerprint)
				discoveryError = cause instanceof Error ? cause.message : m.compose_ai_find_ideas_failed();
		} finally {
			if (current()) discovering = false;
		}
	}

	function restoreBuild(next: PublicationBuild) {
		idea = next.input?.idea ?? '';
		accountIds = next.input?.destinations.map((destination) => destination.account_id) ?? [];
		voiceId = next.voice_profile_id ?? '';
		setId = next.social_set_id ?? '';
		notes = next.input?.sources?.find((source) => source.id === 'context:notes')?.text ?? '';
		links = next.context_urls?.join('\n') ?? '';
		seriesMode = Boolean(next.input?.series_count);
		direction = next.input?.direction?.tone_adjustment ?? '';
		lockedDirection = next.input?.direction ?? {};
		contextMayPublish =
			next.input?.sources?.find((source) => source.id === 'context:notes')?.publishable ?? false;
		assets = (next.assets ?? []).map((asset) => ({
			id: asset.media_id,
			name:
				next.result?.sources?.find((source) => source.id === `media:${asset.media_id}`)?.label ??
				asset.media_id,
			mayPublish: asset.may_publish
		}));
		availableAssets = assets;
	}

	$effect(() => {
		const workspace = workspaceId;
		const sequence = ideate.sequence;
		if (!workspace) return;
		untrack(() => {
			const entry = ideate.entry?.workspaceId === workspace ? ideate.entry : undefined;
			const saved = readIdeateDraft(storageKey);
			const id = entry?.buildId ?? saved?.buildId;
			const savedMatches = saved && (!entry?.buildId || saved.buildId === entry.buildId);
			restoreInput = !savedMatches;
			restoringBuildId = id;
			loadedKey = `${workspace}:${sequence}:${id ?? ''}`;
			stopPolling();
			if (saveTimer) clearTimeout(saveTimer);
			pendingEdits.clear();
			savedVisuals.clear();
			busy = using = uploading = discovering = saving = seriesWorking = false;
			mediaPickerOpen = false;
			recovery = [];
			creationKey = requestFingerprint = '';
			build = undefined;
			options = [];
			opportunities = [];
			discoveryError = '';
			error = '';
			editingIdea = true;
			separateDraft = false;
			const input = entry?.input;
			lockedDirection = input?.direction ?? {};
			contextMayPublish = input?.context_may_publish ?? false;
			idea = input?.idea ?? '';
			seriesMode = Boolean(input?.series_count);
			accountIds = input?.account_ids ?? [];
			voiceId = input?.voice_profile_id ?? '';
			setId = input?.social_set_id ?? '';
			notes = input?.context_notes ?? '';
			links = input?.context_urls?.join('\n') ?? '';
			direction = input?.direction?.tone_adjustment ?? '';
			assets =
				input?.assets?.map((asset) => ({
					id: asset.media_id,
					name: asset.media_id,
					mayPublish: asset.may_publish
				})) ?? [];
			availableAssets = assets;
			if (savedMatches) {
				({
					idea,
					seriesMode,
					accountIds,
					voiceId,
					setId,
					notes,
					links,
					direction,
					assets,
					lockedDirection,
					contextMayPublish,
					creationKey,
					requestFingerprint
				} = saved);
				availableAssets = Array.from(
					new Map(
						[...availableAssets, ...saved.availableAssets, ...assets].map((asset) => [
							asset.id,
							asset
						])
					).values()
				);
				recovery = saved.pending;
			}
			initialized = true;
			if (id) {
				const current = scope();
				busy = true;
				controller = new AbortController();
				void getPublicationBuild(id, controller.signal)
					.then(async (next) => {
						if (!current() || next.workspace_id !== workspace) return;
						if (!savedMatches) restoreBuild(next);
						await receive(next, current);
						if (recovery.length) await recoverEdits();
					})
					.catch((cause) => {
						if (current()) {
							busy = false;
							error = cause instanceof Error ? cause.message : m.compose_ai_check_build_failed();
						}
					});
			}
		});
	});
	$effect(() => {
		void discoveryFingerprint;
		opportunities = [];
		discoveryError = '';
	});

	$effect(() => {
		ideate.status = active || seriesWorking ? 'working' : hasResults ? 'ready' : 'idle';
	});

	function storedEdit(option: PublicationPostOption, revision: number) {
		return {
			optionId: option.id,
			revision,
			body: JSON.stringify({
				expected_revision: revision,
				edits: option.destinations.map((destination) => ({
					account_id: destination.account_id,
					segments: destination.segments,
					document: destination.media.document ?? undefined
				}))
			})
		};
	}
	function persist() {
		if (!initialized) return;
		const pending = [
			...recovery,
			...Array.from(pendingEdits.values()).map((option, index) =>
				storedEdit(option, (build?.revision ?? 1) + recovery.length + index)
			)
		];

		if (
			!writeIdeateDraft(storageKey, {
				idea,
				seriesMode,
				accountIds,
				voiceId,
				setId,
				notes,
				links,
				direction,
				assets,
				availableAssets,
				lockedDirection: lockedDirection ?? {},
				contextMayPublish,
				creationKey,
				requestFingerprint,
				buildId: build?.id ?? restoringBuildId,
				pending
			})
		) {
			error = m.ideate_edit_save_failed();
		}
	}

	async function retryRestore() {
		if (!restoringBuildId || busy) return;
		const current = scope();
		busy = true;
		error = '';
		controller = new AbortController();
		try {
			const next = await getPublicationBuild(restoringBuildId, controller.signal);
			if (!current()) return;
			if (next.workspace_id !== workspaceId) throw new Error(m.compose_ai_progress_conflict());
			if (restoreInput) restoreBuild(next);
			await receive(next, current);
			await recoverEdits();
		} catch (cause) {
			if (current())
				error = cause instanceof Error ? cause.message : m.compose_ai_check_build_failed();
		} finally {
			if (current()) busy = false;
		}
	}

	async function recoverEdits() {
		if (!build || !recovery.length || recovering) return;
		recovering = true;
		const current = scope();
		try {
			while (recovery.length && current()) {
				const item = recovery[0];
				const next = await recoverPublicationOption(build.id, item.optionId, item.body);
				if (!current()) return;
				recovery = recovery.slice(1);
				await receive(next, current);
				persist();
			}
		} catch (cause) {
			if (current()) error = cause instanceof Error ? cause.message : m.ideate_edit_save_failed();
			throw cause;
		} finally {
			if (current()) recovering = false;
		}
	}

	$effect(() => {
		void [
			idea,
			seriesMode,
			accountIds,
			voiceId,
			setId,
			notes,
			links,
			direction,
			assets,
			availableAssets
		];
		untrack(persist);
	});
	onDestroy(() => {
		stopPolling();
		if (saveTimer) clearTimeout(saveTimer);
	});
</script>

<Dialog.Root bind:open={ideate.open}>
	<Dialog.Content
		forceMount
		style={ideate.open ? undefined : 'display: none'}
		class="flex h-dvh max-h-dvh w-full max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:rounded-xl {options.length >
		1
			? 'sm:max-w-6xl'
			: 'sm:max-w-2xl'}"
		data-testid="ideate-dialog"
	>
		<Dialog.Header class="shrink-0 border-b px-4 py-4 pr-14 sm:px-6">
			<Dialog.Title>{m.compose_ai_ideate()}</Dialog.Title>
			<Dialog.Description class="mt-1 text-sm text-muted-foreground"
				>{seriesMode ? m.series_description() : m.ideate_description()}</Dialog.Description
			>
		</Dialog.Header>
		<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
			<div class="mx-auto grid w-full max-w-6xl gap-6">
				{#if accounts.error}<InlineNotice
						tone="error"
						message={m.compose_ai_destinations_required()}
					/>{/if}
				{#if editingIdea || !hasResults}<form
						class="mx-auto grid w-full max-w-2xl gap-4"
						onsubmit={(event) => {
							event.preventDefault();
							void generate();
						}}
					>
						<label class="grid gap-2 text-sm font-medium"
							>{m.ideate_idea_label()}<Textarea
								bind:value={idea}
								rows={4}
								maxlength={20000}
								placeholder={m.ideate_idea_placeholder()}
								disabled={active || using}
								onpaste={(event) => {
									const files = Array.from(event.clipboardData?.files ?? []);
									if (files.length) {
										event.preventDefault();
										void upload(files);
									}
								}}
							/></label
						>
						<div class="flex flex-wrap items-center gap-2">
							<Button
								type="button"
								variant="outline"
								size="sm"
								onclick={openAttachments}
								disabled={active || using || uploading || assets.length >= 10}
							>
								<ThemeIcon role="image-add" class="size-4" />{uploading
									? m.ideate_uploading()
									: m.ideate_attach()}
							</Button>
							{#if missingAssets.length}
								<Button
									type="button"
									variant="ghost"
									size="sm"
									disabled={active || using || uploading || assets.length >= 10}
									onclick={() => {
										setAssets([...assets, ...missingAssets.slice(0, 10 - assets.length)]);
									}}
									><ThemeIcon role="undo" class="size-4" />{m.compose_ai_media_use_source()}</Button
								>
							{/if}
							<Button
								type="button"
								variant="ghost"
								size="sm"
								class="ml-auto"
								disabled={active || using || discovering || !selectedAccounts.length}
								title={m.ideate_suggest_description()}
								onclick={() => void discover()}
							>
								<ThemeIcon role="search" class="size-4" />{discovering
									? m.compose_ai_finding_ideas()
									: m.ideate_suggest()}
							</Button>
						</div>
						{#if discoveryError}<InlineNotice tone="error" message={discoveryError} />{/if}
						{#if discovering}<p class="text-sm text-muted-foreground" role="status">
								{m.ideate_suggest_description()}
							</p>{/if}
						{#if opportunities.length}
							<div class="grid gap-2" role="group" aria-label={m.ideate_suggest()}>
								{#each opportunities as opportunity (opportunity.id)}
									<Button
										multiline
										type="button"
										variant="outline"
										class="h-auto min-h-11 flex-col items-start gap-1 p-3 text-left whitespace-normal"
										onclick={() => {
											idea = [opportunity.title, opportunity.hook].filter(Boolean).join('\n\n');
											opportunities = [];
										}}
									>
										<span class="font-medium">{opportunity.title}</span>
										<span class="text-sm font-normal text-muted-foreground"
											>{opportunity.why_it_fits}</span
										>
									</Button>
								{/each}
							</div>
						{/if}
						{#if assets.length}
							<ul class="grid gap-2" aria-label={m.compose_ai_media()}>
								{#each assets as asset (asset.id)}
									{@const metadata = assetMetadata.data?.media.find((item) => item.id === asset.id)}
									{@const name = metadata?.original_filename || asset.name}
									<li class="flex min-w-0 items-center gap-3 rounded-lg border p-2">
										<MediaThumbnail
											item={{
												mime_type: metadata?.mime_type ?? '',
												url: metadata?.url ?? '',
												thumbnail_url: metadata?.thumbnail_url,
												poster_thumbnail_url: metadata?.poster_thumbnail_url,
												original_filename: name,
												alt_text: metadata?.alt_text
											}}
											class="size-14 shrink-0 rounded-md object-cover"
										/>
										<div class="min-w-0 flex-1">
											<p class="truncate text-sm font-medium" title={name}>{name}</p>
											<label class="flex min-h-11 items-center gap-2 text-xs text-muted-foreground">
												<Checkbox
													checked={asset.mayPublish}
													disabled={active || using}
													onCheckedChange={(checked) =>
														(assets = assets.map((item) =>
															item.id === asset.id
																? { ...item, mayPublish: checked === true }
																: item
														))}
												/>
												{m.ideate_attachment_publishable()}
											</label>
										</div>
										<Button
											type="button"
											variant="ghost"
											size="icon"
											class="shrink-0"
											onclick={() => setAssets(assets.filter((item) => item.id !== asset.id))}
											disabled={active || using}
											aria-label={m.ideate_remove_attachment({ name })}
										>
											<ThemeIcon role="close" class="size-4" />
										</Button>
									</li>
								{/each}
							</ul>
						{/if}
						<div class="grid min-w-0 gap-2">
							<p class="text-sm font-medium">{m.compose_destinations()}</p>
							<SocialSetControl
								{workspaceId}
								accounts={accounts.data ?? []}
								selectedAccountIds={accountIds}
								bind:selectedSetId={setId}
								disabled={active || using}
								autoApplyDefault={!build && !ideate.entry?.buildId && !ideate.entry?.input}
								onApply={(set) =>
									(accountIds = (set?.accounts ?? []).map((item) => item.social_account_id))}
								onToggle={(account) => {
									setId = '';
									accountIds = accountIds.includes(account.id)
										? accountIds.filter((id) => id !== account.id)
										: [...accountIds, account.id];
								}}
								onSelectAll={() => {
									setId = '';
									accountIds = (accounts.data ?? []).map((account) => account.id);
								}}
								onClearAll={() => {
									setId = '';
									accountIds = [];
								}}
							/>
						</div>
						{#if !accountIds.length && !accounts.isPending}
							<p class="text-sm text-muted-foreground">{m.compose_select_account()}</p>
						{/if}
						<details class="border-t">
							<summary class="min-h-11 cursor-pointer py-3 text-sm text-muted-foreground"
								>{m.ideate_options()}</summary
							>
							<div class="grid gap-3 pb-3">
								<label class="grid gap-1.5 text-sm font-medium"
									>{m.ideate_voice_profile()}<AppSelect
										bind:value={voiceId}
										options={[
											{ value: '', label: m.ideate_voice_account_defaults() },
											...(voices.data ?? []).map((profile) => ({
												value: profile.id,
												label: profile.name
											}))
										]}
										disabled={active || using}
										ariaLabel={m.ideate_voice_profile()}
									/></label
								><label class="grid gap-1.5 text-sm font-medium"
									>{m.ideate_direction()}<Input
										bind:value={direction}
										maxlength={500}
										disabled={active || using}
										placeholder={m.ideate_direction_placeholder()}
									/></label
								><label class="grid gap-1.5 text-sm font-medium"
									>{m.compose_ai_context_notes()}<Textarea
										bind:value={notes}
										maxlength={10000}
										rows={3}
										disabled={active || using}
									/></label
								><label class="grid gap-1.5 text-sm font-medium"
									>{m.compose_ai_context_links()}<Textarea
										bind:value={links}
										rows={2}
										disabled={active || using}
									/></label
								>
							</div>
						</details>
						<div
							class="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between"
						>
							<label class="flex min-h-11 items-center gap-2 text-sm"
								><Checkbox
									bind:checked={seriesMode}
									disabled={active || using}
								/>{m.series_create()}</label
							>
							<Button
								type="submit"
								class="min-h-11 sm:min-w-40"
								disabled={active ||
									using ||
									saving ||
									uploading ||
									discovering ||
									!(idea.trim() || notes.trim() || links.trim() || assets.length) ||
									!accountIds.length}
								>{active
									? m.ideate_generating()
									: seriesMode
										? m.series_plan()
										: m.ideate_generate()}</Button
							>
						</div>
					</form>{:else}<div class="flex items-start justify-between gap-3">
						<p class="line-clamp-2 text-sm text-muted-foreground">{idea}</p>
						{#if !build?.series_origin}<Button
								variant="ghost"
								size="sm"
								onclick={() => (editingIdea = true)}
								disabled={using}>{m.common_edit()}</Button
							>{/if}
					</div>{/if}
				{#if error}<InlineNotice tone="error" message={error}
						>{#snippet actions()}{#if build?.state === 'failed'}<Button
									variant="ghost"
									size="sm"
									onclick={() => void retry()}>{m.common_retry()}</Button
								>{:else if restoringBuildId && !build}<Button
									variant="ghost"
									size="sm"
									onclick={() => void retryRestore()}
									disabled={busy}>{m.common_retry()}</Button
								>{:else if recovery.length}<Button
									variant="ghost"
									size="sm"
									onclick={() => void recoverEdits().catch(() => undefined)}
									>{m.common_retry()}</Button
								>{:else if pendingEdits.size > 0}<Button
									variant="ghost"
									size="sm"
									onclick={() => {
										error = '';
										void flushEdits().catch((cause) => {
											error = cause instanceof Error ? cause.message : m.ideate_edit_save_failed();
										});
									}}>{m.common_retry()}</Button
								>{:else if build && active}<Button
									variant="ghost"
									size="sm"
									onclick={() => {
										error = '';
										void poll(build!.id, scope());
									}}>{m.common_retry()}</Button
								>{/if}{/snippet}</InlineNotice
					>{/if}
				{#if active}<div
						class="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 rounded-lg border p-4"
					>
						<p class="text-sm" role="status">{progress}</p>
						{#if build}<Button variant="ghost" size="sm" onclick={() => void cancel()}
								>{m.common_cancel()}</Button
							>{/if}
					</div>{/if}
				{#if saving}<p class="text-sm text-muted-foreground" role="status">
						{m.ideate_saving_edits()}
					</p>{/if}
				{#if using}<p class="text-sm text-muted-foreground" role="status">
						{m.ideate_preparing_draft()}
					</p>{/if}
				{#if options.length && ideate.entry?.apply}
					<label class="flex min-h-11 items-center gap-2 text-sm"
						><Checkbox bind:checked={separateDraft} />{m.ideate_separate_draft()}</label
					>
				{/if}
				{#if build?.result?.series?.length}
					{#key build.id}<SeriesResults
							{build}
							onUpdated={(next) => void receive(next, scope())}
							onOpen={(id) => ideate.show({ workspaceId, contextKey: id, buildId: id })}
							onWorking={(working) => (seriesWorking = working)}
						/>{/key}
				{/if}
				{#if build?.series_origin}<Button
						variant="ghost"
						onclick={async () => {
							try {
								await flushEdits();
								const id = build?.series_origin?.build_id;
								if (id) ideate.show({ workspaceId, contextKey: id, buildId: id });
							} catch (cause) {
								error = cause instanceof Error ? cause.message : m.ideate_edit_save_failed();
							}
						}}>{m.series_back()}</Button
					>{/if}

				{#if options.length}<div
						bind:this={resultsElement}
						tabindex="-1"
						class="min-w-0 outline-none"
						role="region"
						aria-label={m.ideate_results()}
					>
						<PostOptions
							{options}
							accounts={selectedAccounts}
							{workspaceId}
							sources={build?.result?.sources ?? []}
							busy={using || saving || active || recovery.length > 0}
							onUse={(option) => void useOption(option)}
							onChange={changeOption}
						/>
					</div>{/if}
				{#if build?.state === 'committed'}<Button
						href={resolveAppPath(`/publications/${build.publication_id}`)}
						>{m.ideate_open_draft()}</Button
					>{/if}
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>

<MediaPicker
	bind:open={mediaPickerOpen}
	{workspaceId}
	currentSelection={assets.map((asset) => asset.id)}
	currentMediaMimeTypes={Object.fromEntries(
		(assetMetadata.data?.media ?? []).map((item) => [item.id, item.mime_type ?? ''])
	)}
	accept={['image/*', 'video/*', 'audio/*', 'application/pdf']}
	maxSelection={10}
	showCreate={false}
	compactNavigation
	purpose="ideate_context"
	onConfirm={(ids, media) => {
		if (!mediaPickerCurrent?.()) return false;
		setAssets(
			ids.slice(0, 10).map(
				(id) =>
					assets.find((asset) => asset.id === id) ??
					availableAssets.find((asset) => asset.id === id) ?? {
						id,
						name: media.find((item) => item.id === id)?.original_filename || id,
						mayPublish: false
					}
			)
		);
	}}
/>
