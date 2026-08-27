/* oxlint-disable anti-slop/no-conditional-empty-object-spread, anti-slop/require-safety-comment-for-type-assertion */
import type { MixEntry } from '../media/render-plan';
import { collectMixEntryDuckWindows, type MixEntryDuckWindow } from './audio-ducking';
import { mediaPool } from '../media/pool.svelte';
import { resolveMediaBlob } from '../media/resolve-media-blob';
import { ensureAc3DecoderForCodec } from '../media/ac3-decoder';
import { StreamingAudioEq } from './audio-eq';
import { StreamingAudioEffectChain } from './audio-effects';
import { StreamingTimeStretch } from './process-audio';
import { AbsolutePhaseResampler, downmixToOutputChannels } from './sample-rate-converter';
import { transitionGainAtProgress } from './transition-crossfade';
import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny';

export const MIX_SAMPLE_RATE = 48_000;
export const MIX_CHANNELS = 2;
export const MIX_WINDOW_SECONDS = 5;
export const MIX_WINDOW_SAMPLES = MIX_WINDOW_SECONDS * MIX_SAMPLE_RATE;

const SOURCE_WINDOW_SECONDS = 5;
const SOURCE_GUARD_SECONDS = 0;
const ACTIVE_EPSILON = 0.0001;

export class CompiledTargetDuck {
	private readonly sorted: MixEntryDuckWindow[];
	private active: MixEntryDuckWindow[] = [];
	private nextIndex = 0;
	private evaluations = 0;

	constructor(
		windows: MixEntryDuckWindow[],
		target: { itemId: string; trackId?: string; trackAliases?: string[] }
	) {
		const targetAliases = target.trackAliases ?? (target.trackId ? [target.trackId] : []);
		this.sorted = windows
			.filter((w) => {
				if (w.itemId === target.itemId) return false;
				if (!w.targetTrackIds) return true;
				const direct = w.targetTrackIds.includes(target.trackId ?? '');
				const aliasMatch = targetAliases.some((alias) => w.targetTrackIds!.includes(alias));
				return direct || aliasMatch;
			})
			.toSorted((a, b) => a.startSeconds - b.startSeconds);
	}

	gainAt(timeSeconds: number): number {
		while (
			this.nextIndex < this.sorted.length &&
			this.sorted[this.nextIndex]!.startSeconds <= timeSeconds
		) {
			this.active.push(this.sorted[this.nextIndex]!);
			this.nextIndex++;
		}
		let write = 0;
		for (let read = 0; read < this.active.length; read++) {
			const w = this.active[read]!;
			if (timeSeconds <= w.endSeconds + w.releaseSeconds) {
				this.active[write++] = w;
			}
		}
		this.active.length = write;
		let deepest = 0;
		for (const w of this.active) {
			this.evaluations++;
			let db = 0;
			if (timeSeconds < w.startSeconds) db = 0;
			else if (w.attackSeconds > 0 && timeSeconds < w.startSeconds + w.attackSeconds) {
				db = w.duckDb * ((timeSeconds - w.startSeconds) / w.attackSeconds);
			} else if (timeSeconds <= w.endSeconds) db = w.duckDb;
			else if (w.releaseSeconds > 0 && timeSeconds <= w.endSeconds + w.releaseSeconds)
				db = w.duckDb * (1 - (timeSeconds - w.endSeconds) / w.releaseSeconds);
			if (db < deepest) deepest = db;
		}
		return deepest === 0 ? 1 : Math.pow(10, deepest / 20);
	}

	get evaluationCount(): number {
		return this.evaluations;
	}
}

export interface AudioMixDiagnostics {
	onOutputWindow?: (frames: number) => void;
	onSourceWindow?: (frames: number) => void;
	onAutomationPrepared?: (gainPoints: number, transitionSpans: number) => void;
}

interface DecodedAudioChunk {
	channels: Float32Array[];
	sampleRate: number;
}

interface AudioChunk {
	channels: Float32Array[];
	frameOffset: number;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError';
}

