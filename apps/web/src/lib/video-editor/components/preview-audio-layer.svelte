<!-- Audio-bearing preview layer synchronized to the editor clock. -->
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
		previewItemSourceVolume,
		previewTrackGain,
		previewItemVolumeWithFade
	} from '$lib/video-editor/preview/playback-settings';
	import { audioCrossfadeGainAtFrame } from '$lib/video-editor/audio/transition-crossfade';
	import { transitionsStore } from '$lib/video-editor/timeline/actions/transitions.svelte';
	import { frameToSourceSeconds } from '$lib/video-editor/media/render-plan';
	import {
		playbackRateAtTimelineOffset,
		timelineOffsetToSourceFrame
	} from '$lib/video-editor/timeline/source-time-map';
	import { audioClipFadeGainAtFrame } from '$lib/video-editor/media/clip-fades';
	import {
		decodedPreviewAudio,
		previewAudioContext,
		reversedPreviewAudio
	} from '$lib/video-editor/audio/reverse-preview-audio';
	import {
		previewAudioEqStagesForTimeline,
		requiresProcessedPreviewAudioForTimeline
	} from '$lib/video-editor/audio/preview-processing';
	import { resolveNoiseReductionSettings } from '$lib/video-editor/audio/audio-noise-reduction';
	import { prepareNoiseReducedPreviewAudio } from '$lib/video-editor/audio/audio-noise-reduction-preview';
	import {
		createPreviewClipAudioGraph,
		rampPreviewClipGain,
		setPreviewClipEq,
		setPreviewAudioEffects,
		type PreviewClipAudioGraph
	} from '$lib/video-editor/audio/preview-audio-graph';
	import { getAudioEffects } from '$lib/video-editor/audio/audio-effects';
	import type { AudioEffect } from '$lib/video-editor/audio/audio-effects';
	import {
		getAudioPitchRatioFromSemitones,
		getAudioPitchShiftSemitones
	} from '$lib/video-editor/audio/audio-pitch';
	import {
		ensureSoundTouchPreviewWorkletLoaded,
		SOUND_TOUCH_PREVIEW_PROCESSOR_NAME
	} from '$lib/video-editor/audio/soundtouch-preview-worklet';
	import { prepareAudioBufferForSoundTouchPreview } from '$lib/video-editor/audio/soundtouch-preview-buffer';
	import type { ResolvedAudioEqSettings } from '$lib/video-editor/audio/types';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import { isAc3AudioCodec } from '$lib/video-editor/media/ac3-decoder';
	import {
		getShuttleMediaPlaybackRate,
		isReverseShuttleRate
	} from '$lib/video-editor/preview/shuttle';
	import { createReverseShuttleScheduler } from '$lib/video-editor/audio/reverse-shuttle-scheduler';
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

	let {
		item,
		url,
		duckWindows = []
	}: {
		item: TimelineItem;
		url?: string | null;
		duckWindows?: MixEntryDuckWindow[];
	} = $props();
	let audio = $state<HTMLAudioElement | null>(null);
	let reverseBuffer = $state<AudioBuffer | null>(null);
	let reverseSource: AudioBufferSourceNode | null = null;
	let reverseGain: GainNode | null = null;
	let detachReverseFromMixer: (() => void) | null = null;
	let reverseStartedAt = 0;
	let reverseStartedOffset = 0;
	let reversePlaybackRate = 1;
	let processedNode = $state<AudioWorkletNode | null>(null);
	let processedGraph = $state.raw<PreviewClipAudioGraph | null>(null);
	let processedSampleRate = 0;
	let processedStartedAt = 0;
	let processedStartedFrame = 0;
	let processedDirection: -1 | 1 = 1;
	let processedPlaying = false;
	let processedPlaybackRate = 1;
	let detachProcessedFromMixer: (() => void) | null = null;
	let mediaGain = $state<GainNode | null>(null);
	let shuttleScheduler: ReturnType<typeof createReverseShuttleScheduler> | null = null;
	let shuttleGainNode: GainNode | null = null;
	let detachShuttle: (() => void) | null = null;

	const resolved = $derived(resolveAnimatedItemAt(item, timelineStore.currentFrame));
	const audioCodec = $derived(item.mediaId ? mediaPool.get(item.mediaId)?.audioCodec : undefined);
	const unsupportedAudio = $derived(
		item.mediaId ? mediaPool.get(item.mediaId)?.audioCodecSupported === false : false
	);
	const needsProcessing = $derived(
		requiresProcessedPreviewAudioForTimeline(
			item,
			timelineStore.tracks,
			timelineStore.busAudioEq
		) || isAc3AudioCodec(audioCodec)
	);
	const audioEffectsForPreview = $derived(getAudioEffects(item));
	const noiseReductionSettings = $derived(resolveNoiseReductionSettings(item));
	const processingSignature = $derived(
		JSON.stringify({
			speed: item.speed ?? 1,
			speedRamp: item.speedRamp,
			pitch: getAudioPitchShiftSemitones(item),
			eqStages: previewAudioEqStagesForTimeline(
				item,
				timelineStore.tracks,
				timelineStore.busAudioEq
			),
			effects: audioEffectsForPreview,
			noiseReduction: noiseReductionSettings
		})
	);
	const baseVolume = $derived(
		previewItemSourceVolume(resolved, previewPlaybackSettings.volume, previewPlaybackSettings.muted)
	);
	const trackGain = $derived(previewTrackGain(item.trackId, timelineStore.tracks));
	const fallbackVolume = $derived(
		previewItemVolume(
			resolved,
			timelineStore.tracks,
			previewPlaybackSettings.volume,
			previewPlaybackSettings.muted
		) * (timelineStore.masterMuted ? 0 : mixerDbToGain(timelineStore.masterVolumeDb))
	);
	const crossfadeGain = $derived(
		audioCrossfadeGainAtFrame(
			resolved,
			timelineStore.currentFrame,
			transitionsStore.list,
			timelineStore.itemById
		)
	);
	const clipFadeGain = $derived(
		audioClipFadeGainAtFrame(resolved, timelineStore.currentFrame, timelineStore.fps)
	);
	const duckGain = $derived.by(() => {
		if (item.type !== 'video' && item.type !== 'audio') return 1;
		if (!duckWindows || duckWindows.length === 0) return 1;
		const timeSeconds = timelineStore.currentFrame / editorSession.fps;
		return mixEntryDuckGainAtTime(
			timeSeconds,
			{ itemId: item.id, trackId: item.trackId },
			duckWindows
		);
	});
	const volume = $derived(
		previewItemVolumeWithFade(baseVolume, crossfadeGain, clipFadeGain) * duckGain
	);
	const fallbackDuckGain = $derived(duckGain);
	// fallbackVolume already includes track/master gain, so apply duck separately
	const duckedFallbackVolume = $derived(fallbackVolume * fallbackDuckGain);

	function stopReverseSource(): void {
		if (!reverseSource) return;
		reverseSource.onended = null;
		try {
			reverseSource.stop();
		} catch {
			// A source can finish between the guard and stop call.
		}
		reverseSource.disconnect();
		detachReverseFromMixer?.();
		detachReverseFromMixer = null;
		reverseGain?.disconnect();
		reverseSource = null;
		reverseGain = null;
	}

	function startReverseSource(offsetSeconds: number, speed: number): void {
		const buffer = reverseBuffer;
		if (!buffer || offsetSeconds >= buffer.duration) {
			stopReverseSource();
			return;
		}
		stopReverseSource();
		const context = previewAudioContext();
		const source = context.createBufferSource();
		const gain = context.createGain();
		source.buffer = buffer;
		source.playbackRate.value = speed;
		gain.gain.value = volume;
		source.connect(gain);
		const detach = attachAudioSourceToMixer(gain, item.trackId);
		detachReverseFromMixer = detach;
		source.onended = () => {
			if (reverseSource !== source) return;
			source.disconnect();
			gain.disconnect();
			detach();
			if (detachReverseFromMixer === detach) detachReverseFromMixer = null;
			reverseSource = null;
			reverseGain = null;
		};
		reverseSource = source;
		reverseGain = gain;
		reverseStartedOffset = offsetSeconds;
		reverseStartedAt = context.currentTime;
		reversePlaybackRate = speed;
		void context
			.resume()
			.then(() => {
				if (reverseSource !== source) return;
				reverseStartedAt = context.currentTime;
				source.start(0, offsetSeconds);
			})
			.catch(() => {
				if (reverseSource === source) stopReverseSource();
			});
	}

	function seekProcessed(frame: number, playing: boolean): void {
		const node = processedNode;
		const graph = processedGraph;
		if (!node || !graph || processedSampleRate <= 0) return;
		const sourceFrame = Math.max(
			0,
			Math.round(frameToSourceSeconds(item, frame, editorSession.fps) * processedSampleRate)
		);
		const direction: -1 | 1 = item.isReversed ? -1 : 1;
		node.port.postMessage({ type: 'seek', frame: sourceFrame, direction });
		node.port.postMessage({ type: 'set-playing', playing });
		processedStartedAt = graph.context.currentTime;
		processedStartedFrame = sourceFrame;
		processedDirection = direction;
		processedPlaying = playing;
	}

	$effect(() => {
		if (reverseGain) reverseGain.gain.value = volume;
		if (processedGraph) rampPreviewClipGain(processedGraph, volume);
		if (shuttleGainNode) shuttleGainNode.gain.value = volume;
		if (mediaGain) mediaGain.gain.value = needsProcessing ? 0 : volume;
		else if (audio) audio.volume = Math.min(1, needsProcessing ? 0 : duckedFallbackVolume);
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
		const noiseSettings = untrack(() => noiseReductionSettings);
		const graph = processedGraph;
		// Stop authored-reverse and processed forward paths before starting shuttle grains
		stopReverseSource();
		processedNode?.port.postMessage({ type: 'set-playing', playing: false });
		processedPlaying = false;
		if (mediaGain) mediaGain.gain.value = 0;
		else if (audio && !audio.paused) audio.pause();
		void decodedPreviewAudio(sourceUrl, audioCodec)
			.then(async (decoded) => {
				if (stale) return;
				const buffer = await prepareNoiseReducedPreviewAudio(decoded, noiseSettings, abort.signal);
				if (stale) return;
				const context = previewAudioContext();
				// Route through clip graph when processing is required to preserve EQ
				// Pitch is intentionally bypassed for reverse grains (unity playbackRate)
				let destination: AudioNode;
				if (needsProcessing && graph) {
					destination = graph.sourceInputNode;
				} else {
					const gain = context.createGain();
					gain.gain.value = volume;
					const detach = attachAudioSourceToMixer(gain, item.trackId);
					shuttleGainNode = gain;
					detachShuttle = detach;
					destination = gain;
				}
				const scheduler = createReverseShuttleScheduler({
					context,
					buffer,
					bufferStartSeconds: 0,
					getSourceTimeAtOffset: (offset) =>
						timelineOffsetToSourceFrame(
							item,
							timelineStore.currentFrame -
								item.from +
								offset * editorSession.playbackRate * editorSession.fps,
							editorSession.fps
						) / (item.sourceFps && item.sourceFps > 0 ? item.sourceFps : editorSession.fps),
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
		setMixerMaster(timelineStore.masterVolumeDb, timelineStore.masterMuted);
	});

	$effect(() => {
		setMixerTrackPreviewGain(item.trackId, trackGain);
	});

	$effect(() => {
		const sourceUrl = url;
		if (!item.isReversed || !sourceUrl || needsProcessing) {
			reverseBuffer = null;
			stopReverseSource();
			return;
		}
		const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : editorSession.fps;
		const startSeconds = (item.sourceStart ?? 0) / sourceFps;
		const endSeconds =
			(item.sourceEnd ??
				(item.sourceStart ?? 0) +
					(item.durationInFrames / editorSession.fps) * (item.speed ?? 1) * sourceFps) / sourceFps;
		let stale = false;
		reverseBuffer = null;
		void reversedPreviewAudio(sourceUrl, startSeconds, endSeconds, audioCodec)
			.then((buffer) => {
				if (!stale) reverseBuffer = buffer;
			})
			.catch((error) => {
				if (stale) return;
				reverseBuffer = null;
				stopReverseSource();
				console.warn('Reversed audio preview could not be decoded.', error);
			});
		return () => {
			stale = true;
			stopReverseSource();
		};
	});

	$effect(() => {
		const sourceUrl = url;
		const shouldProcess = needsProcessing;
		// SAFETY: processingSignature is produced locally from this typed object.
		const settings = JSON.parse(processingSignature) as {
			speed: number;
			pitch: number;
			eqStages: ResolvedAudioEqSettings[];
			effects: AudioEffect[];
			noiseReduction: import('$lib/video-editor/audio/audio-noise-reduction').ResolvedAudioNoiseReductionSettings;
		};
		if (!sourceUrl || !shouldProcess) {
			processedNode?.port.postMessage({ type: 'set-playing', playing: false });
			processedNode?.disconnect();
			processedGraph?.dispose();
			detachProcessedFromMixer?.();
			detachProcessedFromMixer = null;
			processedNode = null;
			processedGraph = null;
			processedPlaying = false;
			return;
		}
		let stale = false;
		const context = previewAudioContext();
		const graph = createPreviewClipAudioGraph({
			eqStageCount: Math.max(1, settings.eqStages.length),
			effects: settings.effects,
			outputNode: null
		});
		if (!graph) return;
		processedGraph = graph;
		detachProcessedFromMixer = attachAudioSourceToMixer(graph.outputGainNode, item.trackId);
		setPreviewClipEq(graph, settings.eqStages);
		setPreviewAudioEffects(graph, settings.effects);
		rampPreviewClipGain(
			graph,
			untrack(() => volume),
			context.currentTime,
			0
		);
		const previewAbort = new AbortController();
		void Promise.all([
			ensureSoundTouchPreviewWorkletLoaded(context),
			decodedPreviewAudio(sourceUrl, audioCodec)
		])
			.then(async ([loaded, decoded]) => {
				if (!loaded || stale || previewAbort.signal.aborted) return;
				const bufferForPreview = await prepareNoiseReducedPreviewAudio(
					decoded,
					settings.noiseReduction,
					previewAbort.signal
				);
				if (stale) return;
				const prepared = await prepareAudioBufferForSoundTouchPreview(
					bufferForPreview,
					context.sampleRate
				);
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
				node.port.postMessage({ type: 'set-tempo', tempo: settings.speed });
				node.port.postMessage({
					type: 'set-pitch',
					pitch: getAudioPitchRatioFromSemitones(settings.pitch)
				});
				if (stale) {
					node.disconnect();
					return;
				}
				processedNode = node;
				processedSampleRate = prepared.sampleRate;
				seekProcessed(
					untrack(() => timelineStore.currentFrame),
					editorSession.isPlaying
				);
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
			if (processedGraph === graph) processedGraph = null;
			processedNode = null;
			processedPlaying = false;
		};
	});

	$effect(() => {
		void audioEffectsForPreview;
		if (processedGraph) setPreviewAudioEffects(processedGraph, audioEffectsForPreview);
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
		if (gain) return attachAudioSourceToMixer(gain, item.trackId);
	});

	$effect(() => {
		const media = audio;
		if (!media) return;
		const scheduler = new SeekScheduler((target) => {
			media.currentTime = target;
		});
		const sync = () => {
			const frame = untrack(() => timelineStore.currentFrame);
			const speed = playbackRateAtTimelineOffset(item, frame - item.from, editorSession.fps);
			const transportRate = editorSession.playbackRate;
			const combinedRate = getShuttleMediaPlaybackRate(speed, Math.abs(transportRate));
			const shuttleRev = isReverseShuttleRate(transportRate) && editorSession.isPlaying;
			if (shuttleRev) {
				if (!media.paused) media.pause();
				stopReverseSource();
				if (needsProcessing) {
					processedNode?.port.postMessage({
						type: 'set-playing',
						playing: false
					});
					processedPlaying = false;
				}
				return;
			}
			if (needsProcessing) {
				if (!media.paused) media.pause();
				const graph = processedGraph;
				if (!graph || !processedNode || processedSampleRate <= 0) return;
				const playing = editorSession.isPlaying;
				const now = graph.context.currentTime;
				const elapsedFrames = processedPlaying
					? (now - processedStartedAt) * processedSampleRate * processedPlaybackRate
					: 0;
				const actualFrame =
					processedStartedFrame + (processedDirection < 0 ? -elapsedFrames : elapsedFrames);
				processedStartedAt = now;
				processedStartedFrame = actualFrame;
				processedPlaybackRate = combinedRate;
				processedNode.port.postMessage({
					type: 'set-tempo',
					tempo: combinedRate
				});
				if (!playing) {
					seekProcessed(frame, false);
					return;
				}
				const expectedFrame =
					frameToSourceSeconds(item, frame, editorSession.fps) * processedSampleRate;
				if (
					!processedPlaying ||
					processedDirection !== (item.isReversed ? -1 : 1) ||
					Math.abs(actualFrame - expectedFrame) > processedSampleRate * 0.08
				) {
					seekProcessed(frame, true);
				}
				return;
			}
			if (item.isReversed) {
				if (!media.paused) media.pause();
				if (!editorSession.isPlaying) {
					stopReverseSource();
					return;
				}
				const expectedOffset = Math.max(0, ((frame - item.from) / editorSession.fps) * speed);
				const context = previewAudioContext();
				const now = context.currentTime;
				const actualOffset = reverseSource
					? reverseStartedOffset + (now - reverseStartedAt) * reversePlaybackRate
					: Number.POSITIVE_INFINITY;
				if (Math.abs(actualOffset - expectedOffset) > 0.08) {
					startReverseSource(expectedOffset, combinedRate);
				} else if (reverseSource) {
					reverseStartedOffset = actualOffset;
					reverseStartedAt = now;
					reversePlaybackRate = combinedRate;
					reverseSource.playbackRate.value = combinedRate;
				}
				return;
			}
			const sourceTime = frameToSourceSeconds(item, frame, editorSession.fps);
			const driftThreshold = 0.08 / Math.max(0.1, combinedRate);
			if (seekDriftExceeded(media.currentTime, sourceTime, driftThreshold)) {
				scheduler.request(sourceTime);
			}
			media.playbackRate = combinedRate;
			if (editorSession.isPlaying && media.paused && !shuttleRev)
				void media.play().catch(() => undefined);
			if (!editorSession.isPlaying && !media.paused) media.pause();
		};
		sync();
		const offFrame = editorSession.clock.on('framechange', sync);
		const offPlay = editorSession.clock.on('play', sync);
		const offPause = editorSession.clock.on('pause', sync);
		const offRate = editorSession.clock.on('ratechange', sync);
		return () => {
			offFrame();
			offPlay();
			offPause();
			offRate();
			scheduler.detach();
		};
	});
</script>

{#if url && !unsupportedAudio}
	<!-- svelte-ignore a11y_media_has_caption -- timeline audio has no visual caption -->
	<audio bind:this={audio} src={url}></audio>
{/if}
