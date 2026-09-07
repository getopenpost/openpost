<script lang="ts">
	import KeyframeEasingEditor, { type SegmentEasingUpdate } from './keyframe-easing-editor.svelte';
	import type { EditorKeyframe } from '$lib/video-editor/timeline/keyframe-editor';
	import type { KeyframeProperty } from '$lib/video-editor/project/types';
	import type { EasingConfig } from '$lib/video-editor/project/types';

	let {
		keyframe,
		endFrame,
		property,
		selectedFrames,
		leftPx,
		maxLeftPx,
		onchange,
		onclose
	}: {
		keyframe: EditorKeyframe;
		endFrame: number;
		property: KeyframeProperty;
		selectedFrames: number[];
		leftPx: number;
		maxLeftPx: number;
		onchange: (updates: SegmentEasingUpdate[]) => void;
		onclose: () => void;
	} = $props();

	let panel = $state<HTMLDivElement | null>(null);

	const PANEL_WIDTH = 288;
	const clampedLeft = $derived(Math.max(0, Math.min(Math.max(0, maxLeftPx - PANEL_WIDTH), leftPx)));

	function onWindowPointerDown(event: PointerEvent): void {
		// SAFETY: contains() only needs a Node; non-Node targets fall through to close.
		if (!panel || panel.contains(event.target as Node | null)) return;
		onclose();
	}

	function onWindowKeyDown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.stopPropagation();
			onclose();
		}
	}
</script>

<svelte:window onpointerdowncapture={onWindowPointerDown} onkeydowncapture={onWindowKeyDown} />

<div
	bind:this={panel}
	class="absolute top-0 z-30 w-72"
	style="left:{clampedLeft}px"
	data-segment-easing-popover
>
	<KeyframeEasingEditor
		{keyframe}
		{endFrame}
		{property}
		{selectedFrames}
		{onchange}
		onpreview={(_config: EasingConfig | null) => {}}
		{onclose}
	/>
</div>
