<script lang="ts">
	import { onMount } from 'svelte';
	import { captureTelemetryEvent } from '@openpost/telemetry';
	import { goto } from '$app/navigation';
	import { resolveAppPath } from '$lib/app-path';
	import { page } from '$app/stores';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import {
		createImageEditorDesign,
		instantiateImageEditorTemplate,
		type CreateImageEditorDesignInput
	} from '$lib/image-editor/api';
	import { queryImageEditorConfig, queryImageEditorTemplates } from '$lib/query/image-editor';
	import {
		captureQueryMutationSession,
		queryMutationSessionIsCurrent,
		type QueryMutationSession
	} from '$lib/query/authorization-boundary';
	import { queryClient } from '$lib/query/client';
	import { imageEditorQueryKeys, type ImageEditorConfig } from '@openpost/query-catalog';
	import type { ImageEditorPreset, ImageEditorTemplate } from '$lib/image-editor/types';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import PaletteIcon from '@lucide/svelte/icons/palette';
	import { m } from '$lib/paraglide/messages';
	import { startImageEditorMetric } from '$lib/image-editor/telemetry';
	import TemplatePreview from '$lib/image-editor/components/template-preview.svelte';
	import { editorHandoffReturnURL } from '$lib/editor-handoff';

	interface ImageEditorSize {
		width: number;
		height: number;
	}

	interface CreationView {
		readonly session: QueryMutationSession;
		readonly sequence: number;
		readonly workspaceID: string;
	}

	let loading = $state(true);
	let refreshing = $state(false);
	let configReady = $state(false);
	let templatesReady = $state(false);
	let templatesWorkspaceID = $state('');
	let loadError = $state('');
	let backgroundError = $state('');
	let creating = $state('');
	let error = $state('');
	let enabled = $state(true);
	let presets = $state<ImageEditorPreset[]>([]);
	let templates = $state<ImageEditorTemplate[]>([]);
	let showAllTemplates = $state(false);
	let customWidth = $state(1080);
	let customHeight = $state(1080);
	let creationSequence = 0;
	let workspaceID = $derived(
		$page.url.searchParams.get('workspace') || workspaceCtx.currentWorkspace?.id || ''
	);
	let returnToken = $derived($page.url.searchParams.get('return_token') || '');
	let sourceMediaID = $derived($page.url.searchParams.get('source_media') || '');
	let sourceName = $derived($page.url.searchParams.get('source_name') || '');
	let sourceWidth = $derived(Number($page.url.searchParams.get('width') || 0));
	let sourceHeight = $derived(Number($page.url.searchParams.get('height') || 0));
	let initialAction = $derived($page.url.searchParams.get('action') || '');
	const featuredTemplateIDs = new Set([
		'builtin-quick-announcement',
		'builtin-photo-caption',
		'builtin-quote-card',
		'builtin-how-to-carousel',
		'builtin-story-prompt',
		'builtin-linkedin-insight'
	]);
	let featuredTemplates = $derived(
		templates.filter((template) => featuredTemplateIDs.has(template.id))
	);
	let visibleTemplates = $derived(showAllTemplates ? templates : featuredTemplates);
	let usableContent = $derived(
		configReady &&
			(!enabled || (Boolean(workspaceID) && templatesReady && templatesWorkspaceID === workspaceID))
	);

	function captureCreationView(): CreationView {
		return {
			session: captureQueryMutationSession(),
			sequence: ++creationSequence,
			workspaceID
		};
	}

	function creationViewIsCurrent(view: CreationView): boolean {
		return (
			view.sequence === creationSequence &&
			view.workspaceID === workspaceID &&
			queryMutationSessionIsCurrent(view.session)
		);
	}

	onMount(() => {
		void initialize();
	});

	async function initialize(): Promise<void> {
		hydrateCachedState(workspaceID);
		loading = !usableContent;
		refreshing = usableContent;
		loadError = '';
		backgroundError = '';
		error = '';
		const finishMetric = startImageEditorMetric('document_load');
		let loadFailed = false;
		try {
			const configPromise = queryImageEditorConfig();
			await workspaceCtx.initialize($page.url.searchParams.get('workspace') || undefined);
			const requestedWorkspaceID = workspaceID;
			if (!requestedWorkspaceID) throw new Error(m.image_editor_open_failed());
			hydrateCachedState(requestedWorkspaceID);
			loading = !usableContent;
			refreshing = usableContent;
			const templatesPromise = queryImageEditorTemplates(requestedWorkspaceID);
			const [configResult, templatesResult] = await Promise.allSettled([
				configPromise,
				templatesPromise
			]);
			let failure: unknown;
			if (configResult.status === 'fulfilled') {
				applyConfig(configResult.value);
			} else {
				failure = configResult.reason;
			}
			if (templatesResult.status === 'fulfilled') {
				templates = templatesResult.value;
				templatesReady = true;
				templatesWorkspaceID = requestedWorkspaceID;
			} else if (configResult.status !== 'fulfilled' || configResult.value.enabled) {
				failure ??= templatesResult.reason;
			}
			if (failure) {
				loadFailed = true;
				const message = failure instanceof Error ? failure.message : m.image_editor_open_failed();
				if (usableContent) backgroundError = message;
				else loadError = message;
				return;
			}
			loading = false;
			refreshing = true;
			if (sourceMediaID && workspaceID && enabled) {
				await createFromSource();
				return;
			}
			const requestedTemplate = $page.url.searchParams.get('template');
			const template = templates.find((candidate) => candidate.id === requestedTemplate);
			if (template) {
				await createTemplate(template);
				return;
			}
			const requestedPreset = $page.url.searchParams.get('preset');
			if (requestedPreset && presets.some((preset) => preset.key === requestedPreset)) {
				await createPreset(requestedPreset);
			}
		} catch (cause) {
			loadFailed = true;
			const message = cause instanceof Error ? cause.message : m.image_editor_open_failed();
			if (usableContent) backgroundError = message;
			else loadError = message;
		} finally {
			finishMetric(loadFailed ? 'error' : 'success');
			loading = false;
			refreshing = false;
		}
	}

	function hydrateCachedState(requestedWorkspaceID: string): void {
		const config = queryClient.getQueryData<ImageEditorConfig>(imageEditorQueryKeys.config());
		if (config) applyConfig(config);
		if (!requestedWorkspaceID || !config?.enabled) return;
		const cachedTemplates = queryClient.getQueryData<ImageEditorTemplate[]>(
			imageEditorQueryKeys.templates(requestedWorkspaceID)
		);
		if (cachedTemplates) {
			templates = cachedTemplates;
			templatesReady = true;
			templatesWorkspaceID = requestedWorkspaceID;
		}
	}

	function applyConfig(config: ImageEditorConfig): void {
		enabled = config.enabled;
		presets = config.presets;
		if (!config.enabled) templates = [];
		configReady = true;
	}

	async function createPreset(key: string): Promise<void> {
		if (!workspaceID || creating) return;
		const view = captureCreationView();
		creating = key;
		error = '';
		try {
			const input: CreateImageEditorDesignInput = {
				title: m.image_editor_untitled_design(),
				preset_key: key
			};
			if (key === 'custom') {
				input.width_px = customWidth;
				input.height_px = customHeight;
			}
			const design = await createImageEditorDesign(view.workspaceID, input);
			if (!creationViewIsCurrent(view)) return;
			captureTelemetryEvent('image design created', {
				source: key === 'custom' ? 'custom' : 'preset'
			});
			await openDesign(design.id);
		} catch (cause) {
			if (!creationViewIsCurrent(view)) return;
			error = cause instanceof Error ? cause.message : m.image_editor_create_failed();
		} finally {
			if (view.sequence === creationSequence) creating = '';
		}
	}

	async function createTemplate(template: ImageEditorTemplate): Promise<void> {
		if (!workspaceID || creating) return;
		const view = captureCreationView();
		creating = template.id;
		error = '';
		try {
			const design = await instantiateImageEditorTemplate(template.id, view.workspaceID);
			if (!creationViewIsCurrent(view)) return;
			captureTelemetryEvent('image design created', { source: 'template' });
			await openDesign(design.id);
		} catch (cause) {
			if (!creationViewIsCurrent(view)) return;
			error = cause instanceof Error ? cause.message : m.image_editor_template_use_failed();
		} finally {
			if (view.sequence === creationSequence) creating = '';
		}
	}

	async function createFromSource(): Promise<void> {
		if (!workspaceID || creating) return;
		const view = captureCreationView();
		creating = 'source-media';
		const sourceSize = fitSourceSize(sourceWidth, sourceHeight);
		try {
			const design = await createImageEditorDesign(view.workspaceID, {
				title: sourceName
					? m.image_editor_image_edit_title({ name: sourceName.replace(/\.[^.]+$/, '') })
					: m.image_editor_media_edit_title(),
				preset_key: 'custom',
				width_px: sourceSize.width,
				height_px: sourceSize.height,
				source_media_id: sourceMediaID
			});
			if (!creationViewIsCurrent(view)) return;
			captureTelemetryEvent('image design created', { source: 'media' });
			await openDesign(design.id);
		} catch (cause) {
			if (!creationViewIsCurrent(view)) return;
			error = cause instanceof Error ? cause.message : m.image_editor_media_open_failed();
		} finally {
			if (view.sequence === creationSequence) creating = '';
		}
	}

	function fitSourceSize(width: number, height: number): ImageEditorSize {
		if (width < 1 || height < 1) return { width: 1080, height: 1080 };
		const scale = Math.min(
			1,
			4096 / width,
			4096 / height,
			Math.sqrt(25_000_000 / (width * height))
		);
		return {
			width: Math.max(64, Math.round(width * scale)),
			height: Math.max(64, Math.round(height * scale))
		};
	}

	async function openDesign(id: string): Promise<void> {
		const query = new URLSearchParams();
		if (returnToken) query.set('return_token', returnToken);
		if (initialAction) query.set('action', initialAction);
		const suffix = query.size > 0 ? `?${query.toString()}` : '';
		await goto(resolveAppPath(`/image-editor/${id}${suffix}`), { replaceState: true });
	}

	function goBack(): void {
		if (returnToken) {
			const returnURL = editorHandoffReturnURL(returnToken, 'image', 'cancelled');
			if (returnURL) {
				void goto(resolveAppPath(returnURL));
				return;
			}
		}
		if (history.length > 1) history.back();
		else void goto(resolveAppPath('/media'));
	}

	function presetName(preset: ImageEditorPreset): string {
		switch (preset.key) {
			case 'instagram-square':
				return m.image_editor_preset_instagram_square();
			case 'instagram-portrait':
				return m.image_editor_preset_instagram_portrait();
			case 'story-reel-slide':
				return m.image_editor_preset_story_slide();
			case 'linkedin-square':
				return m.image_editor_preset_linkedin_square();
			case 'linkedin-landscape':
				return m.image_editor_preset_linkedin_landscape();
			case 'x-landscape':
				return m.image_editor_preset_x_landscape();
			case 'youtube-thumbnail':
				return m.image_editor_preset_youtube_thumbnail();
			default:
				return preset.name;
		}
	}

	function templateName(template: ImageEditorTemplate): string {
		if (!template.built_in) return template.name;
		switch (template.id) {
			case 'builtin-quick-announcement':
				return m.image_editor_template_quick_announcement();
			case 'builtin-quote-card':
				return m.image_editor_template_quote_card();
			case 'builtin-how-to-carousel':
				return m.image_editor_template_how_to_carousel();
			case 'builtin-bold-announcement':
				return m.image_editor_template_bold_announcement();
			case 'builtin-photo-caption':
				return m.image_editor_template_photo_caption();
			case 'builtin-quiet-quote':
				return m.image_editor_template_quiet_quote();
			case 'builtin-carousel-opener':
				return m.image_editor_template_carousel_opener();
			case 'builtin-carousel-step':
				return m.image_editor_template_numbered_steps();
			case 'builtin-story-prompt':
				return m.image_editor_template_story_prompt();
			case 'builtin-story-photo':
				return m.image_editor_template_story_photo();
			case 'builtin-linkedin-insight':
				return m.image_editor_template_linkedin_insight();
			case 'builtin-linkedin-launch':
				return m.image_editor_template_linkedin_launch();
			case 'builtin-x-update':
				return m.image_editor_template_x_update();
			case 'builtin-youtube-focus':
				return m.image_editor_template_youtube_focus();
			case 'builtin-youtube-list':
				return m.image_editor_template_youtube_list();
			default:
				return template.name;
		}
	}
