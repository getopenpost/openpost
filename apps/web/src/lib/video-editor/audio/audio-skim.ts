import type { TimelineItem, TimelineTrack, TimelineTransition } from '../project/types';
import { resolveAnimatedItemAt } from '../timeline/animated-properties';
import { hasLinkedAudioCompanion, audioCrossfadeGainAtFrame } from './transition-crossfade';
import { frameToSourceSeconds } from '../media/render-plan';
import { effectiveMediaTracks } from '../timeline/utils/track-groups';
import { decodedPreviewAudio, previewAudioContext } from './reverse-preview-audio';

const DEFAULT_TIMELINE_FPS = 30;
const DEFAULT_GRAIN_SECONDS = 0.045;

export interface LatestOnlyFrameRunner {
	schedule(frame: number): void;
	cancelPending(): void;
}

/** Keep one async seek active and retain only the newest queued frame. */
export function createLatestOnlyFrameRunner(
	run: (frame: number) => Promise<void>
): LatestOnlyFrameRunner {
	let active = false;
	let pending: number | null = null;
	const schedule = (frame: number): void => {
		if (active) {
			pending = frame;
			return;
		}
		active = true;
		void run(frame)
			.catch(() => undefined)
			.finally(() => {
				active = false;
				const next = pending;
				pending = null;
				if (next !== null) schedule(next);
			});
	};
	return {
		schedule,
		cancelPending: () => {
			pending = null;
		}
	};
}

export function audioSkimTimeSeconds(
	item: TimelineItem,
	timelineFrame: number,
	timelineFps: number,
	mediaDurationSeconds: number
): number | null {
	if ((item.type !== 'audio' && item.type !== 'video') || !item.mediaId) return null;
	if (!(mediaDurationSeconds > 0)) return null;
	const fps = timelineFps > 0 ? timelineFps : DEFAULT_TIMELINE_FPS;
	const frame = Math.max(item.from, Math.min(item.from + item.durationInFrames - 1, timelineFrame));
	return Math.max(
		0,
		Math.min(frameToSourceSeconds(item, frame, fps), Math.max(0, mediaDurationSeconds - 1e-6))
	);
}

type PlayableItem = TimelineItem & { type: 'audio' | 'video'; mediaId: string };

function isPlayableItem(item: TimelineItem): item is PlayableItem {
	return (item.type === 'audio' || item.type === 'video') && Boolean(item.mediaId);
}

export interface AudioSkimSource {
	item: PlayableItem;
	timeSeconds: number;
	gain: number;
}

export interface AudioSkimComposition {
	items: TimelineItem[];
	tracks: TimelineTrack[];
	transitions: TimelineTransition[];
	fps: number;
}

const MAX_COMPOSITION_DEPTH = 8;

function nestedFrame(
	item: TimelineItem,
	outerFrame: number,
	outerFps: number,
	innerFps: number
): number {
	const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : innerFps;
	const localSeconds = ((outerFrame - item.from) / outerFps) * (item.speed ?? 1);
	const sourceDelta = localSeconds * sourceFps;
	const sourceStart = item.sourceStart ?? 0;
	const sourceEnd = item.sourceEnd ?? sourceStart + item.durationInFrames;
	return item.isReversed
		? Math.max(sourceStart, sourceEnd - 1 - sourceDelta)
		: sourceStart + sourceDelta;
}

function itemGain(
	item: TimelineItem,
	frame: number,
	track: TimelineTrack,
	transitions: TimelineTransition[],
	items: TimelineItem[]
): number {
	const resolved = resolveAnimatedItemAt(item, frame);
	const byId = new Map(items.map((candidate) => [candidate.id, candidate]));
	return (
		Math.max(0, resolved.volume ?? 1) *
		Math.max(0, track.volume ?? 1) *
		audioCrossfadeGainAtFrame(item, frame, transitions, byId)
	);
}

