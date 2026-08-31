<script lang="ts">
	import ImageIcon from '@lucide/svelte/icons/image';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import RefreshIcon from '@lucide/svelte/icons/refresh-cw';
	import { Button } from '$lib/components/ui/button';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import type {
		AIMemeRecommendationCandidate,
		AIMemeRecommendationCopy,
		AIMemePreviewState
	} from './ai-meme-recommendation';

	type ActiveAction = 'use' | 'edit' | `retry:${string}` | '';

	interface Props {
		candidates: AIMemeRecommendationCandidate[];
		copy: AIMemeRecommendationCopy;
		selectedCandidateId?: string;
		disabled?: boolean;
		error?: string;
		onSelect?: (candidate: AIMemeRecommendationCandidate) => void;
		onUse: (candidate: AIMemeRecommendationCandidate) => void | Promise<void>;
		onEdit: (candidate: AIMemeRecommendationCandidate) => void | Promise<void>;
		onRetry: (candidate: AIMemeRecommendationCandidate) => void | Promise<void>;
	}

	let {
		candidates,
		copy,
		selectedCandidateId = $bindable(''),
		disabled = false,
		error = '',
		onSelect,
		onUse,
		onEdit,
		onRetry
	}: Props = $props();

	const uid = $props.id();
	let activeAction = $state<ActiveAction>('');
	let actionError = $state('');

	const selectedCandidate = $derived(
		candidates.find((candidate) => candidate.id === selectedCandidateId) ?? candidates[0] ?? null
	);
	const alternatives = $derived(
		selectedCandidate
			? candidates.filter((candidate) => candidate.id !== selectedCandidate.id).slice(0, 2)
			: []
	);
	const selectedPreviewReady = $derived(Boolean(selectedCandidate?.previewUrl));
	const busy = $derived(activeAction !== '');

	$effect(() => {
		if (candidates.length === 0) {
			selectedCandidateId = '';
			return;
		}
		if (!candidates.some((candidate) => candidate.id === selectedCandidateId)) {
			selectedCandidateId = candidates[0].id;
		}
	});

	function previewState(candidate: AIMemeRecommendationCandidate): AIMemePreviewState {
		if (candidate.previewUrl) return 'ready';
		return candidate.previewState ?? 'idle';
	}

	function choose(candidate: AIMemeRecommendationCandidate): void {
		if (disabled || busy) return;
		selectedCandidateId = candidate.id;
		actionError = '';
		onSelect?.(candidate);
	}

	async function runAction(
		action: ActiveAction,
		candidate: AIMemeRecommendationCandidate,
		callback: (value: AIMemeRecommendationCandidate) => void | Promise<void>
	): Promise<void> {
		if (disabled || busy) return;
		activeAction = action;
		actionError = '';
		try {
			await callback(candidate);
		} catch (cause) {
			actionError = cause instanceof Error && cause.message ? cause.message : copy.actionFailed;
		} finally {
			if (activeAction === action) activeAction = '';
		}
	}
</script>

<section
	class="min-w-0 rounded-lg border border-border bg-card p-3 sm:p-4"
	aria-labelledby={`${uid}-title`}
