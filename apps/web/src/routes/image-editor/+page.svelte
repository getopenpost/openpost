<script lang="ts">
	import { onMount } from 'svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import {
		imageEditorConfigQueryOptions,
		imageEditorPublicTemplatesQueryOptions
	} from '@openpost/query-catalog';
	import { goto } from '$app/navigation';
	import { resolveAppPath } from '$lib/app-path';
	import { auth } from '$lib/stores/auth';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import type { DestructiveActionOutcome } from '$lib/destructive-action-outcome';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import EditorStart from '$lib/components/editor-start.svelte';
	import EditorFormatButton from '$lib/components/editor-format-button.svelte';
	import TemplatePreview from '$lib/image-editor/components/template-preview.svelte';
	import { imageEditorQueryAPI, type WebImageEditorQueryData } from '$lib/query/image-editor';
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
	import { m } from '$lib/paraglide/messages';
	import { showToast } from '$lib/toast';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';

	let authState = $derived($auth);
	let localLoading = $state(true);
	let creating = $state('');
	let error = $state('');
	let localLoadError = $state('');
	let recentDesigns = $state.raw<LocalImageEditorDesign[]>([]);
	let customWidth = $state(1080);
	let customHeight = $state(1080);
	let fileInput = $state<HTMLInputElement | null>(null);
	let pendingDelete = $state<LocalImageEditorDesign | null>(null);
	let deleteDialogOpen = $state(false);
	let pageHeading = $state<HTMLHeadingElement | null>(null);
	let recentHeading = $state<HTMLHeadingElement | null>(null);
	let deleteReturnFocus = $state<HTMLElement | null>(null);
	const configQuery = createQuery(() => imageEditorConfigQueryOptions(imageEditorQueryAPI));
	const templatesQuery = createQuery(() =>
		imageEditorPublicTemplatesQueryOptions<WebImageEditorQueryData>(imageEditorQueryAPI)
	);
	let enabled = $derived(configQuery.data?.enabled ?? true);
	let presets = $derived<ImageEditorPreset[]>(configQuery.data?.presets ?? []);
	let templates = $derived<ImageEditorTemplate[]>(templatesQuery.data ?? []);
	let blankPreset = $derived(
		presets.find((preset) => preset.key === 'instagram-square') ?? presets[0]
	);
	let loading = $derived(
		localLoading ||
			(configQuery.isPending && !configQuery.data) ||
			(templatesQuery.isPending && !templatesQuery.data)
	);
	let loadError = $derived(
		localLoadError ||
			(configQuery.isError && !configQuery.data
				? configQuery.error instanceof Error
					? configQuery.error.message
					: m.image_editor_public_load_failed()
				: '') ||
			(templatesQuery.isError && !templatesQuery.data
				? templatesQuery.error instanceof Error
					? templatesQuery.error.message
					: m.image_editor_public_load_failed()
				: '')
	);
	let backgroundLoadError = $derived(
		(configQuery.isError && configQuery.data
			? configQuery.error instanceof Error
				? configQuery.error.message
				: m.image_editor_public_load_failed()
			: '') ||
			(templatesQuery.isError && templatesQuery.data
				? templatesQuery.error instanceof Error
					? templatesQuery.error.message
					: m.image_editor_public_load_failed()
				: '')
	);

	onMount(() => {
		void loadLocalDesigns();
	});

	async function loadLocalDesigns(): Promise<void> {
		localLoading = true;
		localLoadError = '';
		try {
			const localDesigns = await listGuestImageEditorDesigns();
			recentDesigns = localDesigns;
			trackPublicImageEditorEvent('image_editor_public_view', {
				returning_guest: localDesigns.length > 0
			});
		} catch (cause) {
			localLoadError = cause instanceof Error ? cause.message : m.image_editor_public_load_failed();
		} finally {
			localLoading = false;
		}
	}

	async function retryLoad(): Promise<void> {
		await Promise.all([configQuery.refetch(), templatesQuery.refetch(), loadLocalDesigns()]);
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
			await goto(resolveAppPath(`/image-editor/${design.id}`));
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
			await goto(resolveAppPath(`/image-editor/${design.id}`));
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.image_editor_template_use_failed();
			creating = '';
		}
	}

	async function openImage(): Promise<void> {
		const input = fileInput;
		if (!input) return;
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
			await goto(resolveAppPath(`/image-editor/${design.id}`));
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.image_editor_media_open_failed();
			creating = '';
		}
	}

	function requestDelete(design: LocalImageEditorDesign): void {
		pendingDelete = design;
		deleteReturnFocus = recentDesigns.length > 1 ? recentHeading : pageHeading;
		deleteDialogOpen = true;
	}

	async function deleteDesign(): Promise<DestructiveActionOutcome> {
		if (!pendingDelete) return { ok: false };
		await deleteGuestImageEditorDesign(pendingDelete.id);
		recentDesigns = recentDesigns.filter((design) => design.id !== pendingDelete?.id);
		pendingDelete = null;
		showToast(m.image_editor_public_deleted(), 'success');
		return { ok: true };
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
	<EditorStart
		kind="image"
		title={m.editor_start_image_title()}
		description={m.editor_start_image_description()}
		bind:heading={pageHeading}
	>
		{#snippet utility()}
			{#if authState.isAuthenticated}
				<Button href="/image-editor/new" variant="ghost" size="sm"
					>{m.image_editor_workspace_category()}</Button
				>
			{:else}
				<Button href="/login?redirect=%2Fimage-editor" variant="ghost" size="sm"
					>{m.landing_sign_in()}</Button
				>
			{/if}
		{/snippet}
		{#snippet actions()}
			<Button
				onclick={() => blankPreset && startPreset(blankPreset)}
				disabled={Boolean(creating) || !enabled || !blankPreset}
			>
				{#if creating === blankPreset?.key}<ProtectedIcon
						icon="loading"
						class="animate-spin motion-reduce:animate-none"
					/>{:else}<ThemeIcon role="add" />{/if}
				{m.editor_start_new_project()}
			</Button>
			<Button
				variant="outline"
				onclick={() => fileInput?.click()}
				disabled={Boolean(creating) || !enabled}
			>
				<ThemeIcon role="image-add" />{m.image_editor_public_open_image()}
			</Button>
			<Input
				bind:ref={fileInput}
				type="file"
				accept="image/png,image/jpeg,image/webp"
				aria-label={m.image_editor_public_open_image()}
				class="hidden"
				onchange={() => void openImage()}
			/>
		{/snippet}

		{#if error}
			<InlineNotice tone="error" message={error} class="mt-6 max-w-3xl" />
		{/if}

		{#if loading}
			<div class="mt-10">
				<PageLoading layout="gallery" label={m.image_editor_load()} items={8} />
			</div>
		{:else if loadError}
			<InlineNotice tone="error" message={loadError} class="mt-10 max-w-3xl">
				{#snippet actions()}
					<Button size="sm" onclick={() => void retryLoad()}>{m.common_retry()}</Button>
				{/snippet}
			</InlineNotice>
		{:else if !enabled}
			<div class="mt-10 max-w-xl rounded-xl border bg-card p-6">
				<ThemeIcon role="appearance" class="size-7 text-muted-foreground" />
				<h2 class="mt-4 text-lg font-semibold">{m.image_editor_not_enabled()}</h2>
				<p class="mt-2 text-sm leading-6 text-muted-foreground">
					{m.image_editor_not_enabled_body()}
				</p>
			</div>
		{:else}
			{#if backgroundLoadError}
				<InlineNotice tone="warning" message={backgroundLoadError} class="mt-10 max-w-3xl">
					{#snippet actions()}
						<Button size="sm" variant="outline" onclick={() => void retryLoad()}
							>{m.common_retry()}</Button
						>
					{/snippet}
				</InlineNotice>
			{/if}
			<section aria-labelledby="formats-heading">
				<h2 id="formats-heading" class="mb-3 text-base font-semibold">
					{m.image_editor_choose_format()}
				</h2>
				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					{#each presets as preset (preset.key)}
						<EditorFormatButton
							label={presetName(preset)}
							width={preset.width_px}
							height={preset.height_px}
							disabled={Boolean(creating)}
							busy={creating === preset.key}
							onclick={() => void startPreset(preset)}
						/>
					{/each}
				</div>
			</section>

			<details class="mt-4 border-b pb-4">
				<summary class="min-h-11 cursor-pointer py-3 text-sm font-medium"
					>{m.image_editor_custom_size()}</summary
				>
				<section class="pt-3" aria-labelledby="custom-heading">
					<div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,32rem)] lg:items-end">
						<div>
							<h2 id="custom-heading" class="text-base font-semibold">
								{m.image_editor_custom_size()}
							</h2>
							<p class="mt-1 text-sm text-muted-foreground">{m.image_editor_custom_limits()}</p>
						</div>
						<div class="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
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
								class="self-end sm:w-auto"
								onclick={startCustom}
								disabled={Boolean(creating)}
							>
								{m.image_editor_create_custom()}
							</Button>
						</div>
					</div>
				</section>
			</details>
			{#if recentDesigns.length > 0}
				<section class="mt-12" aria-labelledby="recent-designs-heading">
					<div class="mb-4 flex items-end justify-between gap-4">
						<div>
							<h2
								bind:this={recentHeading}
								id="recent-designs-heading"
								tabindex="-1"
								class="text-lg font-semibold outline-none"
							>
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
									href={resolveAppPath(`/image-editor/${design.id}`)}
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
										<ThemeIcon role="arrow-right" class="size-4 text-muted-foreground" />
									</div>
								</a>
								<Button
									variant="ghost"
									size="icon-sm"
									class="absolute top-2 right-2 bg-background/90"
									onclick={() => requestDelete(design)}
									aria-label={m.image_editor_public_delete_design({ title: design.document.title })}
								>
									<ThemeIcon role="delete" />
								</Button>
							</div>
						{/each}
					</div>
				</section>
			{/if}

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
							class="min-w-0 overflow-hidden rounded-xl border bg-card text-left transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
							onclick={() => startTemplate(template)}
							disabled={Boolean(creating)}
						>
							<div class="aspect-square overflow-hidden border-b">
								<TemplatePreview
									document={template.document}
									label={templateName(template)}
									compact
								/>
							</div>
							<div class="flex min-h-16 items-center gap-2 p-3">
								<span class="min-w-0 flex-1 text-sm leading-snug font-medium">
									{templateName(template)}
								</span>
								{#if creating === template.id}<ProtectedIcon
										icon="loading"
										class="size-4 animate-spin"
									/>{/if}
							</div>
						</button>
					{/each}
				</div>
			</section>

			<p class="mt-10 max-w-3xl text-sm leading-6 text-muted-foreground">
				{m.image_editor_public_storage_note()}
			</p>
		{/if}
	</EditorStart>
</div>

<DestructiveConfirmDialog
	bind:open={deleteDialogOpen}
	title={m.image_editor_public_delete_title()}
	description={m.image_editor_public_delete_description()}
	onConfirm={deleteDesign}
	returnFocus={deleteReturnFocus}
/>
