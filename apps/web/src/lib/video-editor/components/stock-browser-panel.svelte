<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import StockMediaBrowser from '$lib/components/stock-media-browser.svelte';
	import { m } from '$lib/paraglide/messages';
	import type { StockAsset } from '$lib/stock-media';
	import { stockAssetAttribution } from '$lib/stock-media';
	import { showToast } from '$lib/toast';
	import { commitImportedAsset } from '$lib/video-editor/media/commit-imported-asset';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { clearStockDragData, writeStockDragData } from '$lib/video-editor/media/stock-drag';
	import type { ProjectAssetImporter } from '$lib/video-editor/media/types';

	let {
		projectId,
		oninserted,
		commitAsset = commitImportedAsset,
		importProjectAsset,
		services
	}: {
		projectId: string;
		oninserted: (itemId: string) => void;
		commitAsset?: typeof commitImportedAsset;
		importProjectAsset?: ProjectAssetImporter;
		services?: ComponentProps<typeof StockMediaBrowser>['services'];
	} = $props();

	function stockAttribution(asset: StockAsset) {
		return stockAssetAttribution(asset);
	}

	function startDrag(event: DragEvent, asset: StockAsset): void {
		if (!event.dataTransfer) return;
		writeStockDragData(event.dataTransfer, asset);
	}

	async function addStock(file: File, asset: StockAsset): Promise<void> {
		const committed = await commitAsset(file, {
			projectId,
			attribution: stockAttribution(asset),
			tags: ['stock', asset.provider],
			insertAtFrame: timelineStore.currentFrame,
			label: asset.title || file.name,
			importAsset: importProjectAsset
		});
		oninserted(committed.itemId);
		showToast(m.video_editor_stock_added({ name: asset.title || file.name }), 'success');
	}
</script>

<div
	class="min-h-0 flex-1 overflow-y-auto p-2 text-[var(--video-editor-text)]"
	role="group"
	aria-label={m.video_editor_stock_assets()}
>
	<StockMediaBrowser
		compact
		actionLabel={m.video_editor_stock_add_playhead()}
		onSelect={addStock}
		onDragStart={startDrag}
		onDragEnd={clearStockDragData}
		{services}
	/>
</div>
