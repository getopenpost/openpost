<script lang="ts">
	import { onDestroy, onMount, untrack, type Snippet } from 'svelte';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import LayoutGridIcon from '@lucide/svelte/icons/layout-grid';
	import LinkIcon from '@lucide/svelte/icons/link-2';
	import MicIcon from '@lucide/svelte/icons/mic';
	import PaperclipIcon from '@lucide/svelte/icons/paperclip';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SlidersIcon from '@lucide/svelte/icons/sliders-horizontal';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import UserIcon from '@lucide/svelte/icons/user-round';
	import UsersIcon from '@lucide/svelte/icons/users';
	import WandIcon from '@lucide/svelte/icons/wand-sparkles';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Tabs from '$lib/components/ui/tabs';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import {
		createPostBuilderRunInput,
		isPostBuilderAbort,
		postBuilderCopy,
		postBuilderDirectionLabel,
		postBuilderRunIsActive,
		validatePostBuilderDraft,
		watchPostBuilderRun,
		type PostBuilderClient,
		type PostBuilderCommitResult,
		type PostBuilderControlContext,
		type PostBuilderCopy,
		type PostBuilderCreationMode,
		type PostBuilderDirection,
		type PostBuilderMediaPlanItem,
		type PostBuilderMode,
		type PostBuilderOpportunity,
		type PostBuilderOpportunityAngle,
		type PostBuilderRun,
		type PostBuilderSource,
		type PostBuilderStarterIdea,
		type PostBuilderValidationCode
	} from '$lib/post-builder';
	import BuilderRail from './builder-rail.svelte';
	import BuildProgress from './build-progress.svelte';
	import BuildResultSummary from './build-result-summary.svelte';
	import DiscoverOpportunities from './discover-opportunities.svelte';
	import SourceMaterialChips from './source-material-chips.svelte';
	import CreationModeSwitch from './creation-mode-switch.svelte';

	type ControlSnippet = Snippet<[PostBuilderControlContext]>;

	interface Props {
		workspaceId: string;
		client: PostBuilderClient;
		creationMode?: PostBuilderCreationMode;
		mode?: PostBuilderMode;
		sourceText?: string;
		sources?: PostBuilderSource[];
		starterIdeas?: PostBuilderStarterIdea[];
		opportunities?: PostBuilderOpportunity[];
		selectedOpportunityId?: string;
		selectedOpportunityAngleId?: string;
		discoverLoading?: boolean;
		discoverError?: string;
		discoverHasMore?: boolean;
		discoverEnabled?: boolean;
		showCreationModeSwitch?: boolean;
		selectedAccountIds?: string[];
		socialSetId?: string;
		destinationLabel?: string;
		voiceProfileId?: string;
		voiceLabel?: string;
		direction?: PostBuilderDirection;
		directionLabel?: string;
		destinationControl?: ControlSnippet;
		voiceControl?: ControlSnippet;
		directionControl?: ControlSnippet;
		initialRun?: PostBuilderRun | null;
		initialRunId?: string;
		pollIntervalMs?: number;
		maxSourceCharacters?: number;
		requiresDestinations?: boolean;
		copy?: Partial<PostBuilderCopy>;
		onCreationModeChange?: (mode: PostBuilderCreationMode) => void;
		onModeChange?: (mode: PostBuilderMode) => void;
		onSourceTextChange?: (value: string) => void;
		onAttach?: () => void;
		onPasteLink?: () => void;
		onRecord?: () => void;
		onAddContext?: () => void;
		onRemoveSource?: (source: PostBuilderSource) => void;
		onSourcePublishChange?: (source: PostBuilderSource, mayPublish: boolean) => void;
		onOpenDestinations?: () => void;
		onOpenVoice?: () => void;
		onOpenDirection?: () => void;
		onSelectStarterIdea?: (idea: PostBuilderStarterIdea) => void;
		onLoadMoreStarterIdeas?: () => void;
		onSelectOpportunity?: (opportunity: PostBuilderOpportunity) => void;
		onSelectOpportunityAngle?: (
			opportunity: PostBuilderOpportunity,
			angle: PostBuilderOpportunityAngle
		) => void;
		onRefreshDiscover?: () => void;
		onLoadMoreOpportunities?: () => void;
		onRunChange?: (run: PostBuilderRun) => void;
		onReset?: () => void;
		onCommit?: (result: PostBuilderCommitResult) => void | Promise<void>;
		onMediaAction?: (
			result: PostBuilderCommitResult,
			item: PostBuilderMediaPlanItem
		) => void | Promise<void>;
		onError?: (error: Error) => void;
	}

	let {
		workspaceId,
		client,
		creationMode = 'builder',
		mode = $bindable('source'),
		sourceText = $bindable(''),
		sources = [],
		starterIdeas = [],
		opportunities = [],
		selectedOpportunityId = $bindable(''),
		selectedOpportunityAngleId = $bindable(''),
		discoverLoading = false,
		discoverError = '',
		discoverHasMore = false,
		discoverEnabled = true,
		showCreationModeSwitch = true,
		selectedAccountIds = [],
		socialSetId = '',
		destinationLabel = 'Choose destinations',
		voiceProfileId = '',
		voiceLabel = 'Account defaults',
		direction = {},
		directionLabel,
		destinationControl,
		voiceControl,
		directionControl,
		initialRun = null,
		initialRunId = '',
		pollIntervalMs = 1_200,
		maxSourceCharacters = 10_000,
		requiresDestinations = true,
		copy: copyOverrides = {},
		onCreationModeChange,
		onModeChange,
		onSourceTextChange,
		onAttach,
		onPasteLink,
		onRecord,
		onAddContext,
		onRemoveSource,
		onSourcePublishChange,
		onOpenDestinations,
		onOpenVoice,
		onOpenDirection,
		onSelectStarterIdea,
		onLoadMoreStarterIdeas,
		onSelectOpportunity,
		onSelectOpportunityAngle,
		onRefreshDiscover,
		onLoadMoreOpportunities,
		onRunChange,
		onReset,
		onCommit,
		onMediaAction,
		onError
	}: Props = $props();

	const copy = $derived(postBuilderCopy(copyOverrides));
	const resolvedDirectionLabel = $derived(
		directionLabel?.trim() || postBuilderDirectionLabel(direction)
	);
	const sourceCharacterCount = $derived(Array.from(sourceText).length);
	const sourceProcessing = $derived(
		mode === 'source' && sources.some((source) => source.status === 'processing')
	);

	let run = $state.raw<PostBuilderRun | null>(untrack(() => initialRun));
	let operation = $state<'creating' | 'cancelling' | 'retrying' | 'committing' | 'resuming' | ''>(
		''
	);
	let localError = $state('');
	let watchController: AbortController | null = null;
	let operationController: AbortController | null = null;
	let watchSequence = 0;
	let resumedRunId = '';
	let mediaActionId = $state('');

	const runActive = $derived(postBuilderRunIsActive(run));
	const runReady = $derived(run?.phase === 'ready' && Boolean(run.result));
	const formLocked = $derived(runActive || runReady || Boolean(operation));

	function reportError(cause: unknown, fallback = copy.requestFailed): void {
		if (isPostBuilderAbort(cause)) return;
		const error = cause instanceof Error ? cause : new Error(fallback);
		localError = error.message || fallback;
		onError?.(error);
	}

	function setRun(next: PostBuilderRun): void {
		run = next;
		onRunChange?.(next);
	}

	function stopWatching(): void {
		watchSequence += 1;
		watchController?.abort();
		watchController = null;
	}

	function startWatching(initial: PostBuilderRun): void {
		if (!postBuilderRunIsActive(initial)) return;
		stopWatching();
		const sequence = watchSequence;
		const controller = new AbortController();
		watchController = controller;
		void watchPostBuilderRun(client, initial.id, {
			initialRun: initial,
			intervalMs: pollIntervalMs,
			signal: controller.signal,
			onUpdate(next) {
				if (sequence !== watchSequence) return;
				setRun(next);
			}
		}).catch((cause) => {
			if (sequence !== watchSequence || isPostBuilderAbort(cause)) return;
			reportError(cause);
		});
	}

	async function resumeRun(runId: string): Promise<void> {
		if (!runId.trim() || operation) return;
		operation = 'resuming';
		localError = '';
		stopWatching();
		const controller = new AbortController();
		operationController = controller;
		try {
			const restored = await client.load(runId, { signal: controller.signal });
			setRun(restored);
			startWatching(restored);
		} catch (cause) {
			reportError(cause);
		} finally {
			if (operationController === controller) operationController = null;
			operation = '';
		}
	}

	function validationMessage(code: PostBuilderValidationCode): string {
		if (code === 'workspace_required') return copy.workspaceRequired;
		if (code === 'source_required') return copy.sourceRequired;
		if (code === 'opportunity_required') return copy.opportunityRequired;
		return copy.destinationsRequired;
	}

	async function buildPost(event?: SubmitEvent): Promise<void> {
		event?.preventDefault();
		if (operation || runActive || runReady) return;
		const draft = {
			workspaceId,
			mode,
			sourceText,
			sources,
			selectedOpportunityId,
			selectedOpportunityAngleId,
			socialSetId,
			selectedAccountIds,
			voiceProfileId,
			direction,
			requiresDestinations
		};
		const issues = validatePostBuilderDraft(draft);
		if (issues.length > 0) {
			localError = validationMessage(issues[0]);
			return;
		}

		localError = '';
		operation = 'creating';
		operationController?.abort();
		const controller = new AbortController();
		operationController = controller;
		try {
			const created = await client.create(createPostBuilderRunInput(draft), {
				signal: controller.signal
			});
			setRun(created);
			startWatching(created);
		} catch (cause) {
			reportError(cause);
		} finally {
			if (operationController === controller) operationController = null;
			operation = '';
		}
	}

	async function cancelBuild(): Promise<void> {
		if (!run || !runActive || operation) return;
		operation = 'cancelling';
		localError = '';
		stopWatching();
		const controller = new AbortController();
		operationController = controller;
		try {
			const cancelled = await client.cancel(run.id, { signal: controller.signal });
			setRun(cancelled);
		} catch (cause) {
			reportError(cause);
			if (!isPostBuilderAbort(cause) && run) startWatching(run);
		} finally {
			if (operationController === controller) operationController = null;
			operation = '';
		}
	}

	async function retryBuild(): Promise<void> {
		if (!run || run.canRetry !== true || operation) return;
		operation = 'retrying';
		localError = '';
		stopWatching();
		const controller = new AbortController();
		operationController = controller;
		try {
			const retried = await client.retry(run.id, { signal: controller.signal });
			setRun(retried);
			startWatching(retried);
		} catch (cause) {
			reportError(cause);
		} finally {
			if (operationController === controller) operationController = null;
			operation = '';
		}
	}

	async function commitBuild(): Promise<void> {
		if (!run || !runReady || operation) return;
		operation = 'committing';
		localError = '';
		const controller = new AbortController();
		operationController = controller;
		try {
			const result = await client.commit(run.id, { signal: controller.signal });
			await onCommit?.(result);
		} catch (cause) {
			reportError(cause);
		} finally {
			if (operationController === controller) operationController = null;
			operation = '';
		}
	}

	async function commitForMedia(item: PostBuilderMediaPlanItem): Promise<void> {
		if (!run || !runReady || !item.action || !onMediaAction || operation) return;
		operation = 'committing';
		mediaActionId = item.id;
		localError = '';
		const controller = new AbortController();
		operationController = controller;
		try {
			const result = await client.commit(run.id, { signal: controller.signal });
			await onMediaAction(result, item);
		} catch (cause) {
			reportError(cause);
		} finally {
			if (operationController === controller) operationController = null;
			operation = '';
			mediaActionId = '';
		}
	}

	function resetBuild(): void {
		if (operation || runActive) return;
		stopWatching();
		run = null;
		resumedRunId = '';
		mediaActionId = '';
		localError = '';
		onReset?.();
	}

	function changeBuilderMode(next: string): void {
		if (next !== 'source' && next !== 'discover') return;
		if (next === 'discover' && !discoverEnabled) return;
		mode = next;
		localError = '';
		onModeChange?.(next);
	}

	function handleSourceInput(event: Event & { currentTarget: HTMLTextAreaElement }): void {
		const value = event.currentTarget.value;
		sourceText = value;
		localError = '';
		onSourceTextChange?.(value);
	}

	function selectStarterIdea(idea: PostBuilderStarterIdea): void {
		sourceText = idea.text;
		localError = '';
		onSourceTextChange?.(idea.text);
		onSelectStarterIdea?.(idea);
	}

	function selectOpportunity(opportunity: PostBuilderOpportunity): void {
		if (opportunity.id !== selectedOpportunityId) selectedOpportunityAngleId = '';
		selectedOpportunityId = opportunity.id;
		localError = '';
		onSelectOpportunity?.(opportunity);
	}

	function selectOpportunityAngle(
		opportunity: PostBuilderOpportunity,
		angle: PostBuilderOpportunityAngle
	): void {
		selectedOpportunityId = opportunity.id;
		selectedOpportunityAngleId = angle.id;
		localError = '';
		onSelectOpportunity?.(opportunity);
		onSelectOpportunityAngle?.(opportunity, angle);
	}

	$effect(() => {
		const nextRunId = initialRunId.trim();
		if (!nextRunId || nextRunId === resumedRunId || run?.id === nextRunId) return;
		resumedRunId = nextRunId;
		void resumeRun(nextRunId);
	});

	onMount(() => {
		if (run && postBuilderRunIsActive(run)) {
			startWatching(run);
		}
	});

	onDestroy(() => {
		stopWatching();
		operationController?.abort();
	});