/** Select one representative audible source under a timeline frame. */
export function selectAudioSkimSource(
	frame: number,
	items: TimelineItem[],
	tracks: TimelineTrack[],
	transitions: TimelineTransition[],
	timelineFps: number,
	mediaDuration: (item: TimelineItem, activeFps: number) => number,
	resolveComposition?: (compositionId: string) => AudioSkimComposition | undefined,
	depth = 0,
	parentGain = 1
): AudioSkimSource | null {
	const resolvedTracks = effectiveMediaTracks(tracks);
	const byTrack = new Map(resolvedTracks.map((track) => [track.id, track]));
	const anySolo = resolvedTracks.some((track) => track.solo);
	let leaf: { item: PlayableItem; gain: number; rank: number } | null = null;
	let nested: { item: TimelineItem; gain: number; rank: number } | null = null;

	for (const item of items) {
		if (frame < item.from || frame >= item.from + item.durationInFrames) continue;
		const track = byTrack.get(item.trackId);
		if (!track || track.muted || track.visible === false || (anySolo && !track.solo)) continue;
		const gain = parentGain * itemGain(item, frame, track, transitions, items);
		if (gain <= 0.0001) continue;
		const rank = (item.type === 'audio' ? -1000 : 0) + track.order;
		if (isPlayableItem(item)) {
			if (item.type === 'video' && hasLinkedAudioCompanion(item, items)) continue;
			if (!leaf || rank < leaf.rank) leaf = { item, gain, rank };
		} else if (
			item.compositionId &&
			resolveComposition &&
			depth < MAX_COMPOSITION_DEPTH &&
			(!nested || rank < nested.rank)
		) {
			nested = { item, gain, rank };
		}
	}

	const resolveLeaf = (candidate: NonNullable<typeof leaf>): AudioSkimSource | null => {
		const timeSeconds = audioSkimTimeSeconds(
			candidate.item,
			frame,
			timelineFps,
			mediaDuration(candidate.item, timelineFps)
		);
		return timeSeconds === null
			? null
			: { item: candidate.item, timeSeconds, gain: candidate.gain };
	};
	if (leaf && (!nested || leaf.rank <= nested.rank)) {
		const result = resolveLeaf(leaf);
		if (result) return result;
	}
	if (nested?.item.compositionId && resolveComposition) {
		const composition = resolveComposition(nested.item.compositionId);
		if (composition) {
			const result = selectAudioSkimSource(
				nestedFrame(nested.item, frame, timelineFps, composition.fps),
				composition.items,
				composition.tracks,
				composition.transitions,
				composition.fps,
				mediaDuration,
				resolveComposition,
				depth + 1,
				nested.gain
			);
			if (result) return result;
		}
	}
	return leaf ? resolveLeaf(leaf) : null;
}

export interface AudioSkimEngine {
	scrub(request: {
		url: string;
		kind: 'audio' | 'video';
		timeSeconds: number;
		gain: number;
	}): Promise<void>;
	stop(): void;
	dispose(): void;
}

/** Reuse one hidden media element to play short, bounded grains while scrubbing. */
export function createMediaElementAudioSkimEngine(
	options: {
		grainSeconds?: number;
		createAudio?: () => HTMLAudioElement;
		createVideo?: () => HTMLVideoElement;
	} = {}
): AudioSkimEngine {
	const grainSeconds = options.grainSeconds ?? DEFAULT_GRAIN_SECONDS;
	const createAudio = options.createAudio ?? (() => document.createElement('audio'));
	const createVideo = options.createVideo ?? (() => document.createElement('video'));
	let element: HTMLMediaElement | null = null;
	let kind: 'audio' | 'video' | null = null;
	let stopTimer: ReturnType<typeof setTimeout> | null = null;
	let requestId = 0;

	const stop = (): void => {
		requestId++;
		if (stopTimer) clearTimeout(stopTimer);
		stopTimer = null;
		element?.pause();
	};
	const mediaFor = (nextKind: 'audio' | 'video'): HTMLMediaElement => {
		if (element && kind === nextKind) return element;
		element?.pause();
		element = nextKind === 'video' ? createVideo() : createAudio();
		kind = nextKind;
		element.preload = 'auto';
		element.crossOrigin = 'anonymous';
		if (element instanceof HTMLVideoElement) element.playsInline = true;
		return element;
	};
	const wait = (media: HTMLMediaElement, event: 'loadedmetadata' | 'seeked', ms: number) =>
		new Promise<void>((resolve) => {
			let settled = false;
			const finish = () => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				media.removeEventListener(event, finish);
				resolve();
			};
			const timer = setTimeout(finish, ms);
			media.addEventListener(event, finish, { once: true });
		});

	return {
		async scrub(request): Promise<void> {
			const id = ++requestId;
			const media = mediaFor(request.kind);
			if (stopTimer) clearTimeout(stopTimer);
			stopTimer = null;
			media.pause();
			if (media.src !== request.url) {
				media.src = request.url;
				media.load();
			}
			if (media.readyState < HTMLMediaElement.HAVE_METADATA) {
				await wait(media, 'loadedmetadata', 250);
				if (id !== requestId) return;
			}
			const duration = Number.isFinite(media.duration) ? media.duration : Number.POSITIVE_INFINITY;
			const time = Math.max(0, Math.min(request.timeSeconds, duration - grainSeconds));
			if (Math.abs(media.currentTime - time) > 0.01) {
				media.currentTime = time;
				await wait(media, 'seeked', 50);
				if (id !== requestId) return;
			}
			media.volume = Math.min(1, Math.max(0, request.gain));
			media.muted = false;
			await media.play();
			if (id !== requestId) return media.pause();
			stopTimer = setTimeout(() => {
				if (id === requestId) media.pause();
			}, grainSeconds * 1000);
		},
		stop,
		dispose(): void {
			stop();
			element?.removeAttribute('src');
			element?.load();
			element = null;
			kind = null;
		}
	};
}

