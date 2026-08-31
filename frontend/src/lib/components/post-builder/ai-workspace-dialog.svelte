<script lang="ts">
	import type { Snippet } from 'svelte';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { cn } from '$lib/utils';
	import AIAngleGrid from './ai-angle-grid.svelte';
	import AIGenerationProgress from './ai-generation-progress.svelte';
	import AIOpportunityGrid from './ai-opportunity-grid.svelte';
	import type {
		AIAngle,
		AIGenerationPhase,
		AIOpportunity,
		AIWorkspaceDialogCopy,
		AIWorkspaceEntry,
		AIWorkspaceStep
	} from './ai-workspace-types';

	interface Props {
		open?: boolean;
		entry: AIWorkspaceEntry;
		step: AIWorkspaceStep;
		copy: AIWorkspaceDialogCopy;
		opportunities?: AIOpportunity[];
		selectedOpportunityId?: string;
		angles?: AIAngle[];
		selectedAngleId?: string;
		generationPhases?: AIGenerationPhase[];
		generationMessage?: string;
		destinationSummary?: string;
		voiceSummary?: string;
		loadingOpportunities?: boolean;
		opportunityLoadingMessage?: string;
		findingMore?: boolean;
		generating?: boolean;
		generationActive?: boolean;
		cancelling?: boolean;
		canCancel?: boolean;
		applyPending?: boolean;
		error?: string;
		context?: Snippet;
		onSelectOpportunity: (opportunity: AIOpportunity) => void;
		onSelectAngle: (angle: AIAngle) => void;
		onDiscover?: () => void;
		onContinue?: () => void;
		onFindMore?: () => void;
		onBack?: () => void;
		onBuild: () => void;
		onCancel?: () => void;
		onRetry?: () => void;
		onApply?: () => void;
		onKeepEditing?: () => void;
		onDismissError?: () => void;
	}

	let {
		open = $bindable(false),
		entry,
		step,
		copy,
		opportunities = [],
		selectedOpportunityId = '',
		angles = [],
		selectedAngleId = '',
		generationPhases = [],
		generationMessage = '',
		destinationSummary = '',
		voiceSummary = '',
		loadingOpportunities = false,
		opportunityLoadingMessage = '',
		findingMore = false,
		generating = false,
		generationActive = false,
		cancelling = false,
		canCancel = false,
		applyPending = false,
		error = '',
		context,
		onSelectOpportunity,
		onSelectAngle,
		onDiscover,
		onContinue,
		onFindMore,
		onBack,
		onBuild,
		onCancel,
		onRetry,
		onApply,
		onKeepEditing,
		onDismissError
	}: Props = $props();

	const title = $derived(entry === 'ideate' ? copy.ideateTitle : copy.buildTitle);
	const description = $derived(entry === 'ideate' ? copy.ideateDescription : copy.buildDescription);
	const canBuild = $derived(Boolean(selectedAngleId) && !generating && !cancelling);
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class={cn(
			'flex flex-col gap-0 overflow-hidden p-0 transition-none motion-reduce:transition-none! sm:transition-[width,height] sm:duration-[260ms] sm:ease-[cubic-bezier(0.16,1,0.3,1)]',
			step === 'brief'
				? 'h-[min(22rem,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] w-[min(42rem,calc(100vw-2rem))] max-w-[42rem] rounded-xl sm:max-w-[42rem]'
				: 'h-dvh max-h-dvh max-w-none rounded-none sm:h-[min(760px,calc(100dvh-2rem))] sm:w-[min(96vw,90rem)] sm:max-w-[90rem] sm:rounded-xl'
		)}
		data-testid="ai-workspace-dialog"
	>
		<Dialog.Header class="shrink-0 border-b px-4 py-3 pr-14 text-left sm:px-6 sm:py-4">
			<div class="flex items-start gap-3">
				<span
					class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
					aria-hidden="true"
				>
					<SparklesIcon class="size-4" />
				</span>
				<div class="min-w-0 flex-1">
					<Dialog.Title>{title}</Dialog.Title>
					<Dialog.Description class="mt-1 max-w-3xl">{description}</Dialog.Description>
					{#if destinationSummary || voiceSummary}
						<p class="mt-2 text-xs text-muted-foreground">
							{[destinationSummary, voiceSummary].filter(Boolean).join(' · ')}
						</p>
					{/if}
				</div>
			</div>
		</Dialog.Header>

		<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
			{#if context}
				<div class="mb-4">{@render context()}</div>
			{/if}
			{#if error}
				<InlineNotice
					tone="error"
					message={error}
					class="mb-4"
					onDismiss={onRetry ? undefined : onDismissError}
					dismissLabel={copy.dismiss}
				>
					{#snippet actions()}
						{#if onRetry}
							<Button type="button" variant="ghost" size="sm" onclick={onRetry}>
								{copy.retry}
							</Button>
						{/if}
					{/snippet}
				</InlineNotice>
			{/if}

			{#if step === 'opportunities' && !error}
				<AIOpportunityGrid
					{opportunities}
					selectedId={selectedOpportunityId}
					copy={copy.opportunities}
					loading={loadingOpportunities}
					loadingMessage={opportunityLoadingMessage}
					disabled={findingMore}
					onSelect={onSelectOpportunity}
				/>
			{:else if step === 'angles'}
				<AIAngleGrid
					{angles}
					selectedId={selectedAngleId}
					copy={copy.angles}
					loading={generating}
					disabled={generating}
					onSelect={onSelectAngle}
				/>
			{:else if step === 'generating'}
				<AIGenerationProgress
					phases={generationPhases}
					copy={copy.progress}
					message={generationMessage}
					active={generationActive}
				/>
			{/if}
		</div>

		<div class="shrink-0 border-t bg-background px-4 py-3 sm:px-6">
			<div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
				<div>
					{#if step === 'angles' && onBack}
						<Button type="button" variant="ghost" onclick={onBack} disabled={generating}>
							<ArrowLeftIcon class="size-4" />
							{copy.back}
						</Button>
					{:else if step === 'opportunities' && !error && opportunities.length > 0 && onFindMore}
						<Button
							type="button"
							variant="ghost"
							disabled={loadingOpportunities || findingMore}
							onclick={onFindMore}
							aria-busy={findingMore}
						>
							{#if findingMore}<LoaderIcon
									class="size-4 animate-spin motion-reduce:animate-none"
								/>{/if}
							{findingMore ? copy.findingMore : copy.findMore}
						</Button>
					{/if}
				</div>

				{#if step === 'brief' && onDiscover}
					<Button type="button" onclick={onDiscover}>{copy.getIdeas}</Button>
				{:else if step === 'opportunities' && !error && opportunities.length > 0 && onContinue}
					<Button
						type="button"
						disabled={!selectedOpportunityId || loadingOpportunities || findingMore}
						onclick={onContinue}
					>
						{copy.continue}
					</Button>
				{:else if step === 'opportunities' && !error && opportunities.length === 0 && onFindMore}
					<Button
						type="button"
						disabled={loadingOpportunities || findingMore}
						onclick={onFindMore}
						aria-busy={loadingOpportunities || findingMore}
					>
						{#if loadingOpportunities || findingMore}<LoaderIcon
								class="size-4 animate-spin motion-reduce:animate-none"
							/>{/if}
						{findingMore ? copy.findingMore : copy.retry}
					</Button>
				{:else if step === 'angles'}
					<Button type="button" disabled={!canBuild} onclick={onBuild} aria-busy={generating}>
						{copy.buildDrafts}
					</Button>
				{:else if applyPending && onApply}
					<div class="flex flex-col-reverse gap-2 sm:flex-row">
						{#if onKeepEditing}
							<Button type="button" variant="ghost" onclick={onKeepEditing}>{copy.keepEdits}</Button
							>
						{/if}
						<Button type="button" onclick={onApply}>{copy.reviewApply}</Button>
					</div>
				{:else if canCancel && onCancel}
					<Button
						type="button"
						variant="outline"
						disabled={cancelling}
						onclick={onCancel}
						aria-busy={cancelling}
					>
						{#if cancelling}<LoaderIcon
								class="size-4 animate-spin motion-reduce:animate-none"
							/>{/if}
						{cancelling ? copy.cancelling : copy.cancel}
					</Button>
				{/if}
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
