<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import StockMediaBrowser from '$lib/components/stock-media-browser.svelte';
	import { m } from '$lib/paraglide/messages';
	import type { StockAsset } from '$lib/stock-media';
	import { showToast } from '$lib/toast';
	import { commitImportedAsset } from '$lib/video-editor/media/commit-imported-asset';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';

	let {
		projectId,
		oninserted,
		commitAsset = commitImportedAsset,
		services
	}: {
		projectId: string;
		oninserted: (itemId: string) => void;
		commitAsset?: typeof commitImportedAsset;
		services?: ComponentProps<typeof StockMediaBrowser>['services'];
	} = $props();

	function stockAttribution(asset: StockAsset) {
		return {
			provider: asset.provider,
			author: asset.creator_name,
			authorUrl: asset.creator_url,
			sourceId: asset.external_id,
			license: asset.license_name,
			licenseUrl: asset.license_url
		};
	}

	async function addStock(file: File, asset: StockAsset): Promise<void> {
		const committed = await commitAsset(file, {
			projectId,
			attribution: stockAttribution(asset),
			tags: ['stock', asset.provider],
			insertAtFrame: timelineStore.currentFrame,
			label: asset.title || file.name
		});
		oninserted(committed.itemId);
		showToast(m.video_editor_stock_added({ name: asset.title || file.name }), 'success');
	}
</script>

<div
	class="min-h-0 flex-1 overflow-y-auto p-2 text-[var(--video-editor-text)]"
	aria-label={m.video_editor_stock_assets()}
>
	<StockMediaBrowser
		compact
		actionLabel={m.video_editor_stock_add_playhead()}
		onSelect={addStock}
		{services}
	/>
</div>
