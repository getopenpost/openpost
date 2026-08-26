<!-- Leaf audio produced by a nested sequence mix plan. -->
<script lang="ts">
	import { untrack } from 'svelte';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import type { MixEntry } from '$lib/video-editor/media/render-plan';
	import { previewPlaybackSettings } from '$lib/video-editor/preview/playback-settings.svelte';
	import { clampMonitorVolume } from '$lib/video-editor/preview/playback-settings';
	import { SeekScheduler, seekDriftExceeded } from '$lib/video-editor/preview/seek-throttle';
	import { transitionGainAtProgress } from '$lib/video-editor/audio/transition-crossfade';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import {
		isAudioPitchShiftActive,
		getAudioPitchRatioFromSemitones
	} from '$lib/video-editor/audio/audio-pitch';
	import { isAudioEqStageActive } from '$lib/video-editor/audio/audio-eq';
	import {
		decodedPreviewAudio,
		previewAudioContext
	} from '$lib/video-editor/audio/reverse-preview-audio';
	import {
		createPreviewClipAudioGraph,
		rampPreviewClipGain,
		setPreviewClipEq,
		type PreviewClipAudioGraph
	} from '$lib/video-editor/audio/preview-audio-graph';
	import {
		ensureSoundTouchPreviewWorkletLoaded,
		SOUND_TOUCH_PREVIEW_PROCESSOR_NAME
	} from '$lib/video-editor/audio/soundtouch-preview-worklet';
	import { prepareAudioBufferForSoundTouchPreview } from '$lib/video-editor/audio/soundtouch-preview-buffer';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import { isAc3AudioCodec } from '$lib/video-editor/media/ac3-decoder';
	import {
		attachAudioSourceToMixer,
		setMixerMaster,
		setMixerTrackPreviewGain
	} from '$lib/video-editor/audio/audio-mixer';
	import { mixerDbToGain } from '$lib/video-editor/audio/mixer-utils';

	let { entry, url }: { entry: MixEntry; url?: string | null } = $props();
	let audio = $state<HTMLAudioElement | null>(null);
	let syncMedia = $state<(() => void) | null>(null);
	let processedNode: AudioWorkletNode | null = null;
	let processedGraph: PreviewClipAudioGraph | null = null;
	let processedSampleRate = 0;
	let processedStartedAt = 0;
	let processedStartedFrame = 0;
	let processedPlaying = false;
	let detachProcessedFromMixer: (() => void) | null = null;
	let mediaGain: GainNode | null = null;
	const audioCodec = $derived(mediaPool.get(entry.mediaId)?.audioCodec);
	const unsupportedAudio = $derived(mediaPool.get(entry.mediaId)?.audioCodecSupported === false);
	const needsProcessing = $derived(
		entry.reversed ||
			Math.abs(entry.playbackRate - 1) > 0.0001 ||
			isAudioPitchShiftActive(entry.pitchShiftSemitones) ||
			entry.audioEqStages.some(isAudioEqStageActive) ||
			isAc3AudioCodec(audioCodec)
	);

	function gainAt(time: number, includeMixerBuses = false): number {
		const points = (includeMixerBuses ? entry.gainPoints : entry.previewGainPoints).toSorted(
			(left, right) => left.whenSeconds - right.whenSeconds
		);
		let base = points[0]?.value ?? 1;
		for (let index = 1; index < points.length; index++) {
			const right = points[index]!;
			if (time > right.whenSeconds) {
				base = right.value;
				continue;
			}
			const left = points[index - 1]!;
			const duration = right.whenSeconds - left.whenSeconds;
			const progress = duration > 0 ? (time - left.whenSeconds) / duration : 1;
			base = left.value + (right.value - left.value) * Math.min(1, Math.max(0, progress));
			break;
		}
		let transition = 1;
		for (const span of entry.transitionGainSpans) {
			if (time < span.startSeconds || time > span.startSeconds + span.durationSeconds) continue;
			transition *= transitionGainAtProgress(
				(time - span.startSeconds) / span.durationSeconds,
				span.isIncoming,
				span.dipToSilence
			);
		}
		const monitor = previewPlaybackSettings.muted
			? 0
			: clampMonitorVolume(previewPlaybackSettings.volume);
		const master = includeMixerBuses
			? timelineStore.masterMuted
				? 0
				: mixerDbToGain(timelineStore.masterVolumeDb)
			: 1;
		return base * transition * monitor * master;
	}

	$effect(() => {
		setMixerMaster(timelineStore.masterVolumeDb, timelineStore.masterMuted);
	});

	$effect(() => {
		setMixerTrackPreviewGain(entry.trackId ?? 'nested-audio', entry.mixerTrackGain);
	});

	function sourceFrameAtTimelineTime(time: number): number {
		return Math.max(
			0,
			Math.round(
				(entry.sourceOffsetSeconds +
					(time - entry.whenSeconds) * entry.playbackRate * (entry.reversed ? -1 : 1)) *
					processedSampleRate
			)
		);
	}

	function seekProcessed(time: number, playing: boolean): void {
		if (!processedNode || !processedGraph || processedSampleRate <= 0) return;
		const frame = sourceFrameAtTimelineTime(time);
		processedNode.port.postMessage({
			type: 'seek',
			frame,
			direction: entry.reversed ? -1 : 1
		});
		processedNode.port.postMessage({ type: 'set-playing', playing });
		processedStartedAt = processedGraph.context.currentTime;
		processedStartedFrame = frame;
		processedPlaying = playing;
	}

	const shuttleReverseMix = $derived(
		editorSession.clock.playbackRate < 0 && editorSession.clock.isPlaying
	);

	$effect(() => {
		const muted = shuttleReverseMix;
		if (processedGraph)
			rampPreviewClipGain(
				processedGraph,
				muted ? 0 : gainAt(timelineStore.currentFrame / editorSession.fps)
			);
		if (mediaGain) {
			mediaGain.gain.value =
				muted || needsProcessing ? 0 : gainAt(timelineStore.currentFrame / editorSession.fps);
		} else if (audio)
			audio.volume = Math.min(
				1,
				muted || needsProcessing ? 0 : gainAt(timelineStore.currentFrame / editorSession.fps, true)
			);
	});

	$effect(() => {
		const sourceUrl = url;
		if (!sourceUrl || !needsProcessing) return;
		let stale = false;
		const context = previewAudioContext();
		const graph = createPreviewClipAudioGraph({
			eqStageCount: Math.max(1, entry.audioEqStages.length),
			outputNode: null
		});
		if (!graph) return;
		processedGraph = graph;
		detachProcessedFromMixer = attachAudioSourceToMixer(
			graph.outputGainNode,
			entry.trackId ?? 'nested-audio'
		);
		setPreviewClipEq(graph, entry.audioEqStages);
		void Promise.all([
			ensureSoundTouchPreviewWorkletLoaded(context),
			decodedPreviewAudio(sourceUrl, audioCodec)
		]).then(async ([loaded, decoded]) => {
			if (!loaded || stale) return;
			const prepared = await prepareAudioBufferForSoundTouchPreview(decoded, context.sampleRate);
			if (stale) return;
			const node = new AudioWorkletNode(context, SOUND_TOUCH_PREVIEW_PROCESSOR_NAME, {
				numberOfInputs: 0,
				numberOfOutputs: 1,
				outputChannelCount: [2]
			});
			node.connect(graph.sourceInputNode);
			node.port.postMessage(
				{
					type: 'append-source',
					startFrame: 0,
					leftChannel: prepared.leftChannel.buffer,
					rightChannel: prepared.rightChannel.buffer,
					frameCount: prepared.frameCount,
					sampleRate: prepared.sampleRate
				},
				[prepared.leftChannel.buffer, prepared.rightChannel.buffer]
			);
			node.port.postMessage({ type: 'set-tempo', tempo: entry.playbackRate });
			node.port.postMessage({
				type: 'set-pitch',
				pitch: getAudioPitchRatioFromSemitones(entry.pitchShiftSemitones)
			});
			processedNode = node;
			processedSampleRate = prepared.sampleRate;
			const time = untrack(() => timelineStore.currentFrame) / editorSession.fps;
			seekProcessed(time, editorSession.clock.isPlaying);
			void context.resume().catch(() => undefined);
		});
		return () => {
			stale = true;
			processedNode?.port.postMessage({ type: 'set-playing', playing: false });
			processedNode?.disconnect();
			detachProcessedFromMixer?.();
			detachProcessedFromMixer = null;
			graph.dispose();
			processedNode = null;
			processedGraph = null;
			processedPlaying = false;
		};
	});

	$effect(() => {
		const media = audio;
		if (!media) return;
		let sourceNode: MediaElementAudioSourceNode | null = null;
		let gainNode: GainNode | null = null;
		let detachFromMixer: (() => void) | null = null;
		try {
			const context = previewAudioContext();
			sourceNode = context.createMediaElementSource(media);
			gainNode = context.createGain();
			gainNode.gain.value = needsProcessing
				? 0
				: gainAt(timelineStore.currentFrame / editorSession.fps);
			media.volume = 1;
			sourceNode.connect(gainNode);
			detachFromMixer = attachAudioSourceToMixer(gainNode, entry.trackId ?? 'nested-audio');
			mediaGain = gainNode;
		} catch {
			media.volume = Math.min(1, needsProcessing ? 0 : gainAt(0, true));
		}
		const scheduler = new SeekScheduler((target) => (media.currentTime = target));
		const sync = () => {
			const time = untrack(() => timelineStore.currentFrame) / editorSession.fps;
			const shuttleRev = editorSession.clock.playbackRate < 0 && editorSession.clock.isPlaying;
			if (shuttleRev) {
				if (!media.paused) media.pause();
				processedNode?.port.postMessage({ type: 'set-playing', playing: false });
				return;
			}
			if (needsProcessing) {
				if (!media.paused) media.pause();
				if (!processedNode || !processedGraph || processedSampleRate <= 0) return;
				if (!editorSession.clock.isPlaying) {
					seekProcessed(time, false);
					return;
				}
				const expectedFrame = sourceFrameAtTimelineTime(time);
				const elapsedFrames =
					(processedGraph.context.currentTime - processedStartedAt) *
					processedSampleRate *
					entry.playbackRate;
				const actualFrame =
					processedStartedFrame + (entry.reversed ? -elapsedFrames : elapsedFrames);
				if (!processedPlaying || Math.abs(actualFrame - expectedFrame) > processedSampleRate * 0.08)
					seekProcessed(time, true);
				return;
			}
			const sourceTime =
				entry.sourceOffsetSeconds +
				(time - entry.whenSeconds) * entry.playbackRate * (entry.reversed ? -1 : 1);
			if (seekDriftExceeded(media.currentTime, sourceTime, 0.08 / entry.playbackRate)) {
				scheduler.request(sourceTime);
			}
			media.playbackRate = Math.min(16, Math.max(0.0625, entry.playbackRate));
			if (!gainNode) media.volume = Math.min(1, gainAt(time, true));
			if (editorSession.clock.isPlaying && media.paused && !entry.reversed)
				void media.play().catch(() => undefined);
			if (entry.reversed && !media.paused) media.pause();
			if (!editorSession.clock.isPlaying && !media.paused) media.pause();
		};
		syncMedia = sync;
		sync();
		const offPlay = editorSession.clock.on('play', sync);
		const offPause = editorSession.clock.on('pause', sync);
		return () => {
			offPlay();
			offPause();
			scheduler.detach();
			if (syncMedia === sync) syncMedia = null;
			detachFromMixer?.();
			sourceNode?.disconnect();
			gainNode?.disconnect();
			if (mediaGain === gainNode) mediaGain = null;
		};
	});

	$effect(() => {
		const frame = timelineStore.currentFrame;
		const sync = syncMedia;
		if (frame >= 0) sync?.();
	});
</script>

{#if url && !unsupportedAudio}
	<!-- svelte-ignore a11y_media_has_caption -- nested sequence audio has no visual caption -->
	<audio bind:this={audio} src={url}></audio>
{/if}