</script>

<!--
THESIS: One real source becomes a reviewable package of native destination drafts. This refuses a blank AI rewrite box and a campaign wizard.
OWN-WORLD: OpenPost warm neutrals, thin borders, compact controls, and one orange action signal. No decorative effects or nested card grid.
STORY: The user adds evidence, chooses context, sees the build progress, checks the route and claims, then opens the normal composer.
FIRST VIEWPORT: A compact mode switch and page heading lead to a wide source workspace with a narrow help rail. The Build post action closes the main card.
FORM: Brief-pinned two-column Operate surface, first choice; seed brief-pinned-post-builder.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
-->

<div
	class="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-5 sm:px-6 sm:py-6 lg:px-8"
	data-testid="post-builder-shell"
>
	{#if showCreationModeSwitch}
		<div class="flex justify-center">
			<CreationModeSwitch
				value={creationMode}
				{copy}
				onChange={(next) => onCreationModeChange?.(next)}
			/>
		</div>
	{/if}

	<header class={showCreationModeSwitch ? 'mt-5' : ''}>
		<h1 class="text-xl font-semibold tracking-tight">{copy.pageTitle}</h1>
		<p class="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{copy.pageDescription}</p>
	</header>

	<div class="mt-5">
		<Tabs.Root value={mode} onValueChange={changeBuilderMode}>
			<Tabs.List variant="line" aria-label={copy.builderInputModeLabel}>
				<Tabs.Trigger value="source" class="px-2.5" disabled={formLocked}>
					<FileTextIcon class="size-3.5" />
					{copy.fromSourceMode}
				</Tabs.Trigger>
				{#if discoverEnabled}
					<Tabs.Trigger value="discover" class="px-2.5" disabled={formLocked}>
						<LayoutGridIcon class="size-3.5" />
						{copy.discoverMode}
					</Tabs.Trigger>
				{/if}
			</Tabs.List>
		</Tabs.Root>
	</div>

	<div class="mt-3 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_17.5rem]">
		<main class="min-w-0 space-y-4">
			<form
				class="overflow-hidden rounded-lg border bg-card"
				onsubmit={buildPost}
				aria-busy={runActive || operation === 'creating'}
			>
				{#if mode === 'source'}
					<div class="p-4 sm:p-6">
						<div class="mx-auto flex max-w-2xl flex-col items-center text-center">
							<span
								class="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary"
							>
								<SparklesIcon class="size-5" aria-hidden="true" />
							</span>
							<h2 class="mt-4 text-base font-semibold tracking-tight">
								{copy.builderInputHeading}
							</h2>
							<p class="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
								{copy.builderInputDescription}
							</p>
						</div>

						<div
							class="mt-5 rounded-lg border border-input bg-input/15 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30"
						>
							<label for="post-builder-source" class="sr-only">{copy.builderInputHeading}</label>
							<Textarea
								id="post-builder-source"
								value={sourceText}
								unstyled
								class="min-h-44 w-full resize-y bg-transparent px-3 py-3 text-base leading-7 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-48"
								placeholder={copy.sourcePlaceholder}
								maxlength={maxSourceCharacters > 0 ? maxSourceCharacters : undefined}
								disabled={formLocked}
								oninput={handleSourceInput}
								aria-describedby="post-builder-source-count"
							/>
							<div class="flex flex-wrap items-center gap-1.5 border-t px-2 py-2">
								<Button
									type="button"
									variant="ghost"
									size="sm"
									disabled={formLocked || !onAttach}
									onclick={onAttach}
								>
									<PaperclipIcon class="size-3.5" />
									{copy.attach}
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									disabled={formLocked || !onPasteLink}
									onclick={onPasteLink}
								>
									<LinkIcon class="size-3.5" />
									{copy.pasteLink}
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									disabled={formLocked || !onRecord}
									onclick={onRecord}
								>
									<MicIcon class="size-3.5" />
									{copy.record}
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									disabled={formLocked || !onAddContext}
									onclick={onAddContext}
								>
									<PlusIcon class="size-3.5" />
									{copy.addContext}
								</Button>
								<span
									id="post-builder-source-count"
									class="ml-auto px-1 font-mono text-[11px] text-muted-foreground tabular-nums"
								>
									{sourceCharacterCount}{maxSourceCharacters > 0 ? `/${maxSourceCharacters}` : ''}
								</span>
							</div>
						</div>

						{#if sources.length > 0}
							<div class="mt-3">
								<SourceMaterialChips
									{sources}
									{copy}
									disabled={formLocked}
									onRemove={onRemoveSource}
									onPublishChange={onSourcePublishChange}
								/>
							</div>
						{/if}
					</div>
				{:else}
					<div class="p-4 sm:p-6">
						<DiscoverOpportunities
							{opportunities}
							{selectedOpportunityId}
							{selectedOpportunityAngleId}
							{copy}
							loading={discoverLoading}
							error={discoverError}
							hasMore={discoverHasMore}
							disabled={formLocked}
							onSelect={selectOpportunity}
							onSelectAngle={selectOpportunityAngle}
							onRefresh={onRefreshDiscover}
							onLoadMore={onLoadMoreOpportunities}
						/>
					</div>
				{/if}

				<div class="border-t bg-muted/10 p-3 sm:p-4">
					<div class="grid gap-2 sm:grid-cols-3">
						{#if destinationControl}
							{@render destinationControl({ disabled: formLocked })}
						{:else}
							<Button
								type="button"
								variant="outline"
								class="min-w-0 justify-start"
								disabled={formLocked || !onOpenDestinations}
								onclick={onOpenDestinations}
							>
								<UsersIcon class="size-4" />
								<span class="min-w-0 truncate">{copy.destinations}: {destinationLabel}</span>
							</Button>
						{/if}

						{#if voiceControl}
							{@render voiceControl({ disabled: formLocked })}
						{:else}
							<Button
								type="button"
								variant="outline"
								class="min-w-0 justify-start"
								disabled={formLocked || !onOpenVoice}
								onclick={onOpenVoice}
							>
								<UserIcon class="size-4" />
								<span class="min-w-0 truncate">{copy.voice}: {voiceLabel}</span>
							</Button>
						{/if}

						{#if directionControl}
							{@render directionControl({ disabled: formLocked })}
						{:else}
							<Button
								type="button"
								variant="outline"
								class="min-w-0 justify-start"
								disabled={formLocked || !onOpenDirection}
								onclick={onOpenDirection}
							>
								<SlidersIcon class="size-4" />
								<span class="min-w-0 truncate">{copy.direction}: {resolvedDirectionLabel}</span>
							</Button>
						{/if}
					</div>

					{#if localError}
						<div class="mt-3">
							<InlineNotice
								tone="error"
								message={localError}
								onDismiss={() => (localError = '')}
								dismissLabel={copy.dismissError}
							/>
						</div>
					{/if}

					{#if run?.phase === 'failed'}
						<div class="mt-3">
							<InlineNotice tone="error" message={run.error?.message || copy.requestFailed}>
								{#snippet actions()}
									<Button
										type="button"
										variant="ghost"
										size="sm"
										disabled={Boolean(operation)}
										onclick={retryBuild}
									>
										{copy.retryBuild}
									</Button>
								{/snippet}
							</InlineNotice>
						</div>
					{:else if run?.phase === 'cancelled'}
						<div class="mt-3">
							<InlineNotice tone="info" message={run.message || copy.buildCancelled} />
						</div>
					{/if}

					{#if runActive && run}
						<div class="mt-3">
							<BuildProgress
								{run}
								{copy}
								cancelling={operation === 'cancelling'}
								onCancel={cancelBuild}
							/>
						</div>
					{/if}

					{#if !runReady && !runActive}
						<Button
							type="submit"
							size="lg"
							class="mt-3 w-full"
							disabled={operation === 'creating' || operation === 'resuming' || sourceProcessing}
						>
							<WandIcon class="size-4" />
							{operation === 'creating' || operation === 'resuming'
								? copy.buildingPost
								: mode === 'discover'
									? copy.buildOpportunity
									: copy.buildPost}
						</Button>
					{/if}

					{#if copy.privacyNote}
						<p class="mt-3 text-center text-xs leading-5 text-muted-foreground">
							{copy.privacyNote}
						</p>
					{/if}
				</div>
			</form>

			{#if runReady && run?.result}
				<BuildResultSummary
					result={run.result}
					{copy}
					committing={operation === 'committing'}
					{mediaActionId}
					onCommit={commitBuild}
					onReset={resetBuild}
					onMediaAction={onMediaAction ? commitForMedia : undefined}
				/>
			{/if}

			<div
				class="flex items-start gap-2 rounded-lg border bg-muted/20 px-3 py-2.5 text-xs leading-5 text-muted-foreground"
			>
				<SparklesIcon class="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
				<p>{copy.footerNote}</p>
			</div>
		</main>

		<BuilderRail
			{copy}
			starterIdeas={mode === 'source' ? starterIdeas : []}
			disabled={formLocked}
			onSelectStarter={selectStarterIdea}
			{onLoadMoreStarterIdeas}
		/>
	</div>
</div>
