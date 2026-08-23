<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolveAppPath } from '$lib/app-path';
	import { onDestroy, onMount } from 'svelte';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import UserIcon from '@lucide/svelte/icons/user-round';
	import UsersIcon from '@lucide/svelte/icons/users';
	import { Button } from '$lib/components/ui/button';
	import AppSelect from '$lib/components/app-select.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import MediaPicker from '$lib/components/media-picker.svelte';
	import SocialSetControl from '$lib/components/social-set-control.svelte';
	import { loadWorkspaceAccounts, prefetchDraftComposerData } from '$lib/api/performance-cache';
	import type { SocialAccount } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import type { ImageEditorMediaItem } from '$lib/image-editor/types';
	import { createBuilderMediaHandoffSearch } from '$lib/composer/builder-media-handoff';
	import { uploadMediaFile, type MediaUploadResult } from '$lib/media-upload-client';
	import {
		createOpenPostBuilderClient,
		localizedPostBuilderCopy,
		type OpenPostBuilderClient,
		type PostBuilderCommitResult,
		type PostBuilderDirection,
		type PostBuilderMediaPlanItem,
		type PostBuilderMode,
		type PostBuilderOpportunity,
		type PostBuilderOpportunityAngle,
		type PostBuilderRun,
		type PostBuilderSource
	} from '$lib/post-builder';
	import { resolveVoiceProfileSelection, type VoiceProfile } from '$lib/voice-profiles';
	import { getPlatformKey, getPlatformName } from '$lib/utils';
	import { m } from '$lib/paraglide/messages';
	import PostBuilderShell from './post-builder-shell.svelte';
	import BuilderDirectionControl from './builder-direction-control.svelte';
	import SourceLinkDialog from './source-link-dialog.svelte';
	import VoiceNoteRecorder from './voice-note-recorder.svelte';

	type SocialSet = components['schemas']['SocialSetResponse'];

	interface Props {
		workspaceId: string;
		discoveryEnabled?: boolean;
		client?: OpenPostBuilderClient;
	}

	const nativePlatforms = new Set(['linkedin', 'x', 'mastodon', 'bluesky', 'threads']);
	const maximumReferences = 10;
	const runStoragePrefix = 'openpost:publication-builder:run:';

	let {
		workspaceId,
		discoveryEnabled = false,
		client = createOpenPostBuilderClient()
	}: Props = $props();

	const copy = $derived(localizedPostBuilderCopy());
	const starterIdeas = $derived([
		{ id: 'lesson', text: m.post_builder_starter_lesson() },
		{ id: 'tool', text: m.post_builder_starter_tool() },
		{ id: 'opinion', text: m.post_builder_starter_opinion() }
	]);

	let accounts = $state.raw<SocialAccount[]>([]);
	let accountsLoading = $state(true);
	let contextError = $state('');
	let selectedAccountIds = $state<string[]>([]);
	let selectedSocialSetId = $state('');
	let voices = $state.raw<VoiceProfile[]>([]);
	let voiceProfileId = $state('');
	let mode = $state<PostBuilderMode>('source');
	let sourceText = $state('');
	let sourceIdeaText = $state('');
	let sourceMaterials = $state.raw<PostBuilderSource[]>([]);
	let opportunitySources = $state.raw<PostBuilderSource[]>([]);
	let sourceDirection = $state<PostBuilderDirection>({ destinationStrategy: 'recommend' });
	let opportunityDirection = $state<PostBuilderDirection>({ destinationStrategy: 'recommend' });
	let opportunities = $state.raw<PostBuilderOpportunity[]>([]);
	let selectedOpportunityId = $state('');
	let selectedOpportunityAngleId = $state('');
	let discoveryLoading = $state(false);
	let discoveryError = $state('');
	let mediaPickerOpen = $state(false);
	let sourceLinkOpen = $state(false);
	let recorderOpen = $state(false);
	let directionOpen = $state(false);
	let initialRunId = $state('');
	let contextController: AbortController | null = null;
	let discoveryController: AbortController | null = null;

	const selectedAccounts = $derived(
		selectedAccountIds
			.map((id) => accounts.find((account) => account.id === id))
			.filter((account): account is SocialAccount => Boolean(account))
	);
	const activeDirection = $derived(mode === 'discover' ? opportunityDirection : sourceDirection);
	const activeSources = $derived(mode === 'discover' ? opportunitySources : sourceMaterials);
	const destinationLabel = $derived(
		selectedAccountIds.length === 0
			? m.post_builder_no_destinations()
			: m.post_builder_destination_count({ count: selectedAccountIds.length })
	);
	const voiceLabel = $derived(
		voiceProfileId
			? (voices.find((profile) => profile.id === voiceProfileId)?.name ??
					m.post_builder_voice_defaults())
			: m.post_builder_voice_defaults()
	);
	const mediaSelection = $derived(
		sourceMaterials.filter((source) => source.kind !== 'link').map((source) => source.id)
	);
	const mediaMimeTypes = $derived(
		Object.fromEntries(
			sourceMaterials
				.filter((source) => source.kind !== 'link' && source.detail?.includes('/'))
				.map((source) => [source.id, source.detail ?? ''])
		)
	);
	const mediaLimit = $derived(
		Math.max(
			1,
			maximumReferences - sourceMaterials.filter((source) => source.kind === 'link').length
		)
	);

	onMount(() => {
		initialRunId = localStorage.getItem(runStorageKey()) ?? '';
		void loadContext();
	});

	onDestroy(() => {
		contextController?.abort();
		discoveryController?.abort();
	});

	function runStorageKey(): string {
		return `${runStoragePrefix}${workspaceId}`;
	}

	async function loadContext(force = false): Promise<void> {
		contextController?.abort();
		const controller = new AbortController();
		contextController = controller;
		accountsLoading = true;
		contextError = '';
		try {
			const [loadedAccounts, loadedVoices] = await Promise.all([
				loadWorkspaceAccounts(workspaceId, force),
				client.listVoices(workspaceId, { signal: controller.signal })
			]);
			if (controller.signal.aborted) return;
			accounts = loadedAccounts.filter(
				(account) => account.is_active && nativePlatforms.has(getPlatformKey(account.platform))
			);
			selectedAccountIds = accounts.map((account) => account.id);
			voices = loadedVoices;
			voiceProfileId = resolveVoiceProfileSelection(loadedVoices, voiceProfileId);
		} catch (cause) {
			if (controller.signal.aborted) return;
			contextError =
				cause instanceof Error && cause.message
					? cause.message
					: m.post_builder_context_load_failed();
		} finally {
			if (contextController === controller) {
				contextController = null;
				accountsLoading = false;
			}
		}
	}

	function toggleAccount(account: SocialAccount): void {
		selectedSocialSetId = '';
		selectedAccountIds = selectedAccountIds.includes(account.id)
			? selectedAccountIds.filter((id) => id !== account.id)
			: [...selectedAccountIds, account.id];
	}

	function applySocialSet(set: SocialSet | null): void {
		if (!set) {
			selectedSocialSetId = '';
			return;
		}
		selectedSocialSetId = set.id;
		selectedAccountIds = (set.accounts ?? [])
			.map((membership) => membership.social_account_id)
			.filter((id) => accounts.some((account) => account.id === id));
	}

	function selectAllAccounts(): void {
		selectedSocialSetId = '';
		selectedAccountIds = accounts.map((account) => account.id);
	}

	function clearAllAccounts(): void {
		selectedSocialSetId = '';
		selectedAccountIds = [];
	}

	function changeMode(next: PostBuilderMode): void {
		if (next === 'discover') {
			if (mode !== 'discover') sourceIdeaText = sourceText;
			const selected = opportunities.find((item) => item.id === selectedOpportunityId);
			sourceText = selected ? opportunityIdea(selected) : '';
			mode = 'discover';
			if (opportunities.length === 0) void discover();
			return;
		}
		mode = 'source';
		sourceText = sourceIdeaText;
	}

	function updateSourceText(value: string): void {
		sourceText = value;
		if (mode === 'source') sourceIdeaText = value;
	}

	function updateDirection(next: PostBuilderDirection): void {
		if (mode === 'discover') opportunityDirection = next;
		else sourceDirection = next;
	}

	function addLink(url: string): void {
		if (sourceMaterials.length >= maximumReferences) return;
		if (sourceMaterials.some((source) => source.kind === 'link' && source.url === url)) return;
		const label = new URL(url).hostname;
		sourceMaterials = [
			...sourceMaterials,
			{ id: `link:${url}`, kind: 'link', label, url, detail: url, role: 'evidence' }
		];
	}

	function removeSource(source: PostBuilderSource): void {
		if (mode === 'discover') {
			opportunitySources = opportunitySources.filter((item) => item.id !== source.id);
			return;
		}
		sourceMaterials = sourceMaterials.filter((item) => item.id !== source.id);
	}

	function updateSourcePublish(source: PostBuilderSource, mayPublish: boolean): void {
		const update = (item: PostBuilderSource) =>
			item.id === source.id ? { ...item, mayPublish } : item;
		if (mode === 'discover') opportunitySources = opportunitySources.map(update);
		else sourceMaterials = sourceMaterials.map(update);
	}

	function mediaKind(mimeType: string): PostBuilderSource['kind'] {
		if (mimeType.startsWith('image/')) return 'image';
		if (mimeType.startsWith('video/')) return 'video';
		if (mimeType.startsWith('audio/')) return 'audio';
		return 'document';
	}

	function confirmMedia(ids: string[], media: ImageEditorMediaItem[]): void {
		const current = new Map(sourceMaterials.map((source) => [source.id, source]));
		const loaded = new Map(media.map((item) => [item.id, item]));
		const links = sourceMaterials.filter((source) => source.kind === 'link');
		const selected = ids.flatMap<PostBuilderSource>((id) => {
			const item = loaded.get(id);
			const existing = current.get(id);
			if (!item) return existing ? [existing] : [];
			return [
				{
					id: item.id,
					kind: mediaKind(item.mime_type),
					label: item.original_filename || m.post_builder_unnamed_source(),
					detail: item.mime_type,
					status: item.processing_status === 'ready' ? 'ready' : 'processing',
					role: existing?.role ?? 'evidence',
					mayPublish: existing?.mayPublish ?? false
				}
			];
		});
		sourceMaterials = [...links, ...selected].slice(0, maximumReferences);
	}

	async function saveVoiceNote(file: File): Promise<void> {
		if (sourceMaterials.length >= maximumReferences) {
			throw new Error(m.post_builder_reference_limit());
		}
		const uploaded = await uploadMediaFile({
			workspaceId,
			file,
			source: 'upload',
			assetKind: 'library',
			retentionClass: 'library',
			prepareVideo: false
		});
		addUploadedSource(uploaded);
	}

	function addUploadedSource(uploaded: MediaUploadResult): void {
		const next: PostBuilderSource = {
			id: uploaded.id,
			kind: mediaKind(uploaded.mime_type),
			label: uploaded.original_filename || m.post_builder_voice_note(),
			detail: uploaded.mime_type,
			status: uploaded.processing_status === 'ready' ? 'ready' : 'processing',
			role: 'evidence',
			mayPublish: false
		};
		sourceMaterials = [
			...sourceMaterials.filter((source) => source.id !== uploaded.id),
			next
		].slice(0, maximumReferences);
	}

	async function discover(): Promise<void> {
		if (!discoveryEnabled || discoveryLoading) return;
		const platforms = [
			...new Set(selectedAccounts.map((account) => getPlatformKey(account.platform)))
		];
		if (platforms.length === 0) {
			discoveryError = m.post_builder_discover_destinations_required();
			return;
		}
		discoveryController?.abort();
		const controller = new AbortController();
		discoveryController = controller;
		discoveryLoading = true;
		discoveryError = '';
		try {
			opportunities = await client.discover(
				{
					workspaceId,
					audience: opportunityDirection.audience,
					voiceProfileId: voiceProfileId || undefined,
					platforms,
					limit: 6
				},
				{ signal: controller.signal }
			);
			selectedOpportunityId = '';
			selectedOpportunityAngleId = '';
			opportunitySources = [];
			sourceText = '';
		} catch (cause) {
			if (controller.signal.aborted) return;
			discoveryError =
				cause instanceof Error && cause.message ? cause.message : m.post_builder_discover_failed();
		} finally {
			if (discoveryController === controller) {
				discoveryController = null;
				discoveryLoading = false;
			}
		}
	}

	function selectOpportunity(opportunity: PostBuilderOpportunity): void {
		selectedOpportunityId = opportunity.id;
		selectedOpportunityAngleId = '';
		sourceText = opportunityIdea(opportunity);
		opportunitySources = (
			opportunity.sourceURLs ?? (opportunity.sourceURL ? [opportunity.sourceURL] : [])
		)
			.slice(0, maximumReferences)
			.map((url) => ({
				id: `opportunity:${url}`,
				kind: 'link' as const,
				label: new URL(url).hostname,
				url,
				detail: url,
				role: 'evidence' as const
			}));
	}

	function selectOpportunityAngle(
		opportunity: PostBuilderOpportunity,
		angle: PostBuilderOpportunityAngle
	): void {
		selectOpportunity(opportunity);
		selectedOpportunityAngleId = angle.id;
		opportunityDirection = {
			...opportunityDirection,
			angle: angle.description?.trim() || angle.label
		};
	}

	function opportunityIdea(opportunity: PostBuilderOpportunity): string {
		return [opportunity.title, opportunity.summary, opportunity.whyRelevant]
			.filter((value) => value?.trim())
			.join('\n\n');
	}

	function handleRunChange(run: PostBuilderRun): void {
		if (run.phase === 'cancelled') {
			localStorage.removeItem(runStorageKey());
			return;
		}
		localStorage.setItem(runStorageKey(), run.id);
	}

	function handleReset(): void {
		localStorage.removeItem(runStorageKey());
		initialRunId = '';
		client.resetSubmission(workspaceId);
	}

	async function handleCommit(result: PostBuilderCommitResult): Promise<void> {
		localStorage.removeItem(runStorageKey());
		prefetchDraftComposerData(result.publicationId, workspaceId);
		await goto(resolveAppPath(`/publications/${encodeURIComponent(result.publicationId)}`));
	}

	async function handleMediaAction(
		result: PostBuilderCommitResult,
		item: PostBuilderMediaPlanItem
	): Promise<void> {
		localStorage.removeItem(runStorageKey());
		prefetchDraftComposerData(result.publicationId, workspaceId);
		const builderMedia =
			item.action === 'meme' ? 'meme' : item.action === 'video_editor' ? 'video' : 'image';
		const query = createBuilderMediaHandoffSearch({
			kind: builderMedia,
			brief: item.brief || item.label,
			accountId: item.accountId,
			sourceMediaId: item.sourceMediaId,
			sourceLabel: item.sourceLabel
		});
		await goto(
			`${resolveAppPath(`/publications/${encodeURIComponent(result.publicationId)}`)}?${query}`
		);
	}
