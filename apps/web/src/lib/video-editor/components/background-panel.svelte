<script lang="ts">
	import { onMount } from 'svelte';
	import { Input } from '$lib/components/ui/input';
	import { m } from '$lib/paraglide/messages';
	import { addBackgroundItem } from '$lib/video-editor/timeline/actions/backgrounds';
	import { BACKGROUND_PRESETS } from '$lib/video-editor/backgrounds/presets';
	import { backgroundPresetLabel } from '../backgrounds/labels';
	import BackgroundThumbnail from './background-thumbnail.svelte';
	import { shaderBackgroundSupport } from '../backgrounds/shader-support.svelte';
	import {
		backgroundGeneratedItemDragData,
		clearGeneratedItemDragData,
		writeGeneratedItemDragData
	} from '$lib/video-editor/timeline/generated-item-drag';

	let search = $state('');
	let activeId = $state<string | null>(null);

	function startDrag(event: DragEvent, presetId: string): void {
		if (!event.dataTransfer) return;
		writeGeneratedItemDragData(
			event.dataTransfer,
			backgroundGeneratedItemDragData(backgroundPresetLabel(presetId), presetId)
		);
	}
	const matching = $derived(
		BACKGROUND_PRESETS.filter((preset) =>
			backgroundPresetLabel(preset.id)
				.toLocaleLowerCase()
				.includes(search.trim().toLocaleLowerCase())
		)
	);
	let { oninserted }: { oninserted: (itemId: string) => void } = $props();
	onMount(() => {
		shaderBackgroundSupport.check();
	});
</script>

<div
	role="group"
	class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-1"
	aria-label={m.video_editor_backgrounds_title()}
>
	<Input
		type="search"
		bind:value={search}
		placeholder={m.video_editor_paper_search()}
		aria-label={m.video_editor_paper_search()}
		class="h-[22px] shrink-0 text-xs [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:text-base"
	/>
	{#if matching.length === 0}<p class="text-xs text-muted-foreground" role="status">
			{m.video_editor_paper_empty()}
		</p>{/if}
	{#each [true, false] as shaders (shaders)}
		<section class="space-y-2">
			<h3
				class="text-[11px] font-medium"
				title={shaders ? m.video_editor_shader_hint() : undefined}
			>
				{shaders ? m.video_editor_shader_title() : m.video_editor_shader_classic()}
			</h3>
			{#if shaders && !shaderBackgroundSupport.available}
				<p class="text-[11px] leading-4 text-muted-foreground" role="status">
					{m.video_editor_shader_unavailable()}
				</p>
			{/if}
			<div class="grid grid-cols-2 gap-2">
				{#each matching.filter((preset) => (preset.background.kind === 'shader') === shaders) as preset (preset.id)}
					<button
						type="button"
						class="group flex min-h-14 min-w-0 cursor-grab flex-col gap-1 rounded-md p-1 text-left text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
						draggable="true"
						disabled={preset.background.kind === 'shader' &&
							!shaderBackgroundSupport.isAvailable(preset.background.shader)}
						onclick={() => oninserted(addBackgroundItem(preset.id))}
						ondragstart={(event) => startDrag(event, preset.id)}
						ondragend={clearGeneratedItemDragData}
						aria-label={backgroundPresetLabel(preset.id)}
						onpointerenter={(event) => {
							if (event.pointerType !== 'touch') activeId = preset.id;
						}}
						onpointerleave={() => {
							if (activeId === preset.id) activeId = null;
						}}
						onfocus={() => (activeId = preset.id)}
						onblur={() => {
							if (activeId === preset.id) activeId = null;
						}}
					>
						<BackgroundThumbnail
							background={preset.background}
							active={activeId === preset.id}
							onfailure={() => {
								if (preset.background.kind === 'shader')
									shaderBackgroundSupport.reportFailure(preset.background.shader);
							}}
						/>
						<span class="px-0.5">{backgroundPresetLabel(preset.id)}</span>
					</button>
				{/each}
			</div>
		</section>
	{/each}
</div>
