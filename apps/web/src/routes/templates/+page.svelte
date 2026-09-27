<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import {
		screenshotTemplateListOptions,
		screenshotTemplateRecipeOptions,
		type ScreenshotDocument
	} from '@openpost/query-catalog';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { resolveAppPath } from '$lib/app-path';
	import { Button } from '$lib/components/ui/button';
	import PageContainer from '$lib/components/page-container.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import { ThemeIcon } from '$lib/themes/icons';
	import { m } from '$lib/paraglide/messages';
	import { createScreenshotDesign, deleteScreenshotDesign } from '$lib/screenshot-templates/api';
	import { screenshotTemplateAPI } from '$lib/query/screenshot-templates';
	import { newDocument, templateName, TEMPLATE_IDS } from '$lib/screenshot-templates/document';
	import MemeBrowser from '$lib/meme-generator/browser.svelte';
	import { memeDocument } from '$lib/screenshot-templates/meme';
	import { getLocaleTag } from '$lib/i18n';
	import Preview from '$lib/screenshot-templates/preview.svelte';
	const workspaceId = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const returnToken = $derived(page.url.searchParams.get('return_token') ?? '');
	const mediaID = $derived(page.url.searchParams.get('media') ?? '');
	let category = $state<'screenshots' | 'memes'>('screenshots');
	let offset = $state(0);
	let busy = $state(false);
	let error = $state('');
	let deleteID = $state('');
	let deleteOpen = $state(false);
	const designs = createQuery(() =>
		screenshotTemplateListOptions(screenshotTemplateAPI, workspaceId, offset)
	);
	const recipe = createQuery(() =>
		screenshotTemplateRecipeOptions(screenshotTemplateAPI, workspaceId, mediaID)
	);
	const examples = $derived(TEMPLATE_IDS.map((id) => newDocument(id)));
	const canEdit = $derived(designs.data?.can_edit ?? false);
	function editorURL(id: string) {
		return resolveAppPath(
			`/templates/${id}${returnToken ? `?return_token=${encodeURIComponent(returnToken)}` : ''}`
		);
	}
	async function create(document: ScreenshotDocument) {
		if (busy || !canEdit) return;
		busy = true;
		error = '';
		const expectedWorkspace = workspaceId;
		try {
			const design = await createScreenshotDesign(expectedWorkspace, document);
			if (workspaceId === expectedWorkspace) await goto(editorURL(design.id));
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.templates_save_failed();
		} finally {
			busy = false;
		}
	}
	$effect(() => {
		if (workspaceId) offset = 0;
	});
</script>

<svelte:head><title>{m.templates_title()} · OpenPost</title></svelte:head>
<PageContainer
	title={m.templates_title()}
	description={m.templates_description()}
	themeIconRole="editors"
	loading={designs.isPending}
	loadingLayout="gallery"
