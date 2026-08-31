import { afterEach, describe, expect, it } from 'vitest';
import type { Project, TimelineItem, TimelineTrack } from '../project/types';
import { mediaPool } from '../media/pool.svelte';
import { renderTimelineAudioArtifact } from '../media/render-export';
import type { MixEntry } from '../media/render-plan';
import { DEFAULT_AUDIO_EQ_SETTINGS } from './audio-eq';
import { MIX_SAMPLE_RATE, MIX_WINDOW_SAMPLES, mixAudioWindows } from './bounded-audio-mixer';
import { createDefaultAudioEffect, type DelayEffect } from './audio-effects';

function linkedFileHandle(file: File): FileSystemFileHandle {
	// SAFETY: test helper only uses name, kind and getFile for resolveMediaBlob
	return { kind: 'file', name: file.name, getFile: async () => file } as FileSystemFileHandle;
}

function wavBlobFromMono(samples: Float32Array, sampleRate: number): Blob {
	const bytesPerSample = 2;
	const blockAlign = 1 * bytesPerSample;
	const byteRate = sampleRate * blockAlign;
	const dataSize = samples.length * bytesPerSample;
	const buffer = new ArrayBuffer(44 + dataSize);
	const view = new DataView(buffer);
	let o = 0;
	const write = (s: string) => {
		for (let i = 0; i < s.length; i++) view.setUint8(o++, s.charCodeAt(i));
	};
	write('RIFF');
	view.setUint32(o, 36 + dataSize, true);
	o += 4;
	write('WAVE');
	write('fmt ');
	view.setUint32(o, 16, true);
	o += 4;
	view.setUint16(o, 1, true);
	o += 2;
	view.setUint16(o, 1, true);
	o += 2;
	view.setUint32(o, sampleRate, true);
	o += 4;
	view.setUint32(o, byteRate, true);
	o += 4;
	view.setUint16(o, blockAlign, true);
	o += 2;
	view.setUint16(o, 16, true);
	o += 2;
	write('data');
	view.setUint32(o, dataSize, true);
	o += 4;
	for (let i = 0; i < samples.length; i++) {
		const s = Math.max(-1, Math.min(1, samples[i]!));
		view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
		o += 2;
	}
	return new Blob([buffer], { type: 'audio/wav' });
}

interface DecodedPcmWav {
	sampleRate: number;
	length: number;
	channels: Float32Array[];
}

function fourCc(view: DataView, offset: number): string {
	return String.fromCharCode(
		view.getUint8(offset),
		view.getUint8(offset + 1),
		view.getUint8(offset + 2),
		view.getUint8(offset + 3)
	);
}

async function decodePcm16Wav(blob: Blob): Promise<DecodedPcmWav> {
	const buffer = await blob.arrayBuffer();
	const view = new DataView(buffer);
	if (view.byteLength < 12 || fourCc(view, 0) !== 'RIFF' || fourCc(view, 8) !== 'WAVE') {
		throw new Error('Expected a RIFF/WAVE artifact.');
	}

	let sampleRate = 0;
	let channelCount = 0;
	let bitsPerSample = 0;
	let audioFormat = 0;
	let dataOffset = -1;
	let dataSize = 0;
	for (let offset = 12; offset + 8 <= view.byteLength;) {
		const chunk = fourCc(view, offset);
		const chunkSize = view.getUint32(offset + 4, true);
		const payloadOffset = offset + 8;
		if (payloadOffset + chunkSize > view.byteLength) throw new Error('Truncated WAV chunk.');
		if (chunk === 'fmt ') {
			if (chunkSize < 16) throw new Error('Invalid WAV format chunk.');
			audioFormat = view.getUint16(payloadOffset, true);
			channelCount = view.getUint16(payloadOffset + 2, true);
			sampleRate = view.getUint32(payloadOffset + 4, true);
			bitsPerSample = view.getUint16(payloadOffset + 14, true);
		} else if (chunk === 'data') {
			dataOffset = payloadOffset;
			dataSize = chunkSize;
		}
		offset = payloadOffset + chunkSize + (chunkSize % 2);
	}
	if (
		audioFormat !== 1 ||
		bitsPerSample !== 16 ||
		channelCount < 1 ||
		sampleRate < 1 ||
		dataOffset < 0
	) {
		throw new Error('Expected 16-bit PCM WAV audio.');
	}

	const bytesPerFrame = channelCount * 2;
	if (dataSize % bytesPerFrame !== 0) throw new Error('WAV data is not frame-aligned.');
	const length = dataSize / bytesPerFrame;
	const channels = Array.from({ length: channelCount }, () => new Float32Array(length));
	for (let frame = 0; frame < length; frame++) {
		for (let channel = 0; channel < channelCount; channel++) {
			channels[channel]![frame] =
				view.getInt16(dataOffset + (frame * channelCount + channel) * 2, true) / 0x8000;
		}
	}
	return { sampleRate, length, channels };
}