/** Decode once and play a faded Web Audio grain when element seeking is unavailable. */
export function createAudioBufferSkimEngine(
	options: {
		grainSeconds?: number;
		getContext?: () => AudioContext;
		decode?: (url: string) => Promise<AudioBuffer>;
	} = {}
): AudioSkimEngine {
	const grainSeconds = options.grainSeconds ?? DEFAULT_GRAIN_SECONDS;
	const getContext = options.getContext ?? previewAudioContext;
	const decode = options.decode ?? decodedPreviewAudio;
	let source: AudioBufferSourceNode | null = null;
	let gainNode: GainNode | null = null;
	let requestId = 0;

	const stop = (): void => {
		requestId++;
		if (!source) return;
		try {
			source.stop();
		} catch {
			// The source may already have ended.
		}
		source.disconnect();
		gainNode?.disconnect();
		source = null;
		gainNode = null;
	};

	return {
		async scrub(request): Promise<void> {
			const id = ++requestId;
			const context = getContext();
			if (context.state === 'suspended') await context.resume();
			const buffer = await decode(request.url);
			if (id !== requestId || buffer.duration <= 0) return;
			stop();
			const activeId = requestId;
			const offset = Math.max(0, Math.min(request.timeSeconds, buffer.duration - 1e-6));
			const duration = Math.min(grainSeconds, buffer.duration - offset);
			if (duration <= 0) return;
			const nextSource = context.createBufferSource();
			const gain = context.createGain();
			const now = context.currentTime;
			const edge = Math.min(0.006, duration / 2);
			const volume = Math.min(1, Math.max(0, request.gain));
			nextSource.buffer = buffer;
			nextSource.connect(gain);
			gain.connect(context.destination);
			gain.gain.setValueAtTime(0, now);
			gain.gain.linearRampToValueAtTime(volume, now + edge);
			gain.gain.setValueAtTime(volume, now + duration - edge);
			gain.gain.linearRampToValueAtTime(0, now + duration);
			nextSource.onended = () => {
				nextSource.disconnect();
				gain.disconnect();
				if (source === nextSource) {
					source = null;
					gainNode = null;
				}
			};
			source = nextSource;
			gainNode = gain;
			nextSource.start(now, offset, duration);
			if (activeId !== requestId) stop();
		},
		stop,
		dispose: stop
	};
}

/** Prefer cheap element seeks, then fall back to a cached decoded buffer. */
export function createResilientAudioSkimEngine(
	primary: AudioSkimEngine = createMediaElementAudioSkimEngine(),
	fallback: AudioSkimEngine = createAudioBufferSkimEngine()
): AudioSkimEngine {
	return {
		async scrub(request): Promise<void> {
			try {
				await primary.scrub(request);
			} catch {
				primary.stop();
				await fallback.scrub(request);
			}
		},
		stop(): void {
			primary.stop();
			fallback.stop();
		},
		dispose(): void {
			primary.dispose();
			fallback.dispose();
		}
	};
}