async function decodeSourceSlice(
	blob: Blob,
	startSeconds: number,
	endSeconds: number,
	signal?: AbortSignal
): Promise<DecodedAudioChunk> {
	throwIfAborted(signal);
	const input = new Input({
		source: new BlobSource(blob),
		formats: ALL_FORMATS
	});
	let sink: AudioSampleSink | null = null;
	try {
		const track = await input.getPrimaryAudioTrack();
		if (!track) throw new Error('The clip has no audio track.');
		await ensureAc3DecoderForCodec(track.codec);
		sink = new AudioSampleSink(track);
		const start = Math.max(0, startSeconds);
		const end = Math.max(start, endSeconds);
		let sampleRate = track.sampleRate || MIX_SAMPLE_RATE;
		let channelCount = 0;
		let totalFrames = 0;
		const chunks: Float32Array[][] = [];
		for await (const sample of sink.samples(start, end)) {
			try {
				throwIfAborted(signal);
				if (chunks.length > 0 && sample.sampleRate !== sampleRate) {
					throw new Error('The audio sample rate changed while decoding.');
				}
				sampleRate = sample.sampleRate || sampleRate;
				const nextChannelCount = Math.max(1, sample.numberOfChannels);
				if (channelCount > 0 && nextChannelCount !== channelCount) {
					throw new Error('The audio channel layout changed while decoding.');
				}
				channelCount = nextChannelCount;
				const overlapStart = Math.max(start, sample.timestamp);
				const overlapEnd = Math.min(end, sample.timestamp + sample.duration);
				const frameOffset = Math.max(
					0,
					Math.min(
						sample.numberOfFrames,
						Math.ceil((overlapStart - sample.timestamp) * sampleRate - 1e-7)
					)
				);
				const frameEnd = Math.max(
					frameOffset,
					Math.min(
						sample.numberOfFrames,
						Math.ceil((overlapEnd - sample.timestamp) * sampleRate - 1e-7)
					)
				);
				const frames = frameEnd - frameOffset;
				if (frames === 0) continue;
				const planes = Array.from({ length: channelCount }, (_, channel) => {
					const plane = new Float32Array(frames);
					sample.copyTo(plane, {
						format: 'f32-planar',
						planeIndex: channel,
						frameOffset,
						frameCount: frames
					});
					return plane;
				});
				chunks.push(planes);
				totalFrames += frames;
			} finally {
				sample.close();
			}
		}
		if (totalFrames === 0) return { channels: [], sampleRate };
		const channels = Array.from({ length: channelCount }, () => new Float32Array(totalFrames));
		let writeOffset = 0;
		for (const planes of chunks) {
			for (let channel = 0; channel < channelCount; channel++) {
				channels[channel]!.set(planes[channel]!, writeOffset);
			}
			writeOffset += planes[0]!.length;
		}
		return { channels, sampleRate };
	} finally {
		try {
			sink?.close?.();
		} catch {
			// The decoder may already have closed its sink after an abort or decode failure.
		}
		input.dispose?.();
	}
}

function reverseChannels(channels: Float32Array[]): Float32Array[] {
	return channels.map((channel) => {
		const reversed = new Float32Array(channel.length);
		for (let index = 0; index < channel.length; index++) {
			reversed[index] = channel[channel.length - index - 1] ?? 0;
		}
		return reversed;
	});
}

class EntryAutomation {
	private readonly gainPoints: { sample: number; value: number }[];
	private readonly spans: {
		startSample: number;
		endSample: number;
		isIncoming: boolean;
		dipToSilence: boolean;
	}[];
	private gainIndex = 0;
	private spanIndex = 0;

	constructor(entry: MixEntry, diagnostics?: AudioMixDiagnostics) {
		this.gainPoints = entry.gainPoints
			.map((point) => ({
				sample: Math.round(point.whenSeconds * MIX_SAMPLE_RATE),
				value: Math.max(0, point.value)
			}))
			.sort((left, right) => left.sample - right.sample);
		this.spans = entry.transitionGainSpans
			.filter((span) => span.durationSeconds > 0)
			.map((span) => ({
				startSample: Math.round(span.startSeconds * MIX_SAMPLE_RATE),
				endSample: Math.round((span.startSeconds + span.durationSeconds) * MIX_SAMPLE_RATE),
				isIncoming: span.isIncoming,
				dipToSilence: span.dipToSilence
			}))
			.sort((left, right) => left.startSample - right.startSample);
		diagnostics?.onAutomationPrepared?.(this.gainPoints.length, this.spans.length);
	}

