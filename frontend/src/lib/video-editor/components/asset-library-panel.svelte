<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import * as Tabs from '$lib/components/ui/tabs';
	import AppSelect from '$lib/components/app-select.svelte';
	import LottieBrowserPanel from './lottie-browser-panel.svelte';
	import VectorAssetPanel from './shape-panel.svelte';
	import StickerBrowserPanel from './sticker-browser-panel.svelte';
	import StockBrowserPanel from './stock-browser-panel.svelte';
	import BackgroundPanel from './background-panel.svelte';

	type AssetTab = 'shapes' | 'backgrounds' | 'stock' | 'stickers' | 'lottie';
	let { projectId, oninserted }: { projectId: string; oninserted: (itemId: string) => void } =
		$props();
	let activeTab = $state<AssetTab>('shapes');
	const assetOptions = $derived([
		{ value: 'shapes', label: m.video_editor_shapes() },
		{ value: 'backgrounds', label: m.video_editor_backgrounds_title() },
		{ value: 'stock', label: m.video_editor_stock_assets() },
		{ value: 'stickers', label: m.video_editor_stickers() },
		{ value: 'lottie', label: m.video_editor_animations() }
	]);
</script>

<Tabs.Root bind:value={activeTab} class="flex min-h-0 flex-1 flex-col">
	<div class="border-b border-[oklch(0.25_0.015_55)] px-2 py-1.5">
		<AppSelect
			class="h-8 w-full text-xs"
			value={activeTab}
			options={assetOptions}
			ariaLabel={m.video_editor_assets()}
			onValueChange={(value) => (activeTab = value as AssetTab)}
		/>
	</div>
	{#if activeTab === 'shapes'}
		<VectorAssetPanel {oninserted} />
	{:else if activeTab === 'backgrounds'}
		<BackgroundPanel {oninserted} />
	{:else if activeTab === 'stock'}
		<StockBrowserPanel {projectId} {oninserted} />
	{:else if activeTab === 'stickers'}
		<StickerBrowserPanel {projectId} {oninserted} />
	{:else}
		<LottieBrowserPanel {projectId} />
	{/if}
</Tabs.Root>
