<!-- Audio-only preview layer synchronized to the editor clock. -->
<script lang="ts">
	import { untrack } from 'svelte';
	import type { TimelineItem } from '$lib/video-editor/project/types';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { resolveAnimatedItemAt } from '$lib/video-editor/timeline/animated-properties';
	import { SeekScheduler, seekDriftExceeded } from '$lib/video-editor/preview/seek-throttle';
	import { previewPlaybackSettings } from '$lib/video-editor/preview/playback-settings.svelte';
	import {
		previewItemVolume,
		previewItemVolumeWithFade
	} from '$lib/video-editor/preview/playback-settings';
	import { audioCrossfadeGainAtFrame } from '$lib/video-editor/audio/transition-crossfade';
	import { transitionsStore } from '$lib/video-editor/timeline/actions/transitions.svelte';

	let { item, url }: { item: TimelineItem; url?: string | null } = $props();
	let audio = $state<HTMLAudioElement | null>(null);
	const resolved = $derived(resolveAnimatedItemAt(item, timelineStore.currentFrame));
	const baseVolume = $derived(
		previewItemVolume(
			resolved,
			timelineStore.tracks,
			previewPlaybackSettings.volume,
			previewPlaybackSettings.muted
		)
	);
	const crossfadeGain = $derived(
		audioCrossfadeGainAtFrame(
			resolved,
			timelineStore.currentFrame,
			transitionsStore.list,
			timelineStore.itemById
		)
	);
	const volume = $derived(previewItemVolumeWithFade(baseVolume, crossfadeGain));

	$effect(() => {
		const media = audio;
		if (!media) return;
		const scheduler = new SeekScheduler((target) => {
			media.currentTime = target;
		});
		const sync = () => {
			const frame = untrack(() => timelineStore.currentFrame);
			const speed = item.speed ?? 1;
			const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : editorSession.fps;
			const sourceTime =
				(item.sourceStart ?? 0) / sourceFps + ((frame - item.from) / editorSession.fps) * speed;
			if (seekDriftExceeded(media.currentTime, sourceTime, 0.08 / Math.max(0.1, speed))) {
				scheduler.request(sourceTime);
			}
			media.playbackRate = Math.min(16, Math.max(0.0625, speed));
			if (editorSession.clock.isPlaying && media.paused) void media.play().catch(() => undefined);
			if (!editorSession.clock.isPlaying && !media.paused) media.pause();
		};
		sync();
		const offFrame = editorSession.clock.on('framechange', sync);
		const offPlay = editorSession.clock.on('play', sync);
		const offPause = editorSession.clock.on('pause', sync);
		return () => {
			offFrame();
			offPlay();
			offPause();
			scheduler.detach();
		};
	});
</script>

{#if url}
	<!-- svelte-ignore a11y_media_has_caption -- audio-only timeline media has no visual caption -->
	<audio bind:this={audio} src={url} {volume}></audio>
{/if}