</script>

<svelte:head><title>{m.image_editor_new_design()} · {m.image_editor_title()}</title></svelte:head>

<div class="image-editor-theme min-h-dvh bg-background">
	<header
		class="sticky top-0 z-10 flex h-14 items-center border-b bg-background/95 px-3 backdrop-blur"
	>
		<Button
			variant="ghost"
			size="icon-sm"
			onclick={goBack}
			aria-label={returnToken ? m.editor_back_to_post() : m.common_back()}><ArrowLeftIcon /></Button
		>
		<h1 class="ml-2 text-sm font-semibold">{m.image_editor_new_design()}</h1>
	</header>

	<main class="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
		{#if loading && !usableContent}
			<div class="min-h-[60dvh]">
				<PageLoading layout="sections" label={m.image_editor_load()} items={4} />
			</div>
		{:else if loadError && !usableContent}
			<div class="mx-auto flex min-h-[60dvh] max-w-xl items-center">
				<InlineNotice tone="error" message={loadError} class="w-full">
					{#snippet actions()}
						<Button variant="outline" size="sm" onclick={initialize}>
							{m.common_retry()}
						</Button>
					{/snippet}
				</InlineNotice>
			</div>
		{:else if !enabled}
			{#if backgroundError}
				<InlineNotice tone="warning" message={backgroundError} class="mx-auto mb-5 max-w-lg">
					{#snippet actions()}
						<Button variant="outline" size="sm" onclick={initialize}>
							{m.common_retry()}
						</Button>
					{/snippet}
				</InlineNotice>
			{/if}
			<div class="mx-auto max-w-lg rounded-2xl border bg-card p-8 text-center">
				<PaletteIcon class="mx-auto mb-4 size-8 text-muted-foreground" />
				<h2 class="text-xl font-semibold">{m.image_editor_not_enabled()}</h2>
				<p class="mt-2 text-sm text-muted-foreground">
					{m.image_editor_not_enabled_body()}
				</p>
				<Button class="mt-5" onclick={() => goto(resolveAppPath('/media'))}
					>{m.image_editor_return_media()}</Button
				>
			</div>
		{:else}
			{#if refreshing}
				<span class="sr-only" role="status">{m.image_editor_load()}</span>
			{/if}
			{#if backgroundError}
				<InlineNotice
					tone="warning"
					message={backgroundError}
					class="mb-5"
					dismissLabel={m.common_close()}
					onDismiss={() => (backgroundError = '')}
				>
					{#snippet actions()}
						<Button variant="outline" size="sm" onclick={initialize}>
							{m.common_retry()}
						</Button>
					{/snippet}
				</InlineNotice>
			{/if}
			{#if error}
				<InlineNotice
					tone="error"
					message={error}
					class="mb-5"
					dismissLabel={m.common_close()}
					onDismiss={() => (error = '')}
				/>
			{/if}

			<section aria-labelledby="templates-heading">
				<div class="mb-3">
					<h2 id="templates-heading" class="text-base font-semibold">
						{m.image_editor_starter_templates()}
					</h2>
					<p class="mt-0.5 text-sm text-muted-foreground">
						{m.image_editor_starter_templates_body()}
					</p>
				</div>
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
					{#each visibleTemplates as template (template.id)}
						<button
							type="button"
							class="rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/2 focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:outline-none"
							onclick={() => createTemplate(template)}
							disabled={Boolean(creating)}
						>
							<div class="mb-3 aspect-[4/3] overflow-hidden rounded-lg border">
								<TemplatePreview
									document={template.document}
									label={templateName(template)}
									compact
								/>
							</div>
							<div class="flex items-center gap-2">
								<span class="min-w-0 flex-1 truncate text-sm font-medium"
									>{templateName(template)}</span
								>
								{#if creating === template.id}<LoaderIcon class="size-4 animate-spin" />{/if}
							</div>
						</button>
					{/each}
				</div>
				{#if templates.length > featuredTemplates.length}
					<Button
						class="mt-4"
						variant="outline"
						onclick={() => (showAllTemplates = !showAllTemplates)}
					>
						{showAllTemplates
							? m.image_editor_show_fewer_templates()
							: m.image_editor_show_all_templates({ count: templates.length })}
					</Button>
				{/if}
			</section>

			<section class="mt-10" aria-labelledby="preset-heading">
				<h2 id="preset-heading" class="mb-3 text-base font-semibold">
					{m.image_editor_social_presets()}
				</h2>
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
					{#each presets as preset (preset.key)}
						<button
							type="button"
							class="rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/2 focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:outline-none"
							onclick={() => createPreset(preset.key)}
							disabled={Boolean(creating)}
						>
							<div
								class="mb-3 flex aspect-[4/3] items-center justify-center rounded-lg bg-neutral-800 p-4"
							>
								<div
									class="max-h-full max-w-full bg-orange-50"
									style:aspect-ratio={`${preset.width_px}/${preset.height_px}`}
									style:height={preset.height_px > preset.width_px ? '100%' : 'auto'}
									style:width={preset.width_px >= preset.height_px ? '100%' : 'auto'}
								></div>
							</div>
							<div class="flex items-center gap-2">
								<span class="min-w-0 flex-1 truncate text-sm font-medium">{presetName(preset)}</span
								>
								{#if creating === preset.key}<LoaderIcon class="size-4 animate-spin" />{/if}
							</div>
							<p class="mt-0.5 text-xs text-muted-foreground">
								{preset.width_px} × {preset.height_px}
							</p>
						</button>
					{/each}
				</div>
			</section>

			<section class="mt-8 rounded-xl border bg-card p-4" aria-labelledby="custom-heading">
				<h2 id="custom-heading" class="text-sm font-semibold">{m.image_editor_custom_size()}</h2>
				<p class="mt-1 text-xs text-muted-foreground">{m.image_editor_custom_limits()}</p>
				<div class="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
					<label class="grid gap-1 text-xs">
						<span>{m.image_editor_width()}</span>
						<Input type="number" min="64" max="4096" bind:value={customWidth} />
					</label>
					<label class="grid gap-1 text-xs">
						<span>{m.image_editor_height()}</span>
						<Input type="number" min="64" max="4096" bind:value={customHeight} />
					</label>
					<Button
						class="self-end"
						onclick={() => createPreset('custom')}
						disabled={Boolean(creating)}
					>
						{m.image_editor_create_custom()}
					</Button>
				</div>
			</section>
		{/if}
	</main>
</div>