>
	<header class="max-w-2xl">
		<h2 id={`${uid}-title`} class="text-base font-semibold tracking-tight">{copy.title}</h2>
		<p class="mt-1 text-sm leading-5 text-muted-foreground">{copy.description}</p>
	</header>

	{#if selectedCandidate}
		<div class="mt-4 grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(13rem,0.42fr)]">
			<div class="min-w-0 overflow-hidden rounded-lg border border-border bg-background">
				<div
					class="relative grid aspect-[4/3] min-h-48 place-items-center overflow-hidden bg-muted/45 sm:aspect-video"
				>
					{#if selectedCandidate.previewUrl}
						<img
							src={selectedCandidate.previewUrl}
							alt={selectedCandidate.suggestion.alt_text}
							class="size-full object-contain"
							decoding="async"
						/>
					{:else if previewState(selectedCandidate) === 'loading'}
						<Skeleton class="size-full rounded-none" />
						<span class="sr-only">{copy.previewLoading}</span>
					{:else}
						<div
							class="grid max-w-64 place-items-center gap-2 px-4 text-center text-sm text-muted-foreground"
						>
							<ImageIcon class="size-6" />
							<p>{copy.previewUnavailable}</p>
							<Button
								variant="ghost"
								size="sm"
								disabled={disabled || busy}
								onclick={() =>
									void runAction(`retry:${selectedCandidate.id}`, selectedCandidate, onRetry)}
							>
								{#if activeAction === `retry:${selectedCandidate.id}`}
									<LoaderIcon class="animate-spin motion-reduce:animate-none" />
									{copy.retryingLabel}
								{:else}
									<RefreshIcon />
									{copy.retryLabel}
								{/if}
							</Button>
						</div>
					{/if}
				</div>
				<div class="min-w-0 border-t border-border p-3">
					<p class="text-xs font-medium text-primary">{copy.recommendedLabel}</p>
					<h3 class="mt-1 text-sm font-semibold break-words">
						{selectedCandidate.suggestion.template.name}
					</h3>
					{#if selectedCandidate.suggestion.caption_lines.length > 0}
						<p class="mt-1 text-sm leading-5 break-words text-foreground">
							{selectedCandidate.suggestion.caption_lines.filter(Boolean).join(' · ')}
						</p>
					{/if}
					{#if selectedCandidate.suggestion.rationale}
						<p class="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">
							{selectedCandidate.suggestion.rationale}
						</p>
					{/if}
				</div>
			</div>

			{#if alternatives.length > 0}
				<div class="min-w-0">
					<h3 class="text-xs font-medium text-muted-foreground">{copy.alternativesLabel}</h3>
					<div class="mt-2 grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-1">
						{#each alternatives as candidate, index (candidate.id)}
							<div class="min-w-0 overflow-hidden rounded-lg border border-border bg-background">
								<button
									type="button"
									class="block min-h-11 w-full min-w-0 text-left transition-colors outline-none hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50"
									disabled={disabled || busy}
									onclick={() => choose(candidate)}
									aria-label={copy.selectAlternative(candidate.suggestion.template.name, index + 1)}
								>
									<span class="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2 p-2">
										<span
											class="grid aspect-[4/3] place-items-center overflow-hidden rounded-md bg-muted/45"
										>
											{#if candidate.previewUrl}
												<img
													src={candidate.previewUrl}
													alt=""
													aria-hidden="true"
													class="size-full object-contain"
													loading="lazy"
													decoding="async"
												/>
											{:else if previewState(candidate) === 'loading'}
												<Skeleton class="size-full rounded-none" />
											{:else}
												<ImageIcon class="size-5 text-muted-foreground" />
											{/if}
										</span>
										<span class="min-w-0">
											<span class="line-clamp-2 block text-xs leading-4 font-semibold">
												{candidate.suggestion.template.name}
											</span>
											<span
												class="mt-0.5 line-clamp-2 block text-xs leading-4 text-muted-foreground"
											>
												{candidate.suggestion.caption_lines.filter(Boolean).join(' · ')}
											</span>
										</span>
									</span>
								</button>
								{#if previewState(candidate) === 'failed' || previewState(candidate) === 'idle'}
									<div class="border-t border-border p-1.5">
										<Button
											variant="ghost"
											size="xs"
											class="w-full"
											disabled={disabled || busy}
											onclick={() => void runAction(`retry:${candidate.id}`, candidate, onRetry)}
										>
											{#if activeAction === `retry:${candidate.id}`}
												<LoaderIcon class="animate-spin motion-reduce:animate-none" />
												{copy.retryingLabel}
											{:else}
												<RefreshIcon />
												{copy.retryLabel}
											{/if}
										</Button>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		{#if error || actionError}
			<InlineNotice tone="error" message={error || actionError} class="mt-3" />
		{/if}

		<div class="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
			<Button
				variant="outline"
				class="w-full sm:w-auto"
				disabled={disabled || busy}
				onclick={() => void runAction('edit', selectedCandidate, onEdit)}
			>
				{#if activeAction === 'edit'}
					<LoaderIcon class="animate-spin motion-reduce:animate-none" />
					{copy.editingLabel}
				{:else}
					<PencilIcon />
					{copy.editLabel}
				{/if}
			</Button>
			<Button
				class="w-full sm:w-auto"
				disabled={disabled || busy || !selectedPreviewReady}
				onclick={() => void runAction('use', selectedCandidate, onUse)}
			>
				{#if activeAction === 'use'}
					<LoaderIcon class="animate-spin motion-reduce:animate-none" />
					{copy.usingLabel}
				{:else}
					{copy.useLabel}
				{/if}
			</Button>
		</div>
	{:else}
		<div class="mt-4 rounded-lg border border-dashed border-border px-4 py-8 text-center">
			<ImageIcon class="mx-auto size-7 text-muted-foreground" />
			<h3 class="mt-2 text-sm font-semibold">{copy.emptyTitle}</h3>
			<p class="mx-auto mt-1 max-w-md text-sm leading-5 text-muted-foreground">
				{copy.emptyDescription}
			</p>
		</div>
		{#if error}
			<InlineNotice tone="error" message={error} class="mt-3" />
		{/if}
	{/if}

	<div class="sr-only" aria-live="polite">
		{#if activeAction === 'use'}{copy.usingLabel}{/if}
		{#if activeAction === 'edit'}{copy.editingLabel}{/if}
		{#if activeAction.startsWith('retry:')}{copy.retryingLabel}{/if}
	</div>
</section>