	gainAt(sample: number): number {
		let gain = 1;
		if (this.gainPoints.length > 0) {
			while (
				this.gainIndex + 1 < this.gainPoints.length &&
				this.gainPoints[this.gainIndex + 1]!.sample <= sample
			) {
				this.gainIndex++;
			}
			const left = this.gainPoints[this.gainIndex]!;
			const right = this.gainPoints[this.gainIndex + 1];
			if (sample <= this.gainPoints[0]!.sample) gain = this.gainPoints[0]!.value;
			else if (!right) gain = left.value;
			else {
				const duration = right.sample - left.sample;
				gain =
					duration <= 0
						? right.value
						: left.value + ((right.value - left.value) * (sample - left.sample)) / duration;
			}
		}
		while (this.spanIndex < this.spans.length && this.spans[this.spanIndex]!.endSample <= sample) {
			this.spanIndex++;
		}
		for (let index = this.spanIndex; index < this.spans.length; index++) {
			const span = this.spans[index]!;
			if (span.startSample > sample) break;
			if (sample >= span.endSample) continue;
			const duration = span.endSample - span.startSample;
			const progress = duration <= 1 ? 1 : (sample - span.startSample) / (duration - 1);
			gain *= transitionGainAtProgress(progress, span.isIncoming, span.dipToSilence);
			if (gain === 0) return 0;
		}
		return Math.max(0, gain);
	}
}

async function* streamEntryAudio(
	entry: MixEntry,
	signal?: AbortSignal,
	diagnostics?: AudioMixDiagnostics
): AsyncGenerator<Float32Array[]> {
	const media = mediaPool.get(entry.mediaId);
	if (!media) throw new Error("A timeline clip's media is unavailable.");
	let blob: Blob;
	try {
		blob = await resolveMediaBlob(media);
	} catch (error) {
		if (isAbortError(error)) throw error;
		throw new Error("A timeline clip's media could not be opened.", {
			cause: error
		});
	}

	const targetFrames = Math.max(0, Math.ceil(entry.durationSeconds * MIX_SAMPLE_RATE));
	const sourceDuration = entry.durationSeconds * entry.playbackRate + SOURCE_GUARD_SECONDS;
	const sourceStart = entry.reversed
		? Math.max(0, entry.sourceOffsetSeconds - sourceDuration)
		: Math.max(0, entry.sourceOffsetSeconds);
	const sourceEnd = entry.reversed
		? Math.max(0, entry.sourceOffsetSeconds)
		: sourceStart + sourceDuration;
	let cursor = entry.reversed ? sourceEnd : sourceStart;
	let sampleRate = 0;
	let channelCount = 0;
	let timeStretch: StreamingTimeStretch | null = null;
	let eq: StreamingAudioEq | null = null;
	let effectChain: StreamingAudioEffectChain | null = null;
	let resamplers: AbsolutePhaseResampler[] | null = null;
	let emittedFrames = 0;
	const sourceWindowSeconds = SOURCE_WINDOW_SECONDS * Math.min(1, entry.playbackRate);

	while (emittedFrames < targetFrames) {
		throwIfAborted(signal);
		const chunkStart = entry.reversed
			? Math.max(sourceStart, cursor - sourceWindowSeconds)
			: cursor;
		const chunkEnd = entry.reversed ? cursor : Math.min(sourceEnd, cursor + sourceWindowSeconds);
		if (chunkEnd <= chunkStart) break;
		let decoded: DecodedAudioChunk;
		try {
			decoded = await decodeSourceSlice(blob, chunkStart, chunkEnd, signal);
		} catch (error) {
			if (isAbortError(error)) throw error;
			throw new Error('A timeline clip could not be decoded.', {
				cause: error
			});
		}
		cursor = entry.reversed ? chunkStart : chunkEnd;
		const sourceFinished = entry.reversed ? cursor <= sourceStart : cursor >= sourceEnd;
		if (decoded.channels.length === 0 || decoded.channels[0]!.length === 0) {
			if (sourceFinished) break;
			continue;
		}
		diagnostics?.onSourceWindow?.(decoded.channels[0]!.length);
		if (sampleRate === 0) {
			sampleRate = decoded.sampleRate;
			channelCount = decoded.channels.length;
			const needsStretch =
				Math.abs(entry.playbackRate - 1) > ACTIVE_EPSILON ||
				Math.abs(entry.pitchShiftSemitones) > ACTIVE_EPSILON;
			if (needsStretch) {
				timeStretch = await StreamingTimeStretch.create(
					channelCount,
					entry.playbackRate,
					Math.pow(2, entry.pitchShiftSemitones / 12)
				);
			}
			eq = new StreamingAudioEq(channelCount, sampleRate, entry.audioEqStages);
			effectChain = new StreamingAudioEffectChain(entry.audioEffects, sampleRate, channelCount);
			if (sampleRate !== MIX_SAMPLE_RATE) {
				resamplers = Array.from(
					{ length: channelCount },
					() => new AbsolutePhaseResampler(sampleRate, MIX_SAMPLE_RATE)
				);
			}
		} else if (decoded.sampleRate !== sampleRate || decoded.channels.length !== channelCount) {
			throw new Error('A timeline clip changed audio format during export.');
		}

		let channels = entry.reversed ? reverseChannels(decoded.channels) : decoded.channels;
		if (timeStretch) channels = timeStretch.process(channels, sourceFinished);
		if (channels[0]?.length === 0) continue;
		channels = eq!.process(channels);
		if (effectChain && !effectChain.isEmpty()) channels = effectChain.process(channels);
		if (resamplers) {
			channels = channels.map((channel, index) =>
				resamplers![index]!.processChunk(channel, sourceFinished)
			);
		}
		if (channels[0]?.length === 0) continue;
		let mapped = downmixToOutputChannels(channels, MIX_CHANNELS);
		const remaining = targetFrames - emittedFrames;
		if (mapped[0]!.length > remaining)
			mapped = mapped.map((channel) => channel.slice(0, remaining));
		emittedFrames += mapped[0]!.length;
		yield mapped;
		if (sourceFinished) break;
	}
	if (emittedFrames < targetFrames) {
		throw new Error('A timeline clip ended before its planned audio duration.');
	}
}

