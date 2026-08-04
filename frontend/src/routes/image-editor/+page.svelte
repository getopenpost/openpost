<!--
THESIS: Public OpenPost Image Editor is a local workbench that starts with making, not an authentication pitch.
OWN-WORLD: OpenPost warm neutrals, compact Geist controls, structural borders, and one scarce orange action signal.
STORY: Choose a social format, open a local image, or use a template; edit and export; save to OpenPost only when cloud value matters.
FIRST VIEWPORT: A quiet product header, direct promise, image-import action, and real social-format choices, with recent local work leading for returning visitors.
FORM: Operate surface extending the established OpenPost Image Editor start screen; no marketing hero, editor fork, watermark, or export gate.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { auth } from '$lib/stores/auth';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import LanguageSwitcher from '$lib/components/language-switcher.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import TemplatePreview from '$lib/image-editor/components/template-preview.svelte';
	import { listPublicImageEditorTemplates, loadImageEditorConfig } from '$lib/image-editor/api';
	import {
		createGuestImageEditorDesign,
		createGuestImageEditorDesignFromImage,
		createGuestImageEditorDesignFromTemplate,
		deleteGuestImageEditorDesign,
		listGuestImageEditorDesigns,
		requestGuestImageEditorPersistence,
		type LocalImageEditorDesign
	} from '$lib/image-editor/local-persistence';
	import { trackPublicImageEditorEvent } from '$lib/image-editor/public-telemetry';
	import type { ImageEditorPreset, ImageEditorTemplate } from '$lib/image-editor/types';
	import ArrowRightIcon from 'lucide-svelte/icons/arrow-right';
	import ImageIcon from 'lucide-svelte/icons/image-plus';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import PaletteIcon from 'lucide-svelte/icons/palette';
	import TrashIcon from 'lucide-svelte/icons/trash-2';
	import { m } from '$lib/paraglide/messages';

	let authState = $derived($auth);
	let loading = $state(true);
	let creating = $state('');
	let error = $state('');
	let enabled = $state(true);
	let presets = $state.raw<ImageEditorPreset[]>([]);
	let templates = $state.raw<ImageEditorTemplate[]>([]);
	let recentDesigns = $state.raw<LocalImageEditorDesign[]>([]);
	let customWidth = $state(1080);
	let customHeight = $state(1080);
	let fileInput = $state<HTMLInputElement | null>(null);
	let pendingDelete = $state<LocalImageEditorDesign | null>(null);
	let deleteDialogOpen = $state(false);

	onMount(() => {
		void initialize();
	});

	async function initialize(): Promise<void> {
		loading = true;
		error = '';
		try {
			const [config, publicTemplates, localDesigns] = await Promise.all([
				loadImageEditorConfig(),
				listPublicImageEditorTemplates(),
				listGuestImageEditorDesigns()
			]);
			enabled = config.enabled;
			presets = config.presets;
			templates = publicTemplates;
			recentDesigns = localDesigns;
			trackPublicImageEditorEvent('image_editor_public_view', {
				returning_guest: localDesigns.length > 0
			});
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.image_editor_public_load_failed();
		} finally {
			loading = false;
		}
	}

	async function startPreset(preset: ImageEditorPreset): Promise<void> {
		if (creating) return;
		creating = preset.key;
		error = '';
		try {
			void requestGuestImageEditorPersistence();
			const design = await createGuestImageEditorDesign(preset, m.image_editor_untitled_design());
			trackPublicImageEditorEvent('image_editor_design_started', {
				entry: 'preset',
				preset: preset.key
			});
			await goto(resolve(`/image-editor/${design.id}` as '/'));
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.image_editor_create_failed();
			creating = '';
		}
	}

	async function startCustom(): Promise<void> {
		if (
			customWidth < 64 ||
			customHeight < 64 ||
			customWidth > 4096 ||
			customHeight > 4096 ||
			customWidth * customHeight > 25_000_000
		) {
			error = m.image_editor_resize_limits();
			return;
		}
		await startPreset({
			key: 'custom',
			name: m.image_editor_custom_size(),
			width_px: customWidth,
			height_px: customHeight,
			default_format: 'png',
			profiles: []
		});
	}

	async function startTemplate(template: ImageEditorTemplate): Promise<void> {
		if (creating) return;
		creating = template.id;
		error = '';
		try {
			void requestGuestImageEditorPersistence();
			const design = await createGuestImageEditorDesignFromTemplate(
				template,
				templateName(template)
			);
			trackPublicImageEditorEvent('image_editor_design_started', {
				entry: 'template',
				template: template.id
			});
			await goto(resolve(`/image-editor/${design.id}` as '/'));
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.image_editor_template_use_failed();
			creating = '';
		}
	}

	async function openImage(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || creating) return;
		creating = 'image';
		error = '';
		try {
			void requestGuestImageEditorPersistence();
			const design = await createGuestImageEditorDesignFromImage(
				file,
				file.name.replace(/\.[^.]+$/u, '') || m.image_editor_untitled_design()
			);
			trackPublicImageEditorEvent('image_editor_design_started', { entry: 'image' });
			await goto(resolve(`/image-editor/${design.id}` as '/'));
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.image_editor_media_open_failed();
			creating = '';
		}
	}

	function requestDelete(design: LocalImageEditorDesign): void {
		pendingDelete = design;
		deleteDialogOpen = true;
	}

	async function deleteDesign(): Promise<void> {
		if (!pendingDelete) return;
		await deleteGuestImageEditorDesign(pendingDelete.id);
		recentDesigns = recentDesigns.filter((design) => design.id !== pendingDelete?.id);
		pendingDelete = null;
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

<svelte:head>
	<title>{m.image_editor_public_meta_title()}</title>
	<meta name="description" content={m.image_editor_public_meta_description()} />
</svelte:head>

<div class="image-editor-theme min-h-dvh bg-background text-foreground">
	<header class="border-b bg-background">
		<div class="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
			<a href={resolve('/')} class="flex min-h-11 items-center" aria-label={m.common_openpost()}>
				<Logo width={112} height={33} />
			</a>
			<span class="hidden text-sm text-muted-foreground sm:inline">/ {m.image_editor_title()}</span>
			<div class="ml-auto flex items-center gap-1.5">
				<LanguageSwitcher compact />
				{#if authState.isAuthenticated}
					<Button href="/image-editor/new" variant="outline" size="sm">
						{m.image_editor_public_workspace()}
					</Button>
				{:else}
					<Button href="/login?redirect=%2Fimage-editor" variant="ghost" size="sm">
						{m.landing_sign_in()}
					</Button>
				{/if}
			</div>
		</div>
	</header>

	<main class="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
		<div class="max-w-3xl">
			<p class="text-sm font-medium text-primary">{m.image_editor_public_free_tool()}</p>
			<h1 class="mt-2 text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
				{m.image_editor_public_heading()}
			</h1>
			<p class="mt-4 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
				{m.image_editor_public_description()}
			</p>
			<div class="mt-6 flex flex-wrap items-center gap-3">
				<Button
					size="lg"
					onclick={() => fileInput?.click()}
					disabled={Boolean(creating) || !enabled}
				>
					{#if creating === 'image'}
						<LoaderIcon class="animate-spin" />
					{:else}
						<ImageIcon />
					{/if}
					{m.image_editor_public_open_image()}
				</Button>
				<p class="text-sm text-muted-foreground">{m.image_editor_public_no_account()}</p>
				<Input
					bind:ref={fileInput}
					type="file"
					accept="image/png,image/jpeg,image/webp"
					class="sr-only !size-px !p-0"
					onchange={openImage}
				/>
			</div>
		</div>

		{#if error}
			<InlineNotice tone="error" message={error} class="mt-6 max-w-3xl" />
		{/if}

		{#if loading}
			<div class="flex min-h-[50dvh] items-center justify-center text-muted-foreground">
				<LoaderIcon class="mr-2 size-5 animate-spin" />
				{m.image_editor_load()}
			</div>
		{:else if !enabled}
			<div class="mt-10 max-w-xl rounded-xl border bg-card p-6">
				<PaletteIcon class="size-7 text-muted-foreground" />
				<h2 class="mt-4 text-lg font-semibold">{m.image_editor_not_enabled()}</h2>
				<p class="mt-2 text-sm leading-6 text-muted-foreground">
					{m.image_editor_not_enabled_body()}
				</p>
			</div>
		{:else}
			{#if recentDesigns.length > 0}
				<section class="mt-12" aria-labelledby="recent-designs-heading">
					<div class="mb-4 flex items-end justify-between gap-4">
						<div>
							<h2 id="recent-designs-heading" class="text-lg font-semibold">
								{m.image_editor_public_recent()}
							</h2>
							<p class="mt-1 text-sm text-muted-foreground">
								{m.image_editor_public_recent_description()}
							</p>
						</div>
					</div>
					<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
						{#each recentDesigns as design (design.id)}
							<div class="group relative overflow-hidden rounded-xl border bg-card">
								<a
									href={resolve(`/image-editor/${design.id}` as '/')}
									class="block focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
								>
									<div class="aspect-[4/3] bg-neutral-800">
										<TemplatePreview
											document={design.document}
											label={design.document.title}
											compact
										/>
									</div>
									<div class="flex min-h-16 items-center gap-3 border-t px-3 py-2.5">
										<div class="min-w-0 flex-1">
											<p class="truncate text-sm font-medium">{design.document.title}</p>
											<p class="mt-0.5 text-xs text-muted-foreground">
												{new Date(design.updated_at).toLocaleString()}
											</p>
										</div>
										<ArrowRightIcon class="size-4 text-muted-foreground" />
									</div>
								</a>
								<Button
									variant="ghost"
									size="icon-sm"
									class="absolute top-2 right-2 bg-background/90"
									onclick={() => requestDelete(design)}
									aria-label={m.image_editor_public_delete_design({ title: design.document.title })}
								>
									<TrashIcon />
								</Button>
							</div>
						{/each}
					</div>
				</section>
			{/if}

			<section class="mt-12" aria-labelledby="formats-heading">
				<div class="mb-4">
					<h2 id="formats-heading" class="text-lg font-semibold">
						{m.image_editor_choose_format()}
					</h2>
					<p class="mt-1 text-sm text-muted-foreground">{m.image_editor_choose_format_body()}</p>
				</div>
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
					{#each presets as preset (preset.key)}
						<button
							type="button"
							class="group min-h-44 rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
							onclick={() => startPreset(preset)}
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

			<section class="mt-8 border-y py-6" aria-labelledby="custom-heading">
				<div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,32rem)] lg:items-end">
					<div>
						<h2 id="custom-heading" class="text-base font-semibold">
							{m.image_editor_custom_size()}
						</h2>
						<p class="mt-1 text-sm text-muted-foreground">{m.image_editor_custom_limits()}</p>
					</div>
					<div class="grid grid-cols-[1fr_1fr_auto] gap-2">
						<label class="grid gap-1 text-xs">
							<span>{m.image_editor_width()}</span>
							<Input type="number" min="64" max="4096" bind:value={customWidth} />
						</label>
						<label class="grid gap-1 text-xs">
							<span>{m.image_editor_height()}</span>
							<Input type="number" min="64" max="4096" bind:value={customHeight} />
						</label>
						<Button
							variant="outline"
							class="self-end"
							onclick={startCustom}
							disabled={Boolean(creating)}
						>
							{m.image_editor_create_custom()}
						</Button>
					</div>
				</div>
			</section>

			<section class="mt-12" aria-labelledby="templates-heading">
				<div class="mb-4">
					<h2 id="templates-heading" class="text-lg font-semibold">
						{m.image_editor_starter_templates()}
					</h2>
					<p class="mt-1 text-sm text-muted-foreground">
						{m.image_editor_public_templates_description()}
					</p>
				</div>
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
					{#each templates as template (template.id)}
						<button
							type="button"
							class="rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
							onclick={() => startTemplate(template)}
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
								<span class="min-w-0 flex-1 truncate text-sm font-medium">
									{templateName(template)}
								</span>
								{#if creating === template.id}<LoaderIcon class="size-4 animate-spin" />{/if}
							</div>
						</button>
					{/each}
				</div>
			</section>

			<p class="mt-10 max-w-3xl text-sm leading-6 text-muted-foreground">
				{m.image_editor_public_storage_note()}
			</p>
		{/if}
	</main>
</div>

<DestructiveConfirmDialog
	bind:open={deleteDialogOpen}
	title={m.image_editor_public_delete_title()}
	description={m.image_editor_public_delete_description()}
	onConfirm={deleteDesign}
/>
