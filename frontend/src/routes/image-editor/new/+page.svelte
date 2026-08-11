<script lang="ts">
	import { onMount } from 'svelte';
	import { captureTelemetryEvent } from '@openpost/telemetry';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/stores';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import {
		createImageEditorDesign,
		instantiateImageEditorTemplate,
		listImageEditorTemplates,
		loadImageEditorConfig
	} from '$lib/image-editor/api';
	import type { ImageEditorPreset, ImageEditorTemplate } from '$lib/image-editor/types';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import PaletteIcon from '@lucide/svelte/icons/palette';
	import { m } from '$lib/paraglide/messages';
	import { startImageEditorMetric } from '$lib/image-editor/telemetry';
	import TemplatePreview from '$lib/image-editor/components/template-preview.svelte';
	import { editorHandoffReturnURL } from '$lib/editor-handoff';

	let loading = $state(true);
	let creating = $state('');
	let error = $state('');
	let enabled = $state(true);
	let presets = $state<ImageEditorPreset[]>([]);
	let templates = $state<ImageEditorTemplate[]>([]);
	let customWidth = $state(1080);
	let customHeight = $state(1080);
	let workspaceID = $derived(
		$page.url.searchParams.get('workspace') || workspaceCtx.currentWorkspace?.id || ''
	);
	let returnToken = $derived($page.url.searchParams.get('return_token') || '');
	let sourceMediaID = $derived($page.url.searchParams.get('source_media') || '');
	let sourceName = $derived($page.url.searchParams.get('source_name') || '');
	let sourceWidth = $derived(Number($page.url.searchParams.get('width') || 0));
	let sourceHeight = $derived(Number($page.url.searchParams.get('height') || 0));
	let initialAction = $derived($page.url.searchParams.get('action') || '');

	onMount(() => {
		void initialize();
	});

	async function initialize(): Promise<void> {
		loading = true;
		error = '';
		const finishMetric = startImageEditorMetric('document_load');
		try {
			await workspaceCtx.initialize($page.url.searchParams.get('workspace') || undefined);
			const config = await loadImageEditorConfig();
			enabled = config.enabled;
			presets = config.presets;
			if (workspaceID && enabled) templates = await listImageEditorTemplates(workspaceID);
			if (sourceMediaID && workspaceID && enabled) {
				await createFromSource();
				return;
			}
			const requestedTemplate = $page.url.searchParams.get('template');
			if (requestedTemplate && templates.some((template) => template.id === requestedTemplate)) {
				await createTemplate(templates.find((template) => template.id === requestedTemplate)!);
				return;
			}
			const requestedPreset = $page.url.searchParams.get('preset');
			if (requestedPreset && presets.some((preset) => preset.key === requestedPreset)) {
				await createPreset(requestedPreset);
			}
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.image_editor_open_failed();
		} finally {
			finishMetric(error ? 'error' : 'success');
			loading = false;
		}
	}

	async function createPreset(key: string): Promise<void> {
		if (!workspaceID || creating) return;
		creating = key;
		error = '';
		try {
			const design = await createImageEditorDesign(workspaceID, {
				title: m.image_editor_untitled_design(),
				preset_key: key,
				...(key === 'custom' ? { width_px: customWidth, height_px: customHeight } : {})
			});
			captureTelemetryEvent('image design created', {
				source: key === 'custom' ? 'custom' : 'preset'
			});
			await openDesign(design.id);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.image_editor_create_failed();
			creating = '';
		}
	}

	async function createTemplate(template: ImageEditorTemplate): Promise<void> {
		if (!workspaceID || creating) return;
		creating = template.id;
		error = '';
		try {
			const design = await instantiateImageEditorTemplate(template.id, workspaceID);
			captureTelemetryEvent('image design created', { source: 'template' });
			await openDesign(design.id);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.image_editor_template_use_failed();
			creating = '';
		}
	}

	async function createFromSource(): Promise<void> {
		if (!workspaceID || creating) return;
		creating = 'source-media';
		const sourceSize = fitSourceSize(sourceWidth, sourceHeight);
		try {
			const design = await createImageEditorDesign(workspaceID, {
				title: sourceName
					? m.image_editor_image_edit_title({ name: sourceName.replace(/\.[^.]+$/, '') })
					: m.image_editor_media_edit_title(),
				preset_key: 'custom',
				width_px: sourceSize.width,
				height_px: sourceSize.height,
				source_media_id: sourceMediaID
			});
			captureTelemetryEvent('image design created', { source: 'media' });
			await openDesign(design.id);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.image_editor_media_open_failed();
			creating = '';
		}
	}

	function fitSourceSize(width: number, height: number): { width: number; height: number } {
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
		await goto(resolve(`/image-editor/${id}${suffix}` as '/'), { replaceState: true });
	}

	function goBack(): void {
		if (returnToken) {
			const returnURL = editorHandoffReturnURL(returnToken, 'image', 'cancelled');
			if (returnURL) {
				void goto(resolve(returnURL as '/'));
				return;
			}
		}
		if (history.length > 1) history.back();
		else void goto(resolve('/media' as '/'));
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

	function templateCategory(template: ImageEditorTemplate): string {
		if (!template.built_in) return template.category;
		switch (template.category) {
			case 'Announcements':
				return m.image_editor_template_category_announcements();
			case 'Photo-led':
				return m.image_editor_template_category_photo();
			case 'Quotes':
				return m.image_editor_template_category_quotes();
			case 'Education':
				return m.image_editor_template_category_education();
			case 'Stories':
				return m.image_editor_template_category_stories();
			case 'Professional':
				return m.image_editor_template_category_professional();
			case 'Thumbnails':
				return m.image_editor_template_category_thumbnails();
			default:
				return template.category;
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
		<div class="ml-2">
			<h1 class="text-sm font-semibold">{m.image_editor_new_design()}</h1>
			<p class="text-xs text-muted-foreground">{m.image_editor_title()}</p>
		</div>
	</header>

	<main class="mx-auto max-w-6xl px-4 py-8 sm:px-6">
		{#if loading}
			<div class="flex min-h-[60dvh] items-center justify-center text-muted-foreground">
				<LoaderIcon class="mr-2 size-5 animate-spin" />
				{m.image_editor_load()}
			</div>
		{:else if !enabled}
			<div class="mx-auto max-w-lg rounded-2xl border bg-card p-8 text-center">
				<PaletteIcon class="mx-auto mb-4 size-8 text-muted-foreground" />
				<h1 class="text-xl font-semibold">{m.image_editor_not_enabled()}</h1>
				<p class="mt-2 text-sm text-muted-foreground">
					{m.image_editor_not_enabled_body()}
				</p>
				<Button class="mt-5" onclick={() => goto(resolve('/media'))}
					>{m.image_editor_return_media()}</Button
				>
			</div>
		{:else}
			<div class="mb-8 max-w-2xl">
				<p class="text-sm font-medium text-primary">{m.image_editor_title()}</p>
				<h1 class="mt-1 text-3xl font-semibold tracking-tight">{m.image_editor_choose_format()}</h1>
				<p class="mt-2 text-muted-foreground">
					{m.image_editor_choose_format_body()}
				</p>
			</div>

			{#if error}
				<div class="mb-5 rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">
					{error}
				</div>
			{/if}

			<section aria-labelledby="preset-heading">
				<h2 id="preset-heading" class="mb-3 text-sm font-semibold">
					{m.image_editor_social_presets()}
				</h2>
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
					{#each presets as preset (preset.key)}
						<button
							type="button"
							class="group rounded-xl border bg-card p-3 text-left transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm"
							onclick={() => createPreset(preset.key)}
							disabled={Boolean(creating)}
						>
							<div
								class="mb-3 flex aspect-[4/3] items-center justify-center rounded-lg bg-neutral-800 p-4"
							>
								<div
									class="max-h-full max-w-full bg-orange-50 shadow-sm"
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

			<section class="mt-8 rounded-2xl border bg-card p-4" aria-labelledby="custom-heading">
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

			<section class="mt-10" aria-labelledby="templates-heading">
				<div class="mb-3">
					<h2 id="templates-heading" class="text-sm font-semibold">
						{m.image_editor_starter_templates()}
					</h2>
					<p class="text-xs text-muted-foreground">
						{m.image_editor_starter_templates_body()}
					</p>
				</div>
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
					{#each templates as template (template.id)}
						<button
							type="button"
							class="rounded-xl border bg-card p-3 text-left hover:border-primary/40 hover:shadow-sm"
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
							<p class="mt-0.5 truncate text-xs text-muted-foreground">
								{templateCategory(template)}
							</p>
						</button>
					{/each}
				</div>
			</section>
		{/if}
	</main>
</div>