class EntryAudioReader {
	private readonly chunks: AudioChunk[] = [];
	private availableFrames = 0;
	private consumedFrames = 0;

	constructor(private readonly iterator: AsyncGenerator<Float32Array[]>) {}

	async discard(frames: number): Promise<void> {
		if (frames > 0) await this.read(frames, false);
	}

	async take(frames: number): Promise<Float32Array[]> {
		return this.read(frames, true);
	}

	private async read(frames: number, copy: boolean): Promise<Float32Array[]> {
		while (this.availableFrames < frames) {
			const next = await this.iterator.next();
			if (next.done) throw new Error('A timeline clip ended before its planned audio duration.');
			const chunkFrames = next.value[0]?.length ?? 0;
			if (chunkFrames === 0) continue;
			this.chunks.push({ channels: next.value, frameOffset: 0 });
			this.availableFrames += chunkFrames;
		}
		const output = copy
			? [new Float32Array(frames), new Float32Array(frames)]
			: [new Float32Array(0), new Float32Array(0)];
		let remaining = frames;
		let outputOffset = 0;
		while (remaining > 0) {
			const chunk = this.chunks[0]!;
			const chunkFrames = chunk.channels[0]!.length;
			const count = Math.min(remaining, chunkFrames - chunk.frameOffset);
			if (copy) {
				for (let channel = 0; channel < MIX_CHANNELS; channel++) {
					output[channel]!.set(
						chunk.channels[channel]!.subarray(chunk.frameOffset, chunk.frameOffset + count),
						outputOffset
					);
				}
			}
			chunk.frameOffset += count;
			this.availableFrames -= count;
			this.consumedFrames += count;
			remaining -= count;
			outputOffset += count;
			if (chunk.frameOffset === chunkFrames) this.chunks.shift();
		}
		return output;
	}

