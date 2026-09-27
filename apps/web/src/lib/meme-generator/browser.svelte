<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Textarea } from '$lib/components/ui/textarea';
	import AppSelect from '$lib/components/app-select.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { m } from '$lib/paraglide/messages';
	import { memeGeneratorAPI, memePreviewDataURL } from '$lib/meme-generator/api';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';
	import type {
		MemeGeneratorAPI,
		MemeSuggestionCandidate,
		MemeTemplate,
		MemeTone
	} from '$lib/meme-generator/types';

	const MAX_IDEA_CHARACTERS = 1000;

	const TEMPLATE_PAGE_SIZE = 48;
	const MAX_TEMPLATE_LIMIT = 250;

	const SUGGESTION_COUNT = 4;
	type CandidatePreviewState = 'idle' | 'queued' | 'loading' | 'ready' | 'failed';

	interface Props {
		workspaceId: string;
		language?: string;
		initialIdea?: string;
		initialTone?: MemeTone;
		initialCandidate?: MemeSuggestionCandidate;
		initialPreview?: string;
		api?: MemeGeneratorAPI;
		onSelect: (
			template: MemeTemplate,
			captions: string[],
			altText?: string
		) => void | Promise<void>;
	}

	let {
		workspaceId,
		language = 'en',
		initialIdea = '',
		initialTone = 'balanced',
		initialCandidate,
		initialPreview = '',
		api = memeGeneratorAPI,
		onSelect
	}: Props = $props();

	const uid = $props.id();
	let mode = $state<'ideas' | 'templates'>('templates');
	let idea = $state('');
	let tone = $state<MemeTone>('balanced');
	let templateSearch = $state('');
	let searchedFor = $state('');
	let templates = $state.raw<MemeTemplate[]>([]);
	let templateCatalog = $state.raw<MemeTemplate[]>([]);
	let templatesLoading = $state(true);
	let templatesLoadingMore = $state(false);
	let templatesError = $state('');
	let templateLimit = $state(TEMPLATE_PAGE_SIZE);
	let templateTotal = $state(0);
	let catalogRevision = $state('');
	let rendererConfigured = $state(true);
	let aiConfigured = $state(true);
	let suggestions = $state.raw<MemeSuggestionCandidate[]>([]);
	let suggestionsLoading = $state(false);
	let hasRequestedSuggestions = $state(false);
	let suggestionsError = $state('');
	let candidatePreviews = $state.raw<Record<string, string>>({});
	let candidatePreviewStates = $state.raw<Record<string, CandidatePreviewState>>({});
	let templateThumbnailFailures = $state.raw<Record<string, true>>({});
	let templateController: AbortController | null = null;
	let suggestionController: AbortController | null = null;
	let candidatePreviewController: AbortController | null = null;
	const hasMoreTemplates = $derived(
		searchedFor
			? templates.length >= templateLimit && templateLimit < MAX_TEMPLATE_LIMIT
			: templates.length < templateTotal && templateLimit < MAX_TEMPLATE_LIMIT
	);
	const toneOptions = $derived([
		{ value: 'balanced', label: m.meme_generator_tone_balanced() },
		{ value: 'dry', label: m.meme_generator_tone_dry() },
		{ value: 'sarcastic', label: m.meme_generator_tone_sarcastic() },
		{ value: 'playful', label: m.meme_generator_tone_playful() }
	]);

	onMount(() => {
		idea = initialIdea;
		mode = initialIdea || initialCandidate ? 'ideas' : 'templates';
		tone = initialTone;
		if (initialCandidate) {
			const key = candidateKey(initialCandidate);
			suggestions = [initialCandidate];
			hasRequestedSuggestions = true;
			if (initialPreview) {
				candidatePreviews = { [key]: initialPreview };
				candidatePreviewStates = { [key]: 'ready' };
			}
			void selectCandidate(initialCandidate);
		}
		void loadTemplates('');
	});

	onDestroy(() => {
		templateController?.abort();
		suggestionController?.abort();
		candidatePreviewController?.abort();
	});

	function isAbortError(cause: unknown): boolean {
		return cause instanceof DOMException && cause.name === 'AbortError';
	}

	function mergeTemplates(current: MemeTemplate[], incoming: MemeTemplate[]): MemeTemplate[] {
		const byID = Object.fromEntries(current.map((template) => [template.id, template]));
		for (const template of incoming) byID[template.id] = template;
		return Object.values(byID);
	}

	async function loadTemplates(
		query = templateSearch,
		limit = templateLimit,
		loadingMore = false
	): Promise<void> {
		templateController?.abort();
		const controller = new AbortController();
		templateController = controller;
		if (loadingMore) {
			templatesLoadingMore = true;
		} else {
			templatesLoading = true;
			templateThumbnailFailures = {};
		}
		templatesError = '';
		searchedFor = query.trim();
		try {
			const result = await api.listTemplates({
				workspaceId,
				query: searchedFor,
				limit,
				signal: controller.signal
			});
			if (controller.signal.aborted) return;
			templates = result.templates;
			templateLimit = limit;
			templateTotal = result.catalog.total_templates;
			catalogRevision = result.catalog.revision ?? '';
			templateCatalog = searchedFor
				? mergeTemplates(templateCatalog, result.templates)
				: result.templates;
			rendererConfigured = result.configured;
			aiConfigured = result.ai_configured;
		} catch (cause) {
			if (isAbortError(cause)) return;
			templatesError = cause instanceof Error ? cause.message : m.meme_generator_templates_failed();
		} finally {
			if (templateController === controller) {
				templatesLoading = false;
				templatesLoadingMore = false;
			}
		}
	}

	function submitTemplateSearch(event: SubmitEvent): void {
		event.preventDefault();
		void loadTemplates(templateSearch, TEMPLATE_PAGE_SIZE);
	}

	function loadMoreTemplates(): void {
		const nextLimit = Math.min(MAX_TEMPLATE_LIMIT, templateLimit + TEMPLATE_PAGE_SIZE);
		void loadTemplates(searchedFor, nextLimit, true);
	}

	function candidateKey(candidate: MemeSuggestionCandidate): string {
		return `${candidate.template_id}:${candidate.caption_lines.join('\u001f')}`;
	}

	function candidatePreviewState(candidate: MemeSuggestionCandidate): CandidatePreviewState {
		const key = candidateKey(candidate);
		if (candidatePreviews[key]) return 'ready';
		return candidatePreviewStates[key] ?? 'idle';
	}

	function setCandidatePreviewState(key: string, state: CandidatePreviewState): void {
		candidatePreviewStates = { ...candidatePreviewStates, [key]: state };
	}

	function resetInterruptedCandidatePreviews(): void {
		let changed = false;
		const nextStates = { ...candidatePreviewStates };
		for (const [key, state] of Object.entries(nextStates)) {
			if (state !== 'queued' && state !== 'loading') continue;
			nextStates[key] = 'idle';
			changed = true;
		}
		if (changed) candidatePreviewStates = nextStates;
	}

	function cancelCandidatePreviewLoads(): void {
		const controller = candidatePreviewController;
		candidatePreviewController = null;
		controller?.abort();
		resetInterruptedCandidatePreviews();
	}

	function templateForCandidate(candidate: MemeSuggestionCandidate): MemeTemplate | null {
		return (
			candidate.template ??
			templateCatalog.find((template) => template.id === candidate.template_id) ??
			null
		);
	}

	function templateThumbnailURL(templateID: string): string {
		return api.thumbnailURL({
			workspaceId,
			templateId: templateID,
			catalogRevision
		});
	}

	function handleTemplateThumbnailError(templateID: string): void {
		templateThumbnailFailures = {
			...templateThumbnailFailures,
			[templateID]: true
		};
	}

	async function generateSuggestions(): Promise<void> {
		const normalizedIdea = idea.trim();
		if (!normalizedIdea) {
			suggestionsError = m.meme_generator_required_idea();
			return;
		}
		suggestionController?.abort();
		cancelCandidatePreviewLoads();
		const controller = new AbortController();
		suggestionController = controller;
		suggestionsLoading = true;
		hasRequestedSuggestions = true;
		suggestionsError = '';
		candidatePreviews = {};
		candidatePreviewStates = {};
		try {
			const result = await api.suggest({
				workspaceId,
				idea: normalizedIdea,
				tone,
				language,
				count: SUGGESTION_COUNT,
				signal: controller.signal
			});
			if (controller.signal.aborted) return;
			suggestions = result.candidates;
			void loadSuggestionPreviews(result.candidates);
		} catch (cause) {
			if (isAbortError(cause)) return;
			suggestionsError =
				cause instanceof Error ? cause.message : m.meme_generator_suggestions_failed();
		} finally {
			if (suggestionController === controller) suggestionsLoading = false;
		}
	}

	function submitIdea(event: SubmitEvent): void {
		event.preventDefault();
		void generateSuggestions();
	}

	async function loadSuggestionPreviews(candidates: MemeSuggestionCandidate[]): Promise<void> {
		cancelCandidatePreviewLoads();
		const controller = new AbortController();
		candidatePreviewController = controller;
		candidatePreviewStates = Object.fromEntries(
			candidates.map((candidate) => [candidateKey(candidate), 'queued' as const])
		);
		try {
			// Leave one server render slot free so a selected candidate can take over
			// without the speculative cards rejecting each other.
			for (const candidate of candidates) {
				if (controller.signal.aborted) break;
				const key = candidateKey(candidate);
				setCandidatePreviewState(key, 'loading');
				try {
					const result = await api.preview({
						workspaceId,
						templateId: candidate.template_id,
						captions: candidate.caption_lines,
						overlayMediaIds: [],
						format: 'webp',
						signal: controller.signal
					});
					if (!controller.signal.aborted && candidatePreviewController === controller) {
						candidatePreviews = {
							...candidatePreviews,
							[key]: memePreviewDataURL(result)
						};
						setCandidatePreviewState(key, 'ready');
					}
				} catch (cause) {
					if (controller.signal.aborted || isAbortError(cause)) break;
					if (candidatePreviewController === controller) {
						setCandidatePreviewState(key, 'failed');
					}
				}
			}
		} finally {
			if (candidatePreviewController === controller) {
				candidatePreviewController = null;
				resetInterruptedCandidatePreviews();
			}
		}
	}

	async function loadCandidatePreview(candidate: MemeSuggestionCandidate): Promise<void> {
		const template = templateForCandidate(candidate);
		if (!template) {
			setCandidatePreviewState(candidateKey(candidate), 'failed');
			return;
		}
		cancelCandidatePreviewLoads();
		const controller = new AbortController();
		candidatePreviewController = controller;
		const key = candidateKey(candidate);
		setCandidatePreviewState(key, 'loading');
		try {
			const result = await api.preview({
				workspaceId,
				templateId: candidate.template_id,
				captions: candidate.caption_lines,
				overlayMediaIds: [],
				format: 'webp',
				signal: controller.signal
			});
			if (controller.signal.aborted || candidatePreviewController !== controller) return;
			const preview = memePreviewDataURL(result);
			candidatePreviews = { ...candidatePreviews, [key]: preview };
			setCandidatePreviewState(key, 'ready');
		} catch (cause) {
			if (controller.signal.aborted || isAbortError(cause)) return;
			if (candidatePreviewController === controller) {
				setCandidatePreviewState(key, 'failed');
			}
		} finally {
			if (candidatePreviewController === controller) candidatePreviewController = null;
		}
	}

	async function selectTemplate(template: MemeTemplate): Promise<void> {
		await select(template, template.example.text);
	}
	async function selectCandidate(candidate: MemeSuggestionCandidate): Promise<void> {
		await select(candidate.template, candidate.caption_lines, candidate.alt_text);
	}
	let selecting = $state(false);
	async function select(template: MemeTemplate, captions: string[], altText = ''): Promise<void> {
		if (selecting) return;
		selecting = true;
		cancelCandidatePreviewLoads();
		try {
			await onSelect(template, captions, altText);
		} catch (cause) {
			templatesError = cause instanceof Error ? cause.message : m.templates_save_failed();
		} finally {
			selecting = false;
		}
	}