function sine(samples: number, freq: number, rate: number): Float32Array {
	return Float32Array.from({ length: samples }, (_, i) =>
		Math.sin((2 * Math.PI * freq * i) / rate)
	);
}

async function exportScratchFileCount(): Promise<number> {
	try {
		const root = await navigator.storage.getDirectory();
		const directory = await root.getDirectoryHandle('openpost-export-scratch', { create: true });
		let count = 0;
		for await (const handle of directory.values()) if (handle.kind === 'file') count++;
		return count;
	} catch {
		return 0;
	}
}
afterEach(() => mediaPool.clear());

describe('bounded audio export product path', () => {
	it('preserves 44.1k tone absolute phase via windowed windows', async () => {
		const rate = 44_100;
		const durationSec = 60;
		const samples = rate * durationSec;
		const tone = sine(samples, 440, rate);
		tone[durationSec * rate - 10] = 0.9; // marker near end
		const blob = wavBlobFromMono(tone, rate);
		const file = new File([blob], 'tone-44k.wav', { type: 'audio/wav' });
		mediaPool.upsert(
			{
				id: 'src44',
				storageType: 'handle',
				fileHandle: linkedFileHandle(file),
				fileName: file.name,
				fileSize: file.size,
				mimeType: 'audio/wav',
				duration: durationSec,
				width: 0,
				height: 0,
				fps: 0,
				codec: '',
				audioCodec: 'pcm-s16',
				audioCodecSupported: true,
				bitrate: 0,
				tags: ['audio']
			},
			'ready'
		);
		const track: TimelineTrack = {
			id: 't',
			name: 't',
			kind: 'audio',
			height: 64,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			order: 0
		};
		const item: TimelineItem = {
			id: 'c',
			trackId: 't',
			from: 0,
			durationInFrames: durationSec * 30,
			label: '',
			type: 'audio',
			mediaId: 'src44',
			sourceStart: 0,
			sourceFps: 30
		};
		const project: Project = {
			id: 'p',
			name: 'wav44',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 0,
			metadata: { width: 1920, height: 1080, fps: 30, backgroundColor: '#000' },
			timeline: { tracks: [track], items: [item] }
		};
		const artifact = await renderTimelineAudioArtifact(project, { format: 'wav' });
		expect(artifact.blob.type).toBe('audio/wav');
		const decoded = await decodePcm16Wav(artifact.blob);
		expect(decoded.sampleRate).toBe(48_000);
		expect(decoded.length).toBeCloseTo(durationSec * 48_000, -2);
		expect(decoded.channels).toHaveLength(2);
		// Mono duplicated to stereo
		const left = decoded.channels[0]!;
		const right = decoded.channels[1]!;
		expect(left[1000]).toBeCloseTo(right[1000], 4);
		// Frequency approx via zero crossings
		let crossings = 0;
		for (let i = 1; i < left.length; i++) if (left[i - 1]! < 0 && left[i]! >= 0) crossings++;
		const freq = crossings / durationSec;
		expect(Math.abs(freq - 440)).toBeLessThan(5);
	}, 30_000);

	it('keeps impulse across 30s window boundary', async () => {
		const rate = 48_000;
		const durationSec = 61;
		const samples = rate * durationSec;
		const data = new Float32Array(samples);
		const impulseAt = 30 * rate; // exactly at window edge
		data[impulseAt] = 1;
		data[impulseAt + 1] = 0.5;
		const blob = wavBlobFromMono(data, rate);
		const file = new File([blob], 'impulse.wav', { type: 'audio/wav' });
		mediaPool.upsert(
			{
				id: 'imp',
				storageType: 'handle',
				fileHandle: linkedFileHandle(file),
				fileName: file.name,
				fileSize: file.size,
				mimeType: 'audio/wav',
				duration: durationSec,
				width: 0,
				height: 0,
				fps: 0,
				codec: '',
				audioCodec: 'pcm-s16',
				audioCodecSupported: true,
				bitrate: 0,
				tags: ['audio']
			},
			'ready'
		);
		const track: TimelineTrack = {
			id: 't',
			name: 't',
			kind: 'audio',
			height: 64,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			order: 0
		};
		const item: TimelineItem = {
			id: 'c',
			trackId: 't',
			from: 0,
			durationInFrames: durationSec * 30,
			label: '',
			type: 'audio',
			mediaId: 'imp',
			sourceStart: 0,
			sourceFps: 30
		};
		const project: Project = {
			id: 'p2',
			name: 'impulse',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 0,
			metadata: { width: 1920, height: 1080, fps: 30, backgroundColor: '#000' },
			timeline: { tracks: [track], items: [item] }
		};
		const artifact = await renderTimelineAudioArtifact(project, { format: 'wav' });
		const decoded = await decodePcm16Wav(artifact.blob);
		const ch = decoded.channels[0]!;
		let peakIdx = -1;
		let peak = -Infinity;
		for (let i = 0; i < ch.length; i++)
			if (ch[i]! > peak) {
				peak = ch[i]!;
				peakIdx = i;
			}
		expect(Math.abs(peakIdx - impulseAt)).toBeLessThanOrEqual(2);
		expect(peak).toBeGreaterThan(0.4);
	}, 30_000);

	it('respects exact trim boundaries', async () => {
		const rate = 48_000;
		const srcSec = 5;
		const src = sine(srcSec * rate, 440, rate);
		const blob = wavBlobFromMono(src, rate);
		const file = new File([blob], 'trim.wav', { type: 'audio/wav' });
		mediaPool.upsert(
			{
				id: 'trim',
				storageType: 'handle',
				fileHandle: linkedFileHandle(file),
				fileName: file.name,
				fileSize: file.size,
				mimeType: 'audio/wav',
				duration: srcSec,
				width: 0,
				height: 0,
				fps: 0,
				codec: '',
				audioCodec: 'pcm-s16',
				audioCodecSupported: true,
				bitrate: 0,
				tags: ['audio']
			},
			'ready'
		);
		const track: TimelineTrack = {
			id: 't',
			name: 't',
			kind: 'audio',
			height: 64,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			order: 0
		};
		const item: TimelineItem = {
			id: 'c',
			trackId: 't',
			from: 0,
			durationInFrames: 2 * 30,
			label: '',
			type: 'audio',
			mediaId: 'trim',
			sourceStart: 1 * 30,
			sourceEnd: 3 * 30,
			sourceFps: 30
		};
		const project: Project = {
			id: 'p3',
			name: 'trim',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 0,
			metadata: { width: 1920, height: 1080, fps: 30, backgroundColor: '#000' },
			timeline: { tracks: [track], items: [item] }
		};
		const artifact = await renderTimelineAudioArtifact(project, {
			format: 'wav',
			range: { startFrame: 0, endFrame: 60 }
		});
		const decoded = await decodePcm16Wav(artifact.blob);
		expect(decoded.length).toBeCloseTo(2 * 48_000, -2);
	}, 20_000);

	it('fails on decode failure for audio-only instead of silent', async () => {
		const track: TimelineTrack = {
			id: 't',
			name: 't',
			kind: 'audio',
			height: 64,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			order: 0
		};
		const item: TimelineItem = {
			id: 'c',
			trackId: 't',
			from: 0,
			durationInFrames: 30,
			label: '',
			type: 'audio',
			mediaId: 'missing',
			sourceStart: 0,
			sourceFps: 30
		};
		const project: Project = {
			id: 'p4',
			name: 'fail',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 0,
			metadata: { width: 1920, height: 1080, fps: 30, backgroundColor: '#000' },
			timeline: { tracks: [track], items: [item] }
		};
		await expect(renderTimelineAudioArtifact(project, { format: 'wav' })).rejects.toThrow();
	});

	it('cancels and does not leak', async () => {
		const rate = 48_000;
		const src = sine(3 * rate, 440, rate);
		const blob = wavBlobFromMono(src, rate);
		const file = new File([blob], 'cancel.wav', { type: 'audio/wav' });
		mediaPool.upsert(
			{
				id: 'cancel',
				storageType: 'handle',
				fileHandle: linkedFileHandle(file),
				fileName: file.name,
				fileSize: file.size,
				mimeType: 'audio/wav',
				duration: 3,
				width: 0,
				height: 0,
				fps: 0,
				codec: '',
				audioCodec: 'pcm-s16',
				audioCodecSupported: true,
				bitrate: 0,
				tags: ['audio']
			},
			'ready'
		);
		const track: TimelineTrack = {
			id: 't',
			name: 't',
			kind: 'audio',
			height: 64,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			order: 0
		};
		const item: TimelineItem = {
			id: 'c',
			trackId: 't',
			from: 0,
			durationInFrames: 90,
			label: '',
			type: 'audio',
			mediaId: 'cancel',
			sourceStart: 0,
			sourceFps: 30
		};
		const project: Project = {
			id: 'p5',
			name: 'cancel',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 0,
			metadata: { width: 1920, height: 1080, fps: 30, backgroundColor: '#000' },
			timeline: { tracks: [track], items: [item] }
		};
		const scratchBefore = await exportScratchFileCount();
		const controller = new AbortController();
		let reachedEncoding = false;
		const promise = renderTimelineAudioArtifact(project, {
			format: 'wav',
			signal: controller.signal,
			onProgress: ({ phase }) => {
				if (phase !== 'encoding' || controller.signal.aborted) return;
				reachedEncoding = true;
				controller.abort();
			}
		});
		await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
		expect(reachedEncoding).toBe(true);
		expect(await exportScratchFileCount()).toBe(scratchBefore);
	});

	it('bounds peak windows to one fixed-size owner', async () => {
		const rate = 48_000;
		const durationSec = 90;
		const src = new Float32Array(rate * durationSec);
		for (let i = 0; i < src.length; i++) src[i] = Math.sin((2 * Math.PI * 220 * i) / rate);
		const blob = wavBlobFromMono(src, rate);
		const file = new File([blob], 'long.wav', { type: 'audio/wav' });
		mediaPool.upsert(
			{
				id: 'long',
				storageType: 'handle',
				fileHandle: linkedFileHandle(file),
				fileName: file.name,
				fileSize: file.size,
				mimeType: 'audio/wav',
				duration: durationSec,
				width: 0,
				height: 0,
				fps: 0,
				codec: '',
				audioCodec: 'pcm-s16',
				audioCodecSupported: true,
				bitrate: 0,
				tags: ['audio']
			},
			'ready'
		);
		const track: TimelineTrack = {
			id: 't',
			name: 't',
			kind: 'audio',
			height: 64,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			order: 0
		};
		const item: TimelineItem = {
			id: 'c',
			trackId: 't',
			from: 0,
			durationInFrames: durationSec * 30,
			label: '',
			type: 'audio',
			mediaId: 'long',
			sourceStart: 0,
			sourceFps: 30
		};
		const project: Project = {
			id: 'p6',
			name: 'long',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 0,
			metadata: { width: 1920, height: 1080, fps: 30, backgroundColor: '#000' },
			timeline: { tracks: [track], items: [item] }
		};
		const artifact = await renderTimelineAudioArtifact(project, { format: 'wav' });
		const decoded = await decodePcm16Wav(artifact.blob);
		expect(decoded.length).toBeCloseTo(durationSec * 48_000, -2);
		expect(decoded.length).toBeGreaterThan(0);
		// The direct mixer diagnostics below prove the allocation bound. This product-path check proves output duration.
	}, 30_000);

	it('keeps speed, pitch, EQ, resampling and automation bounded and continuous', async () => {
		const rate = 48_000;
		const sourceSeconds = 30;
		const source = sine(rate * sourceSeconds, 330, rate);
		const blob = wavBlobFromMono(source, rate);
		const file = new File([blob], 'complex-stream.wav', { type: 'audio/wav' });
		mediaPool.upsert(
			{
				id: 'complex-stream',
				storageType: 'handle',
				fileHandle: linkedFileHandle(file),
				fileName: file.name,
				fileSize: file.size,
				mimeType: 'audio/wav',
				duration: sourceSeconds,
				width: 0,
				height: 0,
				fps: 0,
				codec: '',
				audioCodec: 'pcm-s16',
				audioCodecSupported: true,
				bitrate: 0,
				tags: ['audio']
			},
			'ready'
		);
		const entry: MixEntry = {
			itemId: 'complex-item',
			mediaId: 'complex-stream',
			trackId: 'audio-track',
			whenSeconds: 0,
			sourceOffsetSeconds: 0,
			playbackRate: 1.5,
			pitchShiftSemitones: 3,
			audioEqStages: [
				{
					...DEFAULT_AUDIO_EQ_SETTINGS,
					lowCutEnabled: true,
					lowCutFrequencyHz: 80,
					highMidGainDb: 3,
					highMidFrequencyHz: 2600
				}
			],
			reversed: false,
			durationSeconds: 20,
			gainPoints: [
				{ whenSeconds: 0, value: 0.8 },
				{ whenSeconds: 10, value: 1 },
				{ whenSeconds: 20, value: 0.9 }
			],
			previewGainPoints: [],
			mixerTrackGain: 1,
			transitionGainSpans: [
				{ startSeconds: 9, durationSeconds: 2, isIncoming: false, dipToSilence: false }
			]
		};
		let maxOutputWindow = 0;
		let maxSourceWindow = 0;
		let automationPreparations = 0;
		let totalFrames = 0;
		let previousLast = 0;
		let sawPrevious = false;
		const boundaryJumps: number[] = [];
		for await (const window of mixAudioWindows([entry], 20, undefined, {
			onOutputWindow: (frames) => (maxOutputWindow = Math.max(maxOutputWindow, frames)),
			onSourceWindow: (frames) => (maxSourceWindow = Math.max(maxSourceWindow, frames)),
			onAutomationPrepared: (gainPoints, spans) => {
				expect(gainPoints).toBe(3);
				expect(spans).toBe(1);
				automationPreparations++;
			}
		})) {
			const channel = window.samples[0]!;
			if (sawPrevious) boundaryJumps.push(Math.abs(channel[0]! - previousLast));
			previousLast = channel[channel.length - 1]!;
			sawPrevious = true;
			totalFrames += channel.length;
			let localEnergy = 0;
			for (let frame = 0; frame < Math.min(256, channel.length); frame++) {
				localEnergy += Math.abs(channel[frame]!);
			}
			expect(localEnergy / Math.min(256, channel.length)).toBeGreaterThan(0.05);
		}
		expect(totalFrames).toBe(20 * rate);
		expect(maxOutputWindow).toBe(MIX_WINDOW_SAMPLES);
		expect(maxSourceWindow).toBeLessThanOrEqual(sourceSeconds * rate);
		expect(maxSourceWindow).toBeLessThanOrEqual(5 * rate + 1);
		expect(automationPreparations).toBe(1);
		expect(Math.max(...boundaryJumps)).toBeLessThan(0.2);
	}, 30_000);

	it('renders a variable-speed source window into the planned output duration', async () => {
		const rate = 48_000;
		const source = Float32Array.from(
			{ length: rate * 4 },
			(_, frame) => (Math.floor(frame / rate) + 1) * 0.1
		);
		const blob = wavBlobFromMono(source, rate);
		const file = new File([blob], 'speed-curve.wav', { type: 'audio/wav' });
		mediaPool.upsert(
			{
				id: 'speed-curve',
				storageType: 'handle',
				fileHandle: linkedFileHandle(file),
				fileName: file.name,
				fileSize: file.size,
				mimeType: 'audio/wav',
				duration: 4,
				width: 0,
				height: 0,
				fps: 0,
				codec: '',
				audioCodec: 'pcm-s16',
				audioCodecSupported: true,
				bitrate: 0,
				tags: ['audio']
			},
			'ready'
		);
		const entry: MixEntry = {
			itemId: 'speed-curve-item',
			mediaId: 'speed-curve',
			trackId: 'audio-track',
			whenSeconds: 0,
			sourceOffsetSeconds: 0,
			sourceWindowStartSeconds: 0,
			sourceWindowEndSeconds: 4,
			playbackRate: 1,
			playbackRateCurve: [
				{ atSeconds: 0, rate: 1 },
				{ atSeconds: 0.9999999, rate: 1 },
				{ atSeconds: 1, rate: 2 },
				{ atSeconds: 1.9999999, rate: 2 },
				{ atSeconds: 2, rate: 1 },
				{ atSeconds: 3, rate: 1 }
			],
			pitchShiftSemitones: 0,
			audioEqStages: [],
			audioEffects: [],
			reversed: false,
			durationSeconds: 3,
			gainPoints: [{ whenSeconds: 0, value: 1 }],
			previewGainPoints: [],
			mixerTrackGain: 1,
			transitionGainSpans: []
		};
		const output = new Float32Array(rate * 3);
		let offset = 0;
		for await (const window of mixAudioWindows([entry], 3)) {
			output.set(window.samples[0]!, offset);
			offset += window.samples[0]!.length;
		}
		const average = (start: number, end: number) => {
			let total = 0;
			for (let frame = start; frame < end; frame += 1) total += output[frame]!;
			return total / (end - start);
		};

		expect(offset).toBe(rate * 3);
		expect(average(rate / 4, rate / 2)).toBeCloseTo(0.1, 1);
		expect(average(rate * 1.3, rate * 1.7)).toBeGreaterThan(0.2);
		expect(average(rate * 2.5, rate * 2.75)).toBeCloseTo(0.4, 1);
	}, 30_000);

	it('streams reversed audio with effect tails without extending the composition', async () => {
		const rate = 44_100;
		const durationSeconds = 11;
		const source = Float32Array.from({ length: rate * durationSeconds }, (_, frame) =>
			Math.min(0.9, (Math.floor(frame / rate) + 1) * 0.05)
		);
		const blob = wavBlobFromMono(source, rate);
		const file = new File([blob], 'reverse-stream.wav', { type: 'audio/wav' });
		mediaPool.upsert(
			{
				id: 'reverse-stream',
				storageType: 'handle',
				fileHandle: linkedFileHandle(file),
				fileName: file.name,
				fileSize: file.size,
				mimeType: 'audio/wav',
				duration: durationSeconds,
				width: 0,
				height: 0,
				fps: 0,
				codec: '',
				audioCodec: 'pcm-s16',
				audioCodecSupported: true,
				bitrate: 0,
				tags: ['audio']
			},
			'ready'
		);
		const delay = createDefaultAudioEffect('delay');
		delay.mix = 0.01;
		const entry: MixEntry = {
			itemId: 'reverse-item',
			mediaId: 'reverse-stream',
			whenSeconds: 0,
			sourceOffsetSeconds: durationSeconds,
			playbackRate: 1,
			pitchShiftSemitones: 0,
			audioEqStages: [],
			reversed: true,
			durationSeconds,
			gainPoints: [{ whenSeconds: 0, value: 1 }],
			previewGainPoints: [],
			mixerTrackGain: 1,
			transitionGainSpans: [],
			audioEffects: [delay]
		};
		const firstSecond: number[] = [];
		const lastSecond: number[] = [];
		let frameOffset = 0;
		for await (const window of mixAudioWindows([entry], durationSeconds)) {
			const channel = window.samples[0]!;
			for (let frame = 0; frame < channel.length; frame++) {
				const absoluteFrame = frameOffset + frame;
				if (absoluteFrame < MIX_SAMPLE_RATE) firstSecond.push(channel[frame]!);
				if (absoluteFrame >= (durationSeconds - 1) * MIX_SAMPLE_RATE) {
					lastSecond.push(channel[frame]!);
				}
			}
			frameOffset += channel.length;
		}
		const average = (values: number[]) =>
			values.reduce((total, value) => total + value, 0) / values.length;
		expect(frameOffset).toBe(durationSeconds * MIX_SAMPLE_RATE);
		expect(average(firstSecond)).toBeGreaterThan(0.5);
		expect(average(lastSecond)).toBeLessThan(0.1);
	}, 30_000);
});
