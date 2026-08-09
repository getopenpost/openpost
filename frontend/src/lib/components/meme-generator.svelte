<!--
THESIS: Meme making is one fast decision loop: find a visual premise, edit the joke, attach it.
OWN-WORLD: OpenPost's warm neutral surfaces, precise borders, compact controls, and scarce orange selection signal.
STORY: Start from an idea or template, compare concrete options, then refine one editable recipe.
FIRST VIEWPORT: Discovery sits beside a larger live preview; on phones the same editor follows the selected option.
FORM: Operate-mode extension of the established composer, using a responsive workbench rather than a card dashboard.
-->
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
	import CheckIcon from 'lucide-svelte/icons/check';
	import ImageIcon from 'lucide-svelte/icons/image';
	import ImagePlusIcon from 'lucide-svelte/icons/image-plus';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import RefreshIcon from 'lucide-svelte/icons/refresh-cw';
	import SearchIcon from 'lucide-svelte/icons/search';
	import SearchXIcon from 'lucide-svelte/icons/search-x';
	import SparklesIcon from 'lucide-svelte/icons/sparkles';
	import WandIcon from 'lucide-svelte/icons/wand-sparkles';
	import ExternalLinkIcon from 'lucide-svelte/icons/external-link';
	import { m } from '$lib/paraglide/messages';
	import { memeGeneratorAPI, memePreviewDataURL } from '$lib/meme-generator/api';
	import type {
		MemeGeneratorAPI,
		MemeOverlaySelection,
		MemeRenderResult,
		MemeSuggestionCandidate,
		MemeTemplate,
		MemeTone
	} from '$lib/meme-generator/types';

	const MAX_IDEA_CHARACTERS = 1000;
	const MAX_CAPTION_CHARACTERS = 200;
	const TEMPLATE_PAGE_SIZE = 24;
	const MAX_TEMPLATE_LIMIT = 250;
	const MAX_CACHED_THUMBNAILS = 32;
	const MAX_CONCURRENT_THUMBNAILS = 2;
	const MAX_CONCURRENT_CANDIDATE_PREVIEWS = 1;
	const PREVIEW_DEBOUNCE_MS = 320;
	const SUGGESTION_COUNT = 4;

	interface Props {
		workspaceId: string;
		language?: string;
		initialIdea?: string;
		initialTone?: MemeTone;
		parentMediaId?: string;
		api?: MemeGeneratorAPI;
		onPickOverlay?: (
			index: number,
			current: MemeOverlaySelection | null
		) => MemeOverlaySelection | null | Promise<MemeOverlaySelection | null>;
		onAttach: (result: MemeRenderResult) => void | Promise<void>;
	}

	let {
		workspaceId,
		language = 'en',
		initialIdea = '',
		initialTone = 'balanced',
		parentMediaId = '',
		api = memeGeneratorAPI,
		onPickOverlay,
		onAttach
	}: Props = $props();

	const uid = $props.id();
	let mode = $state<'ideas' | 'templates'>('ideas');
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
	let rendererConfigured = $state(true);
	let aiConfigured = $state(true);
	let suggestions = $state.raw<MemeSuggestionCandidate[]>([]);
	let suggestionsLoading = $state(false);
	let hasRequestedSuggestions = $state(false);
	let suggestionsError = $state('');
	let candidatePreviews = $state.raw<Record<string, string>>({});
	let candidatePreviewFailures = $state.raw<Record<string, true>>({});
	let templateThumbnails = $state.raw<Record<string, string>>({});
	let templateThumbnailFailures = $state.raw<Record<string, true>>({});
	let thumbnailOrder: string[] = [];
	let selectedTemplateID = $state('');
	let selectedTemplateSnapshot = $state.raw<MemeTemplate | null>(null);
	let selectedCandidate = $state.raw<MemeSuggestionCandidate | null>(null);
	let captions = $state.raw<string[]>([]);
	let overlaySelections = $state.raw<Array<MemeOverlaySelection | null>>([]);
	let selectedPreview = $state('');
	let previewLoading = $state(false);
	let previewError = $state('');
	let editorError = $state('');
	let rendering = $state(false);
	let attached = $state(false);
	let pendingAttachment = $state.raw<MemeRenderResult | null>(null);
	let editorElement: HTMLElement | undefined = $state();
	let templateController: AbortController | null = null;
	let suggestionController: AbortController | null = null;
	let candidatePreviewController: AbortController | null = null;
	let previewController: AbortController | null = null;
	let renderController: AbortController | null = null;
	const thumbnailControllers: Record<string, AbortController> = {};
	let thumbnailQueue: string[] = [];
	let thumbnailActive = 0;
	let previewTimer: ReturnType<typeof setTimeout> | undefined;
	let previewSequence = 0;
	let recipeRevision = $state(0);
	let previewedRevision = $state(-1);

	const selectedTemplate = $derived(
		selectedTemplateSnapshot ??
			templateCatalog.find((template) => template.id === selectedTemplateID) ??
			selectedCandidate?.template ??
			null
	);
	const hasCaption = $derived(captions.some((caption) => caption.trim().length > 0));
	const captionsValid = $derived(captions.every(isCaptionValid));
	const previewCurrent = $derived(previewedRevision === recipeRevision && !previewLoading);
	const hasMoreTemplates = $derived(
		searchedFor
			? templates.length >= templateLimit && templateLimit < MAX_TEMPLATE_LIMIT
			: templates.length < templateTotal && templateLimit < MAX_TEMPLATE_LIMIT
	);
	const canRender = $derived(
		Boolean(
			pendingAttachment
				? !rendering
				: selectedTemplate &&
						hasCaption &&
						captionsValid &&
						rendererConfigured &&
						previewCurrent &&
						!previewError &&
						!rendering
		)
	);
	const toneOptions = $derived([
		{ value: 'balanced', label: m.meme_generator_tone_balanced() },
		{ value: 'dry', label: m.meme_generator_tone_dry() },
		{ value: 'sarcastic', label: m.meme_generator_tone_sarcastic() },
		{ value: 'playful', label: m.meme_generator_tone_playful() }
	]);

	onMount(() => {
		idea = initialIdea;
		tone = initialTone;
		void loadTemplates('');
	});

	onDestroy(() => {
		templateController?.abort();
		suggestionController?.abort();
		candidatePreviewController?.abort();
		previewController?.abort();
		renderController?.abort();
		cancelThumbnailLoads();
		if (previewTimer) clearTimeout(previewTimer);
	});

	function isAbortError(cause: unknown): boolean {
		return cause instanceof DOMException && cause.name === 'AbortError';
	}

	function mergeTemplates(current: MemeTemplate[], incoming: MemeTemplate[]): MemeTemplate[] {
		const byID = Object.fromEntries(current.map((template) => [template.id, template]));
		for (const template of incoming) byID[template.id] = template;
		return Object.values(byID);
	}

	function captureEditorElement(element: HTMLElement): () => void {
		editorElement = element;
		return () => {
			if (editorElement === element) editorElement = undefined;
		};
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
			cancelThumbnailLoads();
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

	function templateForCandidate(candidate: MemeSuggestionCandidate): MemeTemplate | null {
		return (
			candidate.template ??
			templateCatalog.find((template) => template.id === candidate.template_id) ??
			null
		);
	}

	function memegenCaptionBytes(caption: string): number {
		let value = caption;
		try {
			value = decodeURIComponent(caption);
		} catch {
			// Memegen keeps malformed percent escapes as literal text.
		}
		for (const [current, replacement] of [
			['_', '__'],
			['-', '--'],
			[' ', '_'],
			['?', '~q'],
			['%', '~p'],
			['#', '~h'],
			['"', "''"],
			['/', '~s'],
			['\\', '~b'],
			['\n', '~n'],
			['&', '~a'],
			['<', '~l'],
			['>', '~g'],
			['‘', "'"],
			['’', "'"],
			['“', '"'],
			['”', '"'],
			['–', '-']
		] as const) {
			value = value.replaceAll(current, replacement);
		}
		return new TextEncoder().encode(value).length;
	}

	function hasInvalidCaptionControl(caption: string): boolean {
		return Array.from(caption).some((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return (
				codePoint === 0 ||
				(codePoint < 32 && character !== '\n' && character !== '\r' && character !== '\t') ||
				(codePoint >= 127 && codePoint <= 159)
			);
		});
	}

	function isCaptionValid(caption: string): boolean {
		return (
			Array.from(caption).length <= MAX_CAPTION_CHARACTERS &&
			!hasInvalidCaptionControl(caption) &&
			memegenCaptionBytes(caption) <= MAX_CAPTION_CHARACTERS
		);
	}

	function cancelThumbnailLoads(): void {
		for (const controller of Object.values(thumbnailControllers)) controller.abort();
		for (const templateID of Object.keys(thumbnailControllers)) {
			delete thumbnailControllers[templateID];
		}
		thumbnailQueue = [];
		thumbnailActive = 0;
	}

	function observeTemplateThumbnail(element: HTMLElement, templateID: string): () => void {
		if (templateThumbnails[templateID] || templateThumbnailFailures[templateID]) return () => {};
		if (typeof IntersectionObserver === 'undefined') {
			queueTemplateThumbnail(templateID);
			return () => {};
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				observer.disconnect();
				queueTemplateThumbnail(templateID);
			},
			{ rootMargin: '160px' }
		);
		observer.observe(element);
		return () => observer.disconnect();
	}

	function queueTemplateThumbnail(templateID: string): void {
		if (
			templateThumbnails[templateID] ||
			templateThumbnailFailures[templateID] ||
			thumbnailControllers[templateID] ||
			thumbnailQueue.includes(templateID)
		) {
			return;
		}
		thumbnailQueue = [...thumbnailQueue, templateID];
		drainThumbnailQueue();
	}

	function drainThumbnailQueue(): void {
		while (thumbnailActive < MAX_CONCURRENT_THUMBNAILS && thumbnailQueue.length > 0) {
			const [templateID, ...rest] = thumbnailQueue;
			thumbnailQueue = rest;
			void loadTemplateThumbnail(templateID);
		}
	}

	async function loadTemplateThumbnail(templateID: string): Promise<void> {
		const controller = new AbortController();
		thumbnailControllers[templateID] = controller;
		thumbnailActive += 1;
		try {
			const result = await api.thumbnail({
				workspaceId,
				templateId: templateID,
				signal: controller.signal
			});
			if (!controller.signal.aborted) {
				const nextThumbnails = {
					...templateThumbnails,
					[templateID]: memePreviewDataURL(result)
				};
				thumbnailOrder = [...thumbnailOrder.filter((item) => item !== templateID), templateID];
				while (thumbnailOrder.length > MAX_CACHED_THUMBNAILS) {
					const evicted = thumbnailOrder.shift();
					if (!evicted) break;
					if (evicted === selectedTemplateID) {
						thumbnailOrder.push(evicted);
						continue;
					}
					delete nextThumbnails[evicted];
				}
				templateThumbnails = nextThumbnails;
			}
		} catch (cause) {
			if (!isAbortError(cause)) {
				templateThumbnailFailures = { ...templateThumbnailFailures, [templateID]: true };
			}
		} finally {
			if (thumbnailControllers[templateID] === controller) {
				delete thumbnailControllers[templateID];
				thumbnailActive = Math.max(0, thumbnailActive - 1);
			}
			drainThumbnailQueue();
		}
	}

	async function generateSuggestions(): Promise<void> {
		const normalizedIdea = idea.trim();
		if (!normalizedIdea) {
			suggestionsError = m.meme_generator_required_idea();
			return;
		}
		suggestionController?.abort();
		candidatePreviewController?.abort();
		const controller = new AbortController();
		suggestionController = controller;
		suggestionsLoading = true;
		hasRequestedSuggestions = true;
		suggestionsError = '';
		candidatePreviews = {};
		candidatePreviewFailures = {};
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
		candidatePreviewController?.abort();
		const controller = new AbortController();
		candidatePreviewController = controller;
		let candidateIndex = 0;
		async function worker(): Promise<void> {
			while (!controller.signal.aborted && candidateIndex < candidates.length) {
				const candidate = candidates[candidateIndex++];
				const key = candidateKey(candidate);
				try {
					const result = await api.preview({
						workspaceId,
						templateId: candidate.template_id,
						captions: candidate.caption_lines,
						overlayMediaIds: [],
						format: 'webp',
						signal: controller.signal
					});
					if (!controller.signal.aborted) {
						candidatePreviews = {
							...candidatePreviews,
							[key]: memePreviewDataURL(result)
						};
					}
				} catch (cause) {
					if (!controller.signal.aborted && !isAbortError(cause)) {
						candidatePreviewFailures = { ...candidatePreviewFailures, [key]: true };
					}
				}
			}
		}
		await Promise.all(
			Array.from({ length: Math.min(MAX_CONCURRENT_CANDIDATE_PREVIEWS, candidates.length) }, () =>
				worker()
			)
		);
	}

	function normalizedCaptions(template: MemeTemplate, values: string[]): string[] {
		const lineCount = Math.max(1, template.lines);
		return Array.from({ length: lineCount }, (_, index) => values[index] ?? '');
	}

	function selectTemplate(template: MemeTemplate, event?: MouseEvent): void {
		selectRecipe(
			template,
			normalizedCaptions(template, template.example?.text ?? []),
			null,
			event?.detail === 0
		);
	}

	function selectCandidate(candidate: MemeSuggestionCandidate, event?: MouseEvent): void {
		const template = templateForCandidate(candidate);
		if (!template) {
			suggestionsError = m.meme_generator_templates_failed();
			return;
		}
		candidatePreviewController?.abort();
		candidatePreviewController = null;
		selectRecipe(
			template,
			normalizedCaptions(template, candidate.caption_lines),
			candidate,
			event?.detail === 0
		);
	}

	function selectRecipe(
		template: MemeTemplate,
		nextCaptions: string[],
		candidate: MemeSuggestionCandidate | null,
		moveFocus = false
	): void {
		selectedTemplateID = template.id;
		selectedTemplateSnapshot = template;
		selectedCandidate = candidate;
		captions = nextCaptions;
		overlaySelections = Array.from({ length: template.overlays }, () => null);
		pendingAttachment = null;
		recipeRevision += 1;
		if (previewTimer) {
			clearTimeout(previewTimer);
			previewTimer = undefined;
		}
		previewController?.abort();
		previewSequence += 1;
		const candidatePreview = candidate ? candidatePreviews[candidateKey(candidate)] : '';
		selectedPreview = candidatePreview || templateThumbnails[template.id] || '';
		previewedRevision = candidatePreview ? recipeRevision : -1;
		previewLoading = false;
		queueTemplateThumbnail(template.id);
		previewError = '';
		editorError = '';
		attached = false;
		if (!candidatePreview) schedulePreview(0);
		requestAnimationFrame(() => {
			editorElement?.scrollIntoView({ block: 'nearest' });
			if (moveFocus) editorElement?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
		});
	}

	function handleCaptionInput(index: number, event: Event): void {
		const target = event.currentTarget;
		if (!(target instanceof HTMLTextAreaElement)) return;
		captions = captions.map((caption, candidateIndex) =>
			candidateIndex === index ? target.value : caption
		);
		selectedCandidate = null;
		pendingAttachment = null;
		recipeRevision += 1;
		attached = false;
		previewError = '';
		schedulePreview();
	}

	function overlayMediaIDs(): string[] {
		const mediaIDs: string[] = [];
		for (const selection of overlaySelections) {
			if (!selection) break;
			mediaIDs.push(selection.media_id);
		}
		return mediaIDs;
	}

	function schedulePreview(delay = PREVIEW_DEBOUNCE_MS): void {
		if (previewTimer) clearTimeout(previewTimer);
		previewController?.abort();
		previewSequence += 1;
		previewLoading = captionsValid;
		previewTimer = setTimeout(() => void refreshPreview(), delay);
	}

	async function refreshPreview(): Promise<void> {
		previewTimer = undefined;
		const template = selectedTemplate;
		if (!template || !rendererConfigured) return;
		if (!captionsValid) {
			previewController?.abort();
			previewLoading = false;
			previewError = '';
			return;
		}
		previewController?.abort();
		const controller = new AbortController();
		previewController = controller;
		const sequence = ++previewSequence;
		const revision = recipeRevision;
		previewLoading = true;
		previewError = '';
		try {
			const result = await api.preview({
				workspaceId,
				templateId: template.id,
				captions: [...captions],
				overlayMediaIds: overlayMediaIDs(),
				format: 'webp',
				signal: controller.signal
			});
			if (
				controller.signal.aborted ||
				sequence !== previewSequence ||
				revision !== recipeRevision
			) {
				return;
			}
			selectedPreview = memePreviewDataURL(result);
			previewedRevision = revision;
		} catch (cause) {
			if (isAbortError(cause)) return;
			if (sequence === previewSequence) {
				previewError = cause instanceof Error ? cause.message : m.meme_generator_preview_failed();
			}
		} finally {
			if (sequence === previewSequence) previewLoading = false;
		}
	}

	async function pickOverlay(index: number): Promise<void> {
		if (!onPickOverlay) return;
		editorError = '';
		if (overlaySelections.slice(0, index).some((selection) => !selection)) {
			editorError = m.meme_generator_overlay_order();
			return;
		}
		try {
			const selection = await onPickOverlay(index, overlaySelections[index] ?? null);
			if (!selection) return;
			overlaySelections = overlaySelections.map((current, candidateIndex) =>
				candidateIndex === index ? selection : current
			);
			pendingAttachment = null;
			recipeRevision += 1;
			attached = false;
			previewError = '';
			schedulePreview(0);
		} catch (cause) {
			editorError = cause instanceof Error ? cause.message : m.meme_generator_preview_failed();
		}
	}

	function removeOverlay(index: number): void {
		overlaySelections = overlaySelections.map((selection, candidateIndex) =>
			candidateIndex >= index ? null : selection
		);
		pendingAttachment = null;
		recipeRevision += 1;
		attached = false;
		previewError = '';
		schedulePreview(0);
	}

	async function renderAndAttach(): Promise<void> {
		const template = selectedTemplate;
		if (!template) return;
		if (!pendingAttachment && !hasCaption) {
			editorError = m.meme_generator_required_caption();
			return;
		}
		if (!pendingAttachment && !captionsValid) {
			editorError = m.meme_generator_caption_too_long();
			return;
		}
		renderController?.abort();
		const controller = new AbortController();
		renderController = controller;
		rendering = true;
		editorError = '';
		attached = false;
		try {
			let result = pendingAttachment;
			if (!result) {
				try {
					result = await api.render({
						workspaceId,
						templateId: template.id,
						captions: [...captions],
						overlayMediaIds: overlayMediaIDs(),
						format: template.animated ? 'gif' : 'png',
						altText: selectedCandidate?.alt_text,
						parentMediaId: parentMediaId || undefined,
						signal: controller.signal
					});
				} catch (cause) {
					if (isAbortError(cause)) return;
					editorError = cause instanceof Error ? cause.message : m.meme_generator_render_failed();
					return;
				}
			}
			if (controller.signal.aborted) return;
			pendingAttachment = result;
			try {
				await onAttach(result);
			} catch (cause) {
				if (isAbortError(cause)) return;
				editorError = m.meme_generator_attach_failed();
				return;
			}
			pendingAttachment = null;
			attached = true;
		} finally {
			if (renderController === controller) rendering = false;
		}
	}
