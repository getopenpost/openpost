<!-- Leaf audio produced by a nested sequence mix plan. -->
<script lang="ts">
	import { timerToneBlob } from '../timers/audio';
	import { untrack } from 'svelte';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import {
		mixEntryPlaybackRateAtTime,
		mixEntrySourceTimeAtTime,
		type MixEntry
	} from '$lib/video-editor/media/render-plan';
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
	import { isNoiseReductionActive } from '$lib/video-editor/audio/audio-noise-reduction';
	import { prepareNoiseReducedPreviewAudio } from '$lib/video-editor/audio/audio-noise-reduction-preview';
	import { hasActiveAudioEffects } from '$lib/video-editor/audio/audio-effects';
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
	import {
		mixEntryDuckGainAtTime,
		type MixEntryDuckWindow
	} from '$lib/video-editor/audio/audio-ducking';
	import {
		getShuttleMediaPlaybackRate,
		isReverseShuttleRate
	} from '$lib/video-editor/preview/shuttle';
	import { createReverseShuttleScheduler } from '$lib/video-editor/audio/reverse-shuttle-scheduler';

	let {
		entry,
		url: mediaUrl,
		duckWindows = []
	}: {
		entry: MixEntry;
		url?: string | null;
		duckWindows?: MixEntryDuckWindow[];
	} = $props();
	let toneUrl = $state<string | null>(null);
	$effect(() => {
		if (!entry.toneFrequency) return;
		const value = URL.createObjectURL(timerToneBlob(entry.toneFrequency));
		toneUrl = value;
		return () => {
			URL.revokeObjectURL(value);
			toneUrl = null;
		};
	});
	const url = $derived(toneUrl ?? mediaUrl);
	let audio = $state<HTMLAudioElement | null>(null);
	let syncMedia = $state<(() => void) | null>(null);
	let processedNode = $state<AudioWorkletNode | null>(null);
	let processedGraph = $state.raw<PreviewClipAudioGraph | null>(null);
	let processedSampleRate = 0;
	let processedStartedAt = 0;
	let processedStartedFrame = 0;
	let processedPlaying = false;
	let processedPlaybackRate = 1;
	let processedDirection = 1;
	let detachProcessedFromMixer: (() => void) | null = null;
	let mediaGain = $state<GainNode | null>(null);
	let shuttleScheduler: ReturnType<typeof createReverseShuttleScheduler> | null = null;
	let shuttleGainNode: GainNode | null = null;
	let detachShuttle: (() => void) | null = null;
	const audioCodec = $derived(mediaPool.get(entry.mediaId)?.audioCodec);
	const unsupportedAudio = $derived(mediaPool.get(entry.mediaId)?.audioCodecSupported === false);
	const needsProcessing = $derived(
		entry.reversed ||
			(entry.playbackRateCurve?.length ?? 0) > 0 ||
			Math.abs(entry.playbackRate - 1) > 0.0001 ||
			isAudioPitchShiftActive(entry.pitchShiftSemitones) ||
			entry.audioEqStages.some(isAudioEqStageActive) ||
			hasActiveAudioEffects(entry.audioEffects) ||
			isNoiseReductionActive(entry.noiseReduction) ||
			isAc3AudioCodec(audioCodec)
	);

	// Gain/timing edits update the existing source; only processing choices rebuild it.
	const processingSignature = $derived(
		JSON.stringify({
			playbackRate: entry.playbackRate,
			pitchShiftSemitones: entry.pitchShiftSemitones,
			audioEqStages: entry.audioEqStages,
			audioEffects: entry.audioEffects,
			noiseReduction: entry.noiseReduction,
			trackId: entry.trackId
		})
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
		const duck = duckWindows.length > 0 ? mixEntryDuckGainAtTime(time, entry, duckWindows) : 1;
		return base * transition * monitor * master * duck;
	}

	$effect(() => {
		setMixerMaster(timelineStore.masterVolumeDb, timelineStore.masterMuted);
	});

	$effect(() => {
		setMixerTrackPreviewGain(entry.trackId ?? 'nested-audio', entry.mixerTrackGain);
	});

	function sourceFrameAtTimelineTime(time: number): number {
		return Math.max(0, Math.round(mixEntrySourceTimeAtTime(entry, time) * processedSampleRate));
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
		processedDirection = entry.reversed ? -1 : 1;
		processedPlaying = playing;
	}

	$effect(() => {
		if (processedGraph)
			rampPreviewClipGain(processedGraph, gainAt(timelineStore.currentFrame / editorSession.fps));
		if (shuttleGainNode)
			shuttleGainNode.gain.value = gainAt(timelineStore.currentFrame / editorSession.fps);
		if (mediaGain) {
			mediaGain.gain.value = needsProcessing
				? 0
				: gainAt(timelineStore.currentFrame / editorSession.fps);
		} else if (audio)
			audio.volume = Math.min(
				1,
				needsProcessing ? 0 : gainAt(timelineStore.currentFrame / editorSession.fps, true)
			);
	});

	$effect(() => {
		const transportRate = editorSession.playbackRate;
		const isPlaying = editorSession.isPlaying;
		const sourceUrl = url;
		if (!isPlaying || !isReverseShuttleRate(transportRate) || !sourceUrl || unsupportedAudio) {
			shuttleScheduler?.dispose();
			shuttleScheduler = null;
			if (shuttleGainNode) {
				shuttleGainNode.disconnect();
				detachShuttle?.();
				shuttleGainNode = null;
				detachShuttle = null;
			}
			return;
		}
		let stale = false;
		const abort = new AbortController();
		void processingSignature;
		const noiseSettings = untrack(() => entry.noiseReduction);
		const graph = processedGraph;
		void decodedPreviewAudio(sourceUrl, audioCodec)
			.then(async (decoded) => {
				if (stale) return;
				const buffer = await prepareNoiseReducedPreviewAudio(decoded, noiseSettings, abort.signal);
				if (stale) return;
				const context = previewAudioContext();
				let destination: AudioNode;
				if (needsProcessing && graph) {
					destination = graph.sourceInputNode;
				} else {
					const gain = context.createGain();
					gain.gain.value = gainAt(timelineStore.currentFrame / editorSession.fps);
					const detach = attachAudioSourceToMixer(gain, entry.trackId ?? 'nested-audio');
					shuttleGainNode = gain;
					detachShuttle = detach;
					destination = gain;
				}
				const scheduler = createReverseShuttleScheduler({
					context,
					buffer,
					bufferStartSeconds: 0,
					getSourceCursorSeconds: () => {
						const time = timelineStore.currentFrame / editorSession.fps;
						return mixEntrySourceTimeAtTime(entry, time);
					},
					authoredPlaybackRate: entry.playbackRate,
					authoredReversed: !!entry.reversed,
					getTransportRate: () => editorSession.playbackRate,
					getGain: () => 1,
					destination
				});
				shuttleScheduler = scheduler;
				scheduler.start();
			})
			.catch(() => undefined);
		return () => {
			stale = true;
			abort.abort();
			shuttleScheduler?.dispose();
			shuttleScheduler = null;
			if (shuttleGainNode) {
				shuttleGainNode.disconnect();
				detachShuttle?.();
				shuttleGainNode = null;
				detachShuttle = null;
			}
		};
	});

	$effect(() => {
		const sourceUrl = url;
		// SAFETY: the signature serializes only these typed MixEntry settings.
		const settings = JSON.parse(processingSignature) as Pick<
			MixEntry,
			| 'playbackRate'
			| 'pitchShiftSemitones'
			| 'audioEqStages'
			| 'audioEffects'
			| 'noiseReduction'
			| 'trackId'
		>;
		if (!sourceUrl || !needsProcessing) return;
		let stale = false;
		const context = previewAudioContext();
		const graph = createPreviewClipAudioGraph({
			eqStageCount: Math.max(1, settings.audioEqStages.length),
			effects: settings.audioEffects,
			outputNode: null
		});
		if (!graph) return;
		processedGraph = graph;
		detachProcessedFromMixer = attachAudioSourceToMixer(
			graph.outputGainNode,
			settings.trackId ?? 'nested-audio'
		);
		setPreviewClipEq(graph, settings.audioEqStages);
		const previewAbort = new AbortController();
		void Promise.all([
			ensureSoundTouchPreviewWorkletLoaded(context),
			decodedPreviewAudio(sourceUrl, audioCodec)
		])
			.then(async ([loaded, decoded]) => {
				if (!loaded || stale) return;
				const filtered = await prepareNoiseReducedPreviewAudio(
					decoded,
					settings.noiseReduction,
					previewAbort.signal
				);
				if (stale) return;
				const prepared = await prepareAudioBufferForSoundTouchPreview(filtered, context.sampleRate);
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
				node.port.postMessage({ type: 'set-tempo', tempo: settings.playbackRate });
				node.port.postMessage({
					type: 'set-pitch',
					pitch: getAudioPitchRatioFromSemitones(settings.pitchShiftSemitones)
				});
				processedNode = node;
				processedSampleRate = prepared.sampleRate;
				const time = untrack(() => timelineStore.currentFrame) / editorSession.fps;
				seekProcessed(time, editorSession.isPlaying);
				void context.resume().catch(() => undefined);
			})
			.catch((error) => {
				if (stale) return;
				processedNode?.port.postMessage({ type: 'set-playing', playing: false });
				processedNode?.disconnect();
				detachProcessedFromMixer?.();
				detachProcessedFromMixer = null;
				graph.dispose();
				processedNode = null;
				processedGraph = null;
				processedPlaying = false;
				console.warn('Processed audio preview could not be prepared.', error);
			});
		return () => {
			stale = true;
			previewAbort.abort();
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
		let source: MediaElementAudioSourceNode;
		try {
			source = previewAudioContext().createMediaElementSource(media);
		} catch {
			// The volume effect retains native playback when Web Audio is unavailable.
			return;
		}
		const gain = source.context.createGain();
		gain.gain.value = 0;
		media.volume = 1;
		source.connect(gain);
		mediaGain = gain;
		return () => {
			source.disconnect();
			gain.disconnect();
			if (mediaGain === gain) mediaGain = null;
		};
	});

	$effect(() => {
		const gain = mediaGain;
		if (gain) return attachAudioSourceToMixer(gain, entry.trackId ?? 'nested-audio');
	});

	$effect(() => {
		const media = audio;
		if (!media) return;
		const scheduler = new SeekScheduler((target) => (media.currentTime = target));
		const sync = () => {
			const time = untrack(() => timelineStore.currentFrame) / editorSession.fps;
			const transportRate = editorSession.playbackRate;
			const combinedRate = getShuttleMediaPlaybackRate(
				mixEntryPlaybackRateAtTime(entry, time),
				Math.abs(transportRate)
			);
			const shuttleRev = isReverseShuttleRate(transportRate) && editorSession.isPlaying;
			if (shuttleRev) {
				if (!media.paused) media.pause();
				// Reverse grains scheduled via decoded buffer; keep gain audible
				if (needsProcessing) {
					processedNode?.port.postMessage({ type: 'set-playing', playing: false });
					processedPlaying = false;
				}
				return;
			}
			if (needsProcessing) {
				if (!media.paused) media.pause();
				if (!processedNode || !processedGraph || processedSampleRate <= 0) return;
				const now = processedGraph.context.currentTime;
				const elapsedFrames = processedPlaying
					? (now - processedStartedAt) * processedSampleRate * processedPlaybackRate
					: 0;
				const actualFrame = processedStartedFrame + processedDirection * elapsedFrames;
				processedStartedAt = now;
				processedStartedFrame = actualFrame;
				processedPlaybackRate = combinedRate;
				processedNode.port.postMessage({ type: 'set-tempo', tempo: combinedRate });
				if (!editorSession.isPlaying) {
					seekProcessed(time, false);
					return;
				}
				const expectedFrame = sourceFrameAtTimelineTime(time);
				if (
					!processedPlaying ||
					processedDirection !== (entry.reversed ? -1 : 1) ||
					Math.abs(actualFrame - expectedFrame) > processedSampleRate * 0.08
				)
					seekProcessed(time, true);
				return;
			}
			const sourceTime = mixEntrySourceTimeAtTime(entry, time);
			if (seekDriftExceeded(media.currentTime, sourceTime, 0.08 / Math.max(0.1, combinedRate))) {
				scheduler.request(sourceTime);
			}
			media.playbackRate = combinedRate;
			if (!mediaGain) media.volume = Math.min(1, gainAt(time, true));
			if (editorSession.isPlaying && media.paused && !entry.reversed)
				void media.play().catch(() => undefined);
			if (entry.reversed && !media.paused) media.pause();
			if (!editorSession.isPlaying && !media.paused) media.pause();
		};
		syncMedia = sync;
		sync();
		const offPlay = editorSession.clock.on('play', sync);
		const offPause = editorSession.clock.on('pause', sync);
		const offRate = editorSession.clock.on('ratechange', sync);
		return () => {
			offPlay();
			offPause();
			offRate();
			scheduler.detach();
			if (syncMedia === sync) syncMedia = null;
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
