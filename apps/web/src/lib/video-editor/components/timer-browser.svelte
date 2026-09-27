<script lang="ts">
	import LibraryShelf from './library-shelf.svelte';
	import type { ProjectAssetImporter } from '../media/types';
	import TimerThumbnail from './timer-thumbnail.svelte';
	import LibraryFavorite from './library-favorite.svelte';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { addTimer } from '../timers/actions';
	import type { TimerSettings } from '../timers/timer';
	import {
		clearGeneratedItemDragData,
		writeGeneratedItemDragData
	} from '../timeline/generated-item-drag';
	let {
		oninserted,
		importAsset
	}: { oninserted: (id: string) => void; importAsset?: ProjectAssetImporter } = $props();
	const presets = $derived<Array<{ name: string; timer: TimerSettings }>>([
		{
			name: m.video_editor_timer_down(),
			timer: { finishHoldSeconds: 0.5, style: 'numbers', direction: 'down', format: 'seconds' }
		},
		{
			name: m.video_editor_timer_ring(),
			timer: { finishHoldSeconds: 0.5, style: 'ring', direction: 'down', format: 'clock' }
		},
		{
			name: m.video_editor_timer_bar(),
			timer: { finishHoldSeconds: 0.5, style: 'bar', direction: 'up', format: 'percent' }
		},
		{
			name: m.video_editor_timer_up(),
			timer: { finishHoldSeconds: 0.5, style: 'numbers', direction: 'up', format: 'clock' }
		},
		{
			name: m.video_editor_timer_bomb(),
			timer: { finishHoldSeconds: 0.5, style: 'bomb', direction: 'down', format: 'seconds' }
		},
		{
			name: m.video_editor_timer_tomato(),
			timer: { finishHoldSeconds: 0.5, style: 'tomato', direction: 'down', format: 'clock' }
		}
	]);
</script>

<div class="min-h-0 flex-1 overflow-y-auto p-2">
	<LibraryShelf kind="timer" {oninserted} {importAsset} />
	<div class="grid grid-cols-2 gap-2">
		{#each presets as preset}
			<div class="relative min-w-0">
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
					onclick={() => oninserted(addTimer(preset.timer, preset.name))}
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