</script>

<div class="meme-generator min-h-0 min-w-0 flex-1" style="container-type: inline-size;">
	{#if !rendererConfigured && !templatesLoading}
		<InlineNotice tone="warning" message={m.meme_generator_renderer_unavailable()} class="m-3" />
	{/if}

	<div class="meme-workspace">
		<section
			class="meme-browser min-w-0 p-3 sm:p-4"
			aria-label={m.meme_generator_templates_heading()}
		>
			<Tabs.Root bind:value={mode}>
				<Tabs.List class="grid w-full grid-cols-2">
					<Tabs.Trigger value="ideas">
						<ThemeIcon role="sparkles" />
						{m.meme_generator_ideas_tab()}
					</Tabs.Trigger>
					<Tabs.Trigger value="templates">
						<ThemeIcon role="image" />
						{m.meme_generator_templates_tab()}
					</Tabs.Trigger>
				</Tabs.List>

				<Tabs.Content value="ideas" class="mt-4 space-y-4">
					{#if !aiConfigured && !templatesLoading}
						<InlineNotice tone="warning" message={m.meme_generator_ai_unavailable()}>
							{#snippet actions()}
								<Button variant="outline" size="sm" onclick={() => (mode = 'templates')}>
									{m.meme_generator_browse_instead()}
								</Button>
							{/snippet}
						</InlineNotice>
					{:else}
						<form class="space-y-3" onsubmit={submitIdea}>
							<div class="space-y-1.5">
								<Label for={`${uid}-idea`}>{m.meme_generator_idea_label()}</Label>
								<Textarea
									id={`${uid}-idea`}
									bind:value={idea}
									maxlength={MAX_IDEA_CHARACTERS}
									rows={4}
									placeholder={m.meme_generator_idea_placeholder()}
									disabled={suggestionsLoading || !rendererConfigured}
									aria-invalid={Boolean(suggestionsError && !idea.trim())}
								/>
							</div>
							<div class="idea-actions">
								<div class="min-w-0 space-y-1.5">
									<Label for={`${uid}-tone`}>{m.meme_generator_tone_label()}</Label>
									<AppSelect
										id={`${uid}-tone`}
										value={tone}
										options={toneOptions}
										ariaLabel={m.meme_generator_tone_label()}
										disabled={suggestionsLoading || !rendererConfigured}
										onValueChange={(value) => (tone = value as MemeTone)}
									/>
								</div>
								<Button
									type="submit"
									class="w-full self-end"
									disabled={suggestionsLoading || !rendererConfigured}
								>
									{#if suggestionsLoading}
										<ProtectedIcon icon="loading" class="animate-spin motion-reduce:animate-none" />
										{m.meme_generator_generating()}
									{:else}
										<ThemeIcon role="sparkles" />
										{m.meme_generator_generate()}
									{/if}
								</Button>
							</div>
						</form>
					{/if}

					{#if suggestionsError}
						<InlineNotice tone="error" message={suggestionsError}>
							{#if idea.trim()}
								{#snippet actions()}
									<Button variant="ghost" size="sm" onclick={() => void generateSuggestions()}>
										<ThemeIcon role="refresh" />
										{m.common_retry()}
									</Button>
								{/snippet}
							{/if}
						</InlineNotice>
					{/if}

					{#if suggestionsLoading}
						<div class="candidate-grid" aria-label={m.meme_generator_generating()}>
							{#each ['one', 'two', 'three', 'four'] as key (key)}
								<div class="overflow-hidden rounded-lg border border-border bg-card p-2">
									<Skeleton class="aspect-[4/3] w-full" />
									<Skeleton class="mt-2 h-4 w-4/5" />
									<Skeleton class="mt-1.5 h-3 w-3/5" />
								</div>
							{/each}
						</div>
					{:else if suggestions.length > 0}
						<div class="space-y-2">
							<div>
								<h3 class="text-sm font-semibold">
									{m.meme_generator_suggestions_heading()}
								</h3>
								<p class="mt-0.5 text-xs leading-5 text-muted-foreground">
									{m.meme_generator_suggestions_description()}
								</p>
							</div>
							<div class="candidate-grid">
								{#each suggestions as candidate (candidateKey(candidate))}
									{@const template = templateForCandidate(candidate)}
									{@const previewState = candidatePreviewState(candidate)}
									{#if template}
										<div
											class="candidate-choice relative min-w-0 overflow-hidden rounded-lg border border-border bg-card hover:border-primary/45 hover:bg-muted/35"
										>
											<Button
												variant="ghost"
												class="h-auto w-full min-w-0 items-stretch justify-start rounded-none p-2 text-left whitespace-normal md:h-auto"
												disabled={selecting || !rendererConfigured}
												onclick={() => selectCandidate(candidate)}
												aria-label={m.meme_generator_candidate_select({
													name: template.name
												})}
											>
												<span class="block w-full">
													<span
														class="relative block aspect-[4/3] overflow-hidden rounded-md bg-muted"
													>
														{#if candidatePreviews[candidateKey(candidate)]}
															<img
																src={candidatePreviews[candidateKey(candidate)]}
																alt=""
																aria-hidden="true"
																class="size-full object-contain"
																loading="lazy"
																decoding="async"
															/>
														{:else if previewState === 'failed'}
															<span
																class="grid size-full place-items-center gap-1 px-3 text-center text-xs leading-4 text-muted-foreground"
															>
																<ProtectedIcon icon="media-image" class="size-5" />
																{m.meme_generator_candidate_preview_failed()}
															</span>
														{:else if previewState === 'queued' || previewState === 'loading'}
															<Skeleton class="size-full" />
															<span class="sr-only"
																>{m.meme_generator_candidate_preview_loading()}</span
															>
														{:else}
															<span
																class="grid size-full place-items-center gap-1 px-3 text-center text-xs leading-4 text-muted-foreground"
															>
																<ProtectedIcon icon="media-image" class="size-5" />
																{m.meme_generator_candidate_preview_not_loaded()}
															</span>
														{/if}
													</span>
													<span class="mt-2 block truncate text-sm font-semibold"
														>{template.name}</span
													>
													<span
														class="mt-0.5 line-clamp-2 block text-xs leading-4 text-muted-foreground"
													>
														{candidate.rationale ||
															candidate.caption_lines.filter(Boolean).join(' · ')}
													</span>
												</span>
											</Button>
											{#if previewState === 'idle' || previewState === 'failed'}
												<div class="border-t border-border p-1.5">
													<Button
														variant="ghost"
														size="xs"
														class="w-full"
														onclick={() => void loadCandidatePreview(candidate)}
													>
														<ThemeIcon role="refresh" />
														{previewState === 'failed'
															? m.meme_generator_candidate_preview_retry()
															: m.meme_generator_candidate_preview_load()}
													</Button>
												</div>
											{/if}
										</div>
									{/if}
								{/each}
							</div>
							<Button variant="ghost" size="sm" onclick={() => void generateSuggestions()}>
								<ThemeIcon role="refresh" />
								{m.meme_generator_try_another_set()}
							</Button>
						</div>
					{:else if hasRequestedSuggestions && idea.trim() && !suggestionsError}
						<EmptyState
							themeIconRole="sparkles"
							title={m.meme_generator_no_suggestions_title()}
							description={m.meme_generator_no_suggestions_body()}
							actionLabel={m.meme_generator_try_another_set()}
							onAction={() => void generateSuggestions()}
							headingLevel={3}
							variant="muted"
						/>
					{/if}
				</Tabs.Content>

				<Tabs.Content value="templates" class="mt-4 space-y-4">
					<form class="flex items-end gap-2" onsubmit={submitTemplateSearch}>
						<div class="min-w-0 flex-1 space-y-1.5">
							<Label for={`${uid}-search`}>{m.meme_generator_search_label()}</Label>
							<div class="relative">
								<ThemeIcon
									role="search"
									class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
								/>
								<Input
									id={`${uid}-search`}
									bind:value={templateSearch}
									class="pl-9"
									maxlength={120}
									placeholder={m.meme_generator_search_placeholder()}
									disabled={templatesLoading}
								/>
							</div>
						</div>
						<Button type="submit" variant="outline" disabled={templatesLoading}>
							{#if templatesLoading}
								<ProtectedIcon icon="loading" class="animate-spin motion-reduce:animate-none" />
							{:else}
								<ThemeIcon role="search" />
							{/if}
							{m.media_picker_search_action()}
						</Button>
					</form>

					{#if templatesError}
						<InlineNotice tone="error" message={templatesError}>
							{#snippet actions()}
								<Button variant="ghost" size="sm" onclick={() => void loadTemplates()}>
									<ThemeIcon role="refresh" />
									{m.common_retry()}
								</Button>
							{/snippet}
						</InlineNotice>
					{/if}

					<div class="flex items-center justify-between gap-3">
						<h3 class="text-sm font-semibold">
							{m.meme_generator_templates_heading()}
						</h3>
						{#if templates.length > 0}
							<span class="text-xs text-muted-foreground">
								{m.meme_generator_showing_templates({
									count: templates.length
								})}
							</span>
						{/if}
					</div>

					{#if templatesLoading}
						<div class="template-grid" role="status" aria-label={m.common_loading()}>
							{#each ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'] as key (key)}
								<div class="overflow-hidden rounded-lg border border-border bg-card p-2">
									<Skeleton class="aspect-[4/3] w-full" />
									<Skeleton class="mt-2 h-4 w-3/4" />
								</div>
							{/each}
						</div>
					{:else if templates.length > 0}
						<div class="template-grid">
							{#each templates as template (template.id)}
								<Button
									variant="ghost"
									class="template-choice relative h-auto min-w-0 items-stretch justify-start overflow-hidden rounded-lg border border-border bg-card p-2 text-left whitespace-normal hover:border-primary/45 hover:bg-muted/35 md:h-auto"
									disabled={selecting || !rendererConfigured}
									onclick={() => selectTemplate(template)}
									aria-label={m.meme_generator_template_select({
										name: template.name
									})}
								>
									<span class="block w-full">
										<span class="relative block aspect-[4/3] overflow-hidden rounded-md bg-muted">
											{#if templateThumbnailFailures[template.id]}
												<span class="grid size-full place-items-center text-muted-foreground">
													<ProtectedIcon icon="media-image" class="size-6" />
													<span class="sr-only">{m.media_preview_unavailable()}</span>
												</span>
											{:else}
												<img
													src={templateThumbnailURL(template.id)}
													alt=""
													aria-hidden="true"
													class="size-full object-contain"
													loading="lazy"
													decoding="async"
													onerror={() => handleTemplateThumbnailError(template.id)}
												/>
											{/if}
										</span>
										<span class="mt-2 flex min-w-0 items-center gap-2">
											<span class="min-w-0 flex-1 truncate text-sm font-semibold"
												>{template.name}</span
											>
											{#if template.animated}
												<Badge>{m.meme_generator_animated()}</Badge>
											{/if}
										</span>
									</span>
								</Button>
							{/each}
						</div>
						{#if hasMoreTemplates}
							<Button
								variant="outline"
								class="w-full"
								disabled={templatesLoadingMore}
								onclick={loadMoreTemplates}
							>
								{#if templatesLoadingMore}
									<ProtectedIcon icon="loading" class="animate-spin motion-reduce:animate-none" />
								{/if}
								{m.meme_generator_show_more()}
							</Button>
						{/if}
					{:else if !templatesError}
						<EmptyState
							themeIconRole="search"
							title={m.meme_generator_templates_empty_title()}
							description={m.meme_generator_templates_empty_body()}
							actionLabel={searchedFor ? m.media_clear_search() : undefined}
							onAction={searchedFor
								? () => {
										templateSearch = '';
										void loadTemplates('', TEMPLATE_PAGE_SIZE);
									}
								: undefined}
							headingLevel={3}
							variant="muted"
						/>
					{/if}
				</Tabs.Content>
			</Tabs.Root>
		</section>
	</div>

	<div class="sr-only" aria-live="polite">
		{#if suggestionsLoading}{m.meme_generator_generating()}{/if}
	</div>
</div>

<style>
	.meme-generator {
		min-width: 0;
		width: 100%;
	}
	.candidate-grid,
	.template-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 180px), 1fr));
		gap: 0.75rem;
	}
	.idea-actions {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.75rem;
	}
	@container (min-width:34rem) {
		.idea-actions {
			grid-template-columns: minmax(0, 0.72fr) minmax(11rem, 1fr);
		}
	}
</style>