>
	{#snippet navigation()}
		<div class="flex flex-wrap gap-2" aria-label={m.templates_choose()}>
			<Button
				size="sm"
				variant={category === 'screenshots' ? 'secondary' : 'ghost'}
				aria-pressed={category === 'screenshots'}
				onclick={() => (category = 'screenshots')}>{m.templates_screenshots()}</Button
			>
			<Button
				size="sm"
				variant={category === 'memes' ? 'secondary' : 'ghost'}
				aria-pressed={category === 'memes'}
				onclick={() => (category = 'memes')}>{m.media_picker_meme()}</Button
			>
		</div>
	{/snippet}
	{#if error}<InlineNotice tone="error" message={error} />{/if}
	{#if designs.isError && !designs.data}<InlineNotice
			tone="error"
			message={m.templates_load_failed()}
			>{#snippet actions()}<Button variant="outline" size="sm" onclick={() => designs.refetch()}
					>{m.common_retry()}</Button
				>{/snippet}</InlineNotice
		>{:else}
		{#if !canEdit}<InlineNotice message={m.templates_read_only()} />{/if}
		{#if mediaID}<section class="mb-6 space-y-3 rounded-md border p-4">
				<h2 class="text-sm font-medium">{m.templates_use_recipe()}</h2>
				<p class="text-sm text-muted-foreground">{m.templates_recipe_description()}</p>
				{#if recipe.isError && !recipe.data}<InlineNotice
						tone="error"
						message={m.templates_load_failed()}
						>{#snippet actions()}<Button
								variant="outline"
								size="sm"
								onclick={() => recipe.refetch()}>{m.common_retry()}</Button
							>{/snippet}</InlineNotice
					>{:else}<Button
						disabled={busy || !canEdit || !recipe.data}
						onclick={() => {
							if (recipe.data) void create(recipe.data.document);
						}}>{m.templates_use_recipe()}</Button
					>{/if}
			</section>{/if}
		{#if category !== 'memes'}<section class="space-y-3">
				<h2 class="text-sm font-medium">{m.templates_choose()}</h2>
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
					{#each examples as document (document.template_id)}<button
							type="button"
							class="group overflow-hidden rounded-lg border text-left transition-colors hover:border-ring focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-60"
							disabled={!canEdit || busy}
							onclick={() => create(document)}
						>
							<div class="relative h-56 overflow-hidden bg-muted/50 p-4" aria-hidden="true">
								<div
									class="absolute top-4 left-1/2 origin-top -translate-x-1/2 scale-[.44] ring-1 ring-border"
								>
									<Preview {document} />
								</div>
							</div>
							<div class="flex items-center justify-between border-t bg-card px-4 py-3">
								<span class="text-sm font-medium">{templateName(document.template_id)}</span
								><ThemeIcon role="arrow-right" class="size-4 text-muted-foreground" />
							</div>
						</button>{/each}
				</div>
			</section>{/if}
		{#if category === 'memes'}<section class="mt-6 space-y-3">
				<h2 class="text-sm font-medium">{m.media_picker_meme()}</h2>
				<fieldset disabled={!canEdit || busy} class="min-w-0">
					{#key workspaceId}<MemeBrowser
							{workspaceId}
							language={getLocaleTag()}
							onSelect={(template, captions, altText) =>
								create(memeDocument(template, captions, altText))}
						/>{/key}
				</fieldset>
			</section>{/if}

		<section class="mt-8 space-y-3">
			<h2 class="text-sm font-medium">{m.templates_drafts()}</h2>
			{#if !designs.data?.designs?.length}<p class="py-8 text-sm text-muted-foreground">
					{m.templates_no_drafts()}
				</p>{:else}<div class="divide-y rounded-md border">
					{#each designs.data?.designs ?? [] as design (design.id)}<div
							class="flex items-center gap-3 p-3"
						>
							<a
								href={editorURL(design.id)}
								class="min-w-0 flex-1 rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
								><div class="truncate text-sm font-medium">{design.title}</div>
								<div class="text-xs text-muted-foreground">
									{templateName(design.template_id)}
								</div></a
							>{#if canEdit}<Button
									variant="ghost"
									size="icon-sm"
									aria-label={m.common_delete()}
									onclick={() => {
										deleteID = design.id;
										deleteOpen = true;
									}}><ThemeIcon role="delete" class="size-4" /></Button
								>{/if}
						</div>{/each}
				</div>{/if}
			{#if (designs.data?.total ?? 0) > 40}<div class="flex justify-end gap-2">
					<Button
						variant="outline"
						size="sm"
						disabled={offset === 0}
						onclick={() => (offset = Math.max(0, offset - 40))}>{m.templates_previous()}</Button
					><Button
						variant="outline"
						size="sm"
						disabled={offset + 40 >= (designs.data?.total ?? 0)}
						onclick={() => (offset += 40)}>{m.templates_next()}</Button
					>
				</div>{/if}
		</section>
	{/if}
</PageContainer>
<DestructiveConfirmDialog
	bind:open={deleteOpen}
	title={m.templates_delete_title()}
	description={m.templates_delete_description()}
	onConfirm={async () => {
		await deleteScreenshotDesign(workspaceId, deleteID);
		return { ok: true };
	}}
/>