</script>

{#if contextError}
	<div class="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6 lg:px-8">
		<InlineNotice tone="error" message={contextError}>
			{#snippet actions()}
				<Button type="button" variant="ghost" size="sm" onclick={() => loadContext(true)}>
					{m.common_retry()}
				</Button>
			{/snippet}
		</InlineNotice>
	</div>
{/if}

{#snippet destinationControl({ disabled }: { disabled: boolean })}
	{#if accountsLoading}
		<Button type="button" variant="outline" class="justify-start" disabled>
			<LoaderIcon class="size-4 animate-spin motion-reduce:animate-none" />
			{m.post_builder_destinations_loading()}
		</Button>
	{:else if accounts.length > 0}
		<div
			class="min-w-0 [&_[data-testid=composer-account-control]]:w-full [&_[data-testid=composer-account-control]]:justify-start"
		>
			<SocialSetControl
				{workspaceId}
				{accounts}
				{selectedAccountIds}
				bind:selectedSetId={selectedSocialSetId}
				{disabled}
				autoApplyDefault
				onApply={applySocialSet}
				onToggle={toggleAccount}
				onSelectAll={selectAllAccounts}
				onClearAll={clearAllAccounts}
			/>
		</div>
	{:else}
		<Button
			type="button"
			variant="outline"
			class="h-auto min-h-11 w-full min-w-0 justify-start py-2 text-left leading-snug whitespace-normal"
			disabled
		>
			<UsersIcon class="size-4 shrink-0" />
			<span class="min-w-0">{m.post_builder_no_native_destinations()}</span>
		</Button>
	{/if}
{/snippet}

{#snippet voiceControl({ disabled }: { disabled: boolean })}
	<div class="min-w-0">
		{#if voices.length > 0}
			<AppSelect
				value={voiceProfileId}
				ariaLabel={`${copy.voice}: ${voiceLabel}`}
				class="w-full"
				{disabled}
				options={[
					{ value: '', label: `${copy.voice}: ${m.post_builder_voice_defaults()}` },
					...voices.map((voice) => ({ value: voice.id, label: `${copy.voice}: ${voice.name}` }))
				]}
				onValueChange={(value) => (voiceProfileId = value)}
			/>
		{:else}
			<Button type="button" variant="outline" class="w-full justify-start" disabled>
				<UserIcon class="size-4" />
				{m.post_builder_voice_unavailable()}
			</Button>
		{/if}
	</div>
{/snippet}

{#snippet directionControl({ disabled }: { disabled: boolean })}
	<BuilderDirectionControl
		bind:open={directionOpen}
		direction={activeDirection}
		{disabled}
		onChange={updateDirection}
	/>
{/snippet}

<PostBuilderShell
	{workspaceId}
	{client}
	{mode}
	bind:sourceText
	bind:selectedOpportunityId
	bind:selectedOpportunityAngleId
	sources={activeSources}
	{starterIdeas}
	{opportunities}
	discoverLoading={discoveryLoading}
	discoverError={discoveryError}
	discoverEnabled={discoveryEnabled}
	{selectedAccountIds}
	socialSetId={selectedSocialSetId}
	{destinationLabel}
	{voiceProfileId}
	{voiceLabel}
	direction={activeDirection}
	{destinationControl}
	{voiceControl}
	{directionControl}
	{initialRunId}
	showCreationModeSwitch={false}
	{copy}
	onModeChange={changeMode}
	onSourceTextChange={updateSourceText}
	onAttach={() => (mediaPickerOpen = true)}
	onPasteLink={() => (sourceLinkOpen = true)}
	onRecord={() => (recorderOpen = true)}
	onAddContext={() => (directionOpen = true)}
	onRemoveSource={removeSource}
	onSourcePublishChange={updateSourcePublish}
	onSelectOpportunity={selectOpportunity}
	onSelectOpportunityAngle={selectOpportunityAngle}
	onRefreshDiscover={discover}
	onRunChange={handleRunChange}
	onReset={handleReset}
	onCommit={handleCommit}
	onMediaAction={handleMediaAction}
/>

<SourceLinkDialog bind:open={sourceLinkOpen} onAdd={addLink} />
<VoiceNoteRecorder bind:open={recorderOpen} onSave={saveVoiceNote} />
<MediaPicker
	bind:open={mediaPickerOpen}
	{workspaceId}
	currentSelection={mediaSelection}
	currentMediaMimeTypes={mediaMimeTypes}
	accept={[
		'image/*',
		'video/*',
		'audio/*',
		'application/pdf',
		'application/msword',
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		'application/vnd.ms-powerpoint',
		'application/vnd.openxmlformats-officedocument.presentationml.presentation'
	]}
	maxSelection={mediaLimit}
	multiple
	title={m.post_builder_attach_title()}
	purpose="publication_builder_source"
	showCreate={false}
	autoConfirmUploads
	initialMode="upload"
	onConfirm={confirmMedia}
/>