</script>

<div class="meme-generator min-w-0" style="container-type: inline-size;">
	<header class="mb-4 space-y-1">
		<h2 class="text-base font-semibold tracking-[-0.02em] text-foreground">
			{m.meme_generator_title()}
		</h2>
		<p class="max-w-2xl text-sm leading-5 text-muted-foreground">
			{m.meme_generator_description()}
		</p>
	</header>

	{#if !rendererConfigured && !templatesLoading}
		<InlineNotice tone="warning" message={m.meme_generator_renderer_unavailable()} class="mb-4" />
	{/if}

	<div class="meme-workspace">
		<section class="min-w-0" aria-label={m.meme_generator_templates_heading()}>
			<Tabs.Root bind:value={mode}>
				<Tabs.List class="grid w-full grid-cols-2">
					<Tabs.Trigger value="ideas">
						<SparklesIcon />
						{m.meme_generator_ideas_tab()}
					</Tabs.Trigger>
					<Tabs.Trigger value="templates">
						<ImageIcon />
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
										<LoaderIcon class="animate-spin motion-reduce:animate-none" />
										{m.meme_generator_generating()}
									{:else}
										<WandIcon />
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
										<RefreshIcon />
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
								<h3 class="text-sm font-semibold">{m.meme_generator_suggestions_heading()}</h3>
								<p class="mt-0.5 text-xs leading-5 text-muted-foreground">
									{m.meme_generator_suggestions_description()}
								</p>
							</div>
							<div class="candidate-grid">
								{#each suggestions as candidate (candidateKey(candidate))}
									{@const template = templateForCandidate(candidate)}
									{#if template}
										<Button
											variant="ghost"
											class="candidate-choice relative h-auto min-w-0 items-stretch justify-start overflow-hidden rounded-lg border p-2 text-left whitespace-normal md:h-auto {selectedTemplateID ===
												template.id && selectedCandidate === candidate
												? 'border-primary bg-primary/6 ring-2 ring-primary/20'
												: 'border-border bg-card hover:border-primary/45 hover:bg-muted/35'}"
											onclick={(event) => selectCandidate(candidate, event)}
											aria-pressed={selectedTemplateID === template.id &&
												selectedCandidate === candidate}
											aria-label={m.meme_generator_candidate_select({ name: template.name })}
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
													{:else if candidatePreviewFailures[candidateKey(candidate)]}
														<span
															class="grid size-full place-items-center gap-1 text-xs text-muted-foreground"
														>
															<ImageIcon class="size-5" />
															{m.media_preview_unavailable()}
														</span>
													{:else}
														<Skeleton class="size-full" />
													{/if}
													{#if selectedTemplateID === template.id && selectedCandidate === candidate}
														<span
															class="absolute top-2 right-2 grid size-7 place-items-center rounded-full bg-primary text-primary-foreground"
														>
															<CheckIcon class="size-4" />
															<span class="sr-only">{m.meme_generator_selected()}</span>
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
									{/if}
								{/each}
							</div>
							<Button variant="ghost" size="sm" onclick={() => void generateSuggestions()}>
								<RefreshIcon />
								{m.meme_generator_try_another_set()}
							</Button>
						</div>
					{:else if hasRequestedSuggestions && idea.trim() && !suggestionsError}
						<EmptyState
							icon={SparklesIcon}
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
								<SearchIcon
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
								<LoaderIcon class="animate-spin motion-reduce:animate-none" />
							{:else}
								<SearchIcon />
							{/if}
							{m.media_picker_search_action()}
						</Button>
					</form>

					{#if templatesError}
						<InlineNotice tone="error" message={templatesError}>
							{#snippet actions()}
								<Button variant="ghost" size="sm" onclick={() => void loadTemplates()}>
									<RefreshIcon />
									{m.common_retry()}
								</Button>
							{/snippet}
						</InlineNotice>
					{/if}

					<div class="flex items-center justify-between gap-3">
						<h3 class="text-sm font-semibold">{m.meme_generator_templates_heading()}</h3>
						{#if templates.length > 0}
							<span class="text-xs text-muted-foreground">
								{m.meme_generator_showing_templates({ count: templates.length })}
							</span>
						{/if}
					</div>

					{#if templatesLoading}
						<div class="template-grid" aria-label={m.common_loading()}>
							{#each ['one', 'two', 'three', 'four', 'five', 'six'] as key (key)}
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
									class="template-choice relative h-auto min-w-0 items-stretch justify-start overflow-hidden rounded-lg border p-2 text-left whitespace-normal md:h-auto {selectedTemplateID ===
										template.id && !selectedCandidate
										? 'border-primary bg-primary/6 ring-2 ring-primary/20'
										: 'border-border bg-card hover:border-primary/45 hover:bg-muted/35'}"
									onclick={(event) => selectTemplate(template, event)}
									aria-pressed={selectedTemplateID === template.id && !selectedCandidate}
									aria-label={m.meme_generator_template_select({ name: template.name })}
								>
									<span class="block w-full">
										<span
											{@attach (element) => observeTemplateThumbnail(element, template.id)}
											class="relative block aspect-[4/3] overflow-hidden rounded-md bg-muted"
										>
											{#if templateThumbnails[template.id]}
												<img
													src={templateThumbnails[template.id]}
													alt=""
													aria-hidden="true"
													class="size-full object-contain"
													loading="lazy"
													decoding="async"
												/>
											{:else if templateThumbnailFailures[template.id]}
												<span class="grid size-full place-items-center text-muted-foreground">
													<ImageIcon class="size-6" />
													<span class="sr-only">{m.media_preview_unavailable()}</span>
												</span>
											{:else}
												<Skeleton class="size-full" />
											{/if}
											{#if selectedTemplateID === template.id && !selectedCandidate}
												<span
													class="absolute top-2 right-2 grid size-7 place-items-center rounded-full bg-primary text-primary-foreground"
												>
													<CheckIcon class="size-4" />
													<span class="sr-only">{m.meme_generator_selected()}</span>
												</span>
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
									<LoaderIcon class="animate-spin motion-reduce:animate-none" />
								{/if}
								{m.meme_generator_show_more()}
							</Button>
						{/if}
					{:else if !templatesError}
						<EmptyState
							icon={SearchXIcon}
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

		<section
			{@attach captureEditorElement}
			class="meme-editor min-w-0 rounded-xl border border-border bg-card p-3 sm:p-4"
			aria-labelledby={`${uid}-editor-heading`}
		>
			<div class="mb-3 flex items-start justify-between gap-3">
				<div class="min-w-0">
					<h3 id={`${uid}-editor-heading`} class="text-sm font-semibold">
						{m.meme_generator_editor_heading()}
					</h3>
					<p class="mt-0.5 text-xs leading-5 text-muted-foreground">
						{m.meme_generator_editor_description()}
					</p>
				</div>
				{#if selectedTemplate}
					<div class="flex min-w-0 flex-col items-end gap-1">
						<Badge class="max-w-40 truncate">{selectedTemplate.name}</Badge>
						{#if selectedTemplate.source_url}
							<Button
								href={selectedTemplate.source_url}
								variant="link"
								size="xs"
								target="_blank"
								rel="noreferrer"
								class="px-0 text-xs text-muted-foreground hover:text-foreground"
							>
								{m.meme_generator_template_source()}
								<ExternalLinkIcon class="size-3" />
							</Button>
						{/if}
					</div>
				{/if}
			</div>

			{#if !selectedTemplate}
				<EmptyState
					icon={ImagePlusIcon}
					title={m.meme_generator_select_first_title()}
					description={m.meme_generator_select_first_body()}
					headingLevel={4}
					variant="muted"
				/>
			{:else}
				<div class="space-y-4">
					<figure
						class="relative grid min-h-56 place-items-center overflow-hidden rounded-lg bg-muted/70 p-2 sm:min-h-72"
					>
						{#if selectedPreview}
							<img
								src={selectedPreview}
								alt={m.meme_generator_preview_alt({ name: selectedTemplate.name })}
								class="max-h-[28rem] max-w-full object-contain"
								loading="eager"
								decoding="async"
							/>
						{:else}
							<div class="flex flex-col items-center gap-2 text-sm text-muted-foreground">
								<ImageIcon class="size-6" />
								{m.media_preview_unavailable()}
							</div>
						{/if}
						{#if previewLoading}
							<div
								class="absolute inset-0 grid place-items-center bg-background/72 backdrop-blur-[1px]"
							>
								<div
									class="flex items-center gap-2 rounded-md bg-background px-3 py-2 text-xs font-medium shadow-sm"
								>
									<LoaderIcon class="size-4 animate-spin motion-reduce:animate-none" />
									{m.meme_generator_preview_loading()}
								</div>
							</div>
						{/if}
					</figure>

					{#if previewError}
						<InlineNotice tone="error" message={previewError}>
							{#snippet actions()}
								<Button variant="ghost" size="sm" onclick={() => void refreshPreview()}>
									<RefreshIcon />
									{m.common_retry()}
								</Button>
							{/snippet}
						</InlineNotice>
					{/if}

					<fieldset class="min-w-0 space-y-3" disabled={rendering}>
						<legend class="sr-only">{m.meme_generator_editor_heading()}</legend>
						{#each captions as caption, index (`caption-${index + 1}`)}
							{@const captionLength = memegenCaptionBytes(caption)}
							{@const captionIsValid = isCaptionValid(caption)}
							<div class="space-y-1.5">
								<div class="flex items-center justify-between gap-3">
									<Label for={`${uid}-caption-${index}`}>
										{m.meme_generator_caption_label({ number: index + 1 })}
									</Label>
									<span
										class="font-mono text-[0.6875rem] {captionIsValid
											? 'text-muted-foreground'
											: 'font-semibold text-destructive'}"
									>
										{m.meme_generator_caption_count({
											current: captionLength,
											maximum: MAX_CAPTION_CHARACTERS
										})}
									</span>
								</div>
								<Textarea
									id={`${uid}-caption-${index}`}
									value={caption}
									maxlength={MAX_CAPTION_CHARACTERS}
									rows={2}
									aria-invalid={!captionIsValid}
									aria-describedby={!captionIsValid ? `${uid}-caption-${index}-error` : undefined}
									oninput={(event) => handleCaptionInput(index, event)}
								/>
								{#if !captionIsValid}
									<p id={`${uid}-caption-${index}-error`} class="text-xs text-destructive">
										{m.meme_generator_caption_too_long()}
									</p>
								{/if}
							</div>
						{/each}
					</fieldset>

					{#if selectedTemplate.overlays > 0}
						<div class="space-y-2">
							<h4 class="text-sm font-semibold">{m.meme_generator_image_slots_heading()}</h4>
							{#if !onPickOverlay}
								<InlineNotice tone="info" message={m.meme_generator_overlay_picker_unavailable()} />
							{/if}
							<div class="overlay-grid">
								{#each overlaySelections as selection, index (`overlay-${index + 1}`)}
									<div
										class="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-muted/25 p-2"
									>
										<div
											class="grid size-14 shrink-0 place-items-center overflow-hidden rounded-md bg-muted"
										>
											{#if selection}
												<img
													src={selection.preview_url}
													alt={selection.name}
													class="size-full object-cover"
												/>
											{:else}
												<ImageIcon class="size-5 text-muted-foreground" />
											{/if}
										</div>
										<div class="min-w-0 flex-1">
											<p class="truncate text-xs font-medium">
												{m.meme_generator_image_slot_label({ number: index + 1 })}
											</p>
											<p class="truncate text-xs text-muted-foreground">
												{selection?.name ?? m.meme_generator_image_slot_empty()}
											</p>
											<div class="mt-1 flex flex-wrap gap-1">
												<Button
													variant="ghost"
													size="xs"
													disabled={!onPickOverlay ||
														rendering ||
														overlaySelections.slice(0, index).some((item) => !item)}
													onclick={() => void pickOverlay(index)}
												>
													{selection
														? m.meme_generator_replace_image({ number: index + 1 })
														: m.meme_generator_choose_image({ number: index + 1 })}
												</Button>
												{#if selection}
													<Button variant="ghost" size="xs" onclick={() => removeOverlay(index)}>
														{m.meme_generator_remove_image({ number: index + 1 })}
													</Button>
												{/if}
											</div>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					{#if editorError}
						<InlineNotice tone="error" message={editorError} />
					{/if}
					{#if attached}
						<InlineNotice tone="success" message={m.meme_generator_attached()} />
					{/if}

					<div
						class="flex flex-col-reverse gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between"
					>
						<p class="text-xs leading-5 text-muted-foreground">
							{m.meme_generator_editor_description()}
						</p>
						<Button
							class="w-full sm:w-auto"
							disabled={!canRender}
							onclick={() => void renderAndAttach()}
						>
							{#if rendering}
								<LoaderIcon class="animate-spin motion-reduce:animate-none" />
								{m.meme_generator_rendering()}
							{:else}
								<ImagePlusIcon />
								{pendingAttachment
									? m.meme_generator_attach_retry()
									: m.meme_generator_render_attach()}
							{/if}
						</Button>
					</div>
				</div>
			{/if}
		</section>
	</div>

	<div class="sr-only" aria-live="polite">
		{#if suggestionsLoading}{m.meme_generator_generating()}{/if}
		{#if previewLoading}{m.meme_generator_preview_loading()}{/if}
		{#if rendering}{m.meme_generator_rendering()}{/if}
		{#if attached}{m.meme_generator_attached()}{/if}
	</div>
</div>

<style>
	.meme-workspace {
		display: grid;
		gap: 1rem;
	}

	.candidate-grid,
	.template-grid,
	.overlay-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.625rem;
	}

	.idea-actions {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.75rem;
	}

	@container (min-width: 34rem) {
		.candidate-grid,
		.template-grid,
		.overlay-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.idea-actions {
			grid-template-columns: minmax(0, 0.72fr) minmax(11rem, 1fr);
		}
	}

	@container (min-width: 54rem) {
		.meme-workspace {
			grid-template-columns: minmax(0, 0.9fr) minmax(22rem, 1.1fr);
			align-items: start;
		}

		.meme-editor {
			position: sticky;
			top: 1rem;
		}
	}
</style>