	get position(): number {
		return this.consumedFrames;
	}

	async close(): Promise<void> {
		await this.iterator.return(undefined);
	}
}

interface PreparedEntry {
	entry: MixEntry;
	startSample: number;
	endSample: number;
	automation: EntryAutomation;
	reader: EntryAudioReader | null;
}

export async function* mixAudioWindows(
	entries: MixEntry[],
	durationSeconds: number,
	signal?: AbortSignal,
	diagnostics?: AudioMixDiagnostics
): AsyncGenerator<{
	samples: Float32Array[];
	sampleRate: number;
	channels: number;
}> {
	throwIfAborted(signal);
	if (entries.length === 0 || durationSeconds <= 0) return;
	const totalSamples = Math.ceil(durationSeconds * MIX_SAMPLE_RATE);
	const duckSources = collectMixEntryDuckWindows(entries);
	const prepared: PreparedEntry[] = entries.map((entry) => {
		const startSample = Math.floor(entry.whenSeconds * MIX_SAMPLE_RATE);
		return {
			entry,
			startSample,
			endSample: startSample + Math.ceil(entry.durationSeconds * MIX_SAMPLE_RATE),
			automation: new EntryAutomation(entry, diagnostics),
			reader: null
		};
	});
	const compiledDucks = prepared.map(
		(p) =>
			new CompiledTargetDuck(duckSources, {
				itemId: p.entry.itemId,
				trackId: p.entry.trackId,
				trackAliases: p.entry.duckTrackAliases ?? (p.entry.trackId ? [p.entry.trackId] : undefined)
			})
	);
	try {
		for (let windowStart = 0; windowStart < totalSamples; windowStart += MIX_WINDOW_SAMPLES) {
			throwIfAborted(signal);
			const windowEnd = Math.min(totalSamples, windowStart + MIX_WINDOW_SAMPLES);
			const windowLength = windowEnd - windowStart;
			diagnostics?.onOutputWindow?.(windowLength);
			const mix = [new Float32Array(windowLength), new Float32Array(windowLength)];
			for (let idx = 0; idx < prepared.length; idx++) {
				const current = prepared[idx]!;
				const overlapStart = Math.max(windowStart, current.startSample);
				const overlapEnd = Math.min(windowEnd, current.endSample);
				if (overlapEnd <= overlapStart) continue;
				current.reader ??= new EntryAudioReader(
					streamEntryAudio(current.entry, signal, diagnostics)
				);
				const entryOffset = overlapStart - current.startSample;
				if (current.reader.position < entryOffset) {
					await current.reader.discard(entryOffset - current.reader.position);
				}
				if (current.reader.position !== entryOffset) {
					throw new Error('Audio mix state advanced past its timeline position.');
				}
				const overlapLength = overlapEnd - overlapStart;
				const channels = await current.reader.take(overlapLength);
				const windowOffset = overlapStart - windowStart;
				for (let sample = 0; sample < overlapLength; sample++) {
					const timelineSample = overlapStart + sample;
					const baseGain = current.automation.gainAt(timelineSample);
					const duckGain = compiledDucks[idx]!.gainAt(timelineSample / MIX_SAMPLE_RATE);
					const gain = baseGain * duckGain;
					mix[0]![windowOffset + sample]! += (channels[0]![sample] ?? 0) * gain;
					mix[1]![windowOffset + sample]! += (channels[1]![sample] ?? 0) * gain;
				}
			}
			for (const channel of mix) {
				for (let sample = 0; sample < channel.length; sample++) {
					if (Math.abs(channel[sample]!) > 1) channel[sample] = Math.tanh(channel[sample]!);
				}
			}
			yield {
				samples: mix,
				sampleRate: MIX_SAMPLE_RATE,
				channels: MIX_CHANNELS
			};
		}
	} finally {
		await Promise.all(prepared.map((entry) => entry.reader?.close()));
	}
}

export function mixDurationSeconds(entries: MixEntry[]): number {
	return entries.reduce(
		(max, entry) => Math.max(max, entry.whenSeconds + entry.durationSeconds),
		0
	);
}
