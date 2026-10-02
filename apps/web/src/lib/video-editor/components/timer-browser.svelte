<script lang="ts">
	import LibraryShelf from './library-shelf.svelte';
	import type { ProjectAssetImporter } from '../media/types';
	import TimerThumbnail from './timer-thumbnail.svelte';
	import LibraryFavorite from './library-favorite.svelte';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { addTimer } from '../timers/actions';
	import { videoTimerPresets } from '../timers/presets';
	import { videoLibrary } from '../library/library-store.svelte';
	import {
		clearGeneratedItemDragData,
		writeGeneratedItemDragData
	} from '../timeline/generated-item-drag';
	let {
		oninserted,
		importAsset
	}: { oninserted: (id: string) => void; importAsset?: ProjectAssetImporter } = $props();
	const presets = $derived(videoTimerPresets());
</script>

<div class="min-h-0 flex-1 overflow-y-auto p-2">
	<LibraryShelf kind="timer" {oninserted} {importAsset} />
	<div class="grid grid-cols-2 gap-2">
		{#each presets as preset}
			<div class="group/library-item relative min-w-0">
				<Button
					variant="outline"
					class="h-auto min-h-20 w-full flex-col gap-2 py-3 md:h-auto [@media(pointer:coarse)]:h-auto"
					draggable="true"
					ondragstart={(event) => {
						if (event.dataTransfer)
							writeGeneratedItemDragData(event.dataTransfer, {
								version: 1,
								kind: 'timer',
								label: preset.name,
								timer: preset.timer
							});
					}}
					ondragend={clearGeneratedItemDragData}
					onclick={() => {
						oninserted(addTimer(preset.timer, preset.name));
						videoLibrary.recordChoice(
							`${videoLibrary.scope}:timer:${preset.timer.style}:${preset.timer.direction}`,
							preset.name
						);
					}}
				>
					<TimerThumbnail timer={preset.timer} />
					<span class="text-xs">{preset.name}</span>
				</Button>
				<LibraryFavorite
					catalogId={`timer:${preset.timer.style}:${preset.timer.direction}`}
					name={preset.name}
					recipe={{ kind: 'timer', timer: preset.timer }}
				/>
			</div>
		{/each}
	</div>
</div>
