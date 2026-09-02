<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import BrandKitEditor from '$lib/image-editor/components/brand-kit-editor.svelte';
	import { imageEditorQueryAPI } from '$lib/query/image-editor';
	import { queryClient } from '$lib/query/client';
	import { createQuery } from '@tanstack/svelte-query';
	import { imageEditorBrandKitQueryOptions, imageEditorQueryKeys } from '@openpost/query-catalog';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import PaletteIcon from '@lucide/svelte/icons/palette';
	import { m } from '$lib/paraglide/messages';

	let { workspaceID, active }: { workspaceID: string; active: boolean } = $props();
	const brandQuery = createQuery(() => ({
		...imageEditorBrandKitQueryOptions(imageEditorQueryAPI, workspaceID),
		enabled: active && Boolean(workspaceID)
	}));
	const kit = $derived(brandQuery.data ?? null);
	const loading = $derived(active && brandQuery.isPending && !brandQuery.data);
	const error = $derived(
		brandQuery.isError
			? brandQuery.error instanceof Error
				? brandQuery.error.message
				: m.media_hub_load_failed()
			: ''
	);
</script>

{#if error}
	<InlineNotice tone={kit ? 'warning' : 'error'} message={error}>
		{#snippet actions()}
			<Button variant="outline" size="sm" onclick={() => void brandQuery.refetch()}
				>{m.common_retry()}</Button
			>
		{/snippet}
	</InlineNotice>
{/if}
{#if loading}
	<PageLoading layout="sections" label={m.media_loading_brand()} />
{:else if kit}
	{#if kit.can_edit}
		<BrandKitEditor
			{kit}
			onSaved={(saved) =>
				queryClient.setQueryData(imageEditorQueryKeys.brandKit(workspaceID), saved)}
		/>
	{:else}
		<div class="space-y-8">
			<InlineNotice tone="info" message={m.brand_read_only()} />
			<div class="grid gap-8 lg:grid-cols-2">
				<section class="space-y-4">
					<div class="flex items-center gap-2">
						<PaletteIcon class="size-4 text-primary" />
						<h2 class="font-semibold">{m.brand_colors_backgrounds()}</h2>
					</div>
					<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
						{#each kit.colors as color (color.id || color.name)}
							<div class="overflow-hidden rounded-xl border">
								<div class="h-16" style:background={color.value}></div>
								<div class="px-3 py-2 text-xs">
									<p class="font-medium">{color.name}</p>
									<p class="text-muted-foreground">{color.value}</p>
								</div>
							</div>
						{/each}
					</div>
					<div>
						<h3 class="mb-2 text-sm font-medium">{m.brand_page_backgrounds()}</h3>
						<div class="flex flex-wrap gap-2">
							{#each kit.backgrounds as background (background)}
								<span class="size-11 rounded-lg border" style:background title={background}></span>
							{/each}
						</div>
					</div>
				</section>
				<section class="space-y-4">
					<div>
						<h2 class="font-semibold">{m.brand_fonts()}</h2>
						<p class="mt-1 text-sm text-muted-foreground">{m.brand_fonts_description()}</p>
					</div>
					<div class="divide-y rounded-xl border">
						{#each kit.fonts as font (font.id)}
							<div class="px-3 py-3">
								<p class="text-sm font-medium">{font.family}</p>
								<p class="text-xs text-muted-foreground">{font.weight} · {font.style}</p>
							</div>
						{/each}
					</div>
					{#if kit.fonts.length === 0}
						<p class="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
							{m.image_editor_brand_empty()}
						</p>
					{/if}
				</section>
			</div>
		</div>
	{/if}
{/if}
