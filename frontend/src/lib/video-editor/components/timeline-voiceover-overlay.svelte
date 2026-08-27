<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { voiceoverRecorder } from '$lib/video-editor/recorder/voiceover-recorder.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';

	let {
		timelineX,
		pixelsPerFrame
	}: { timelineX: (frame: number) => number; pixelsPerFrame: number } = $props();

	const visible = $derived(
		voiceoverRecorder.status === 'recording' ||
			voiceoverRecorder.status === 'paused' ||
			voiceoverRecorder.status === 'finalizing'
	);
	const left = $derived(timelineX(voiceoverRecorder.recordStartFrame));
	const width = $derived(
		Math.max(0, timelineStore.currentFrame - voiceoverRecorder.recordStartFrame) * pixelsPerFrame
	);
</script>

{#if visible}
	<div class="pointer-events-none absolute top-7 z-[25] h-10" data-voiceover-overlay>
		<div
			class="absolute top-0 h-full rounded-sm border border-red-400/75 bg-red-400/20"
			style:left={`${left}px`}
			style:width={`${width}px`}
		></div>
		<div
			class="absolute top-1 flex items-center gap-1 rounded-sm bg-red-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm"
			style:left={`${left}px`}
		>
			<span
				class="size-1.5 rounded-full bg-white {voiceoverRecorder.status === 'recording'
					? 'animate-pulse motion-reduce:animate-none'
					: ''}"
				aria-hidden="true"
			></span>
			{voiceoverRecorder.status === 'finalizing'
				? m.video_editor_voiceover_saving()
				: m.video_editor_voiceover_recording_short()}
		</div>
	</div>
{/if}
