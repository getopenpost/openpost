import { afterEach, expect, it } from 'vitest';
import { mixAudioWindows } from './bounded-audio-mixer';
import { planNestedMixdown, sliceMixEntries } from '../media/render-plan';
import { mediaPool } from '../media/pool.svelte';
import { createDefaultTracks } from '../project/defaults';
import type { SubComposition, TimelineItem } from '../project/types';

afterEach(() => mediaPool.clear());

function twoPartWav(): Blob {
	const sampleRate = 48_000;
	const buffer = new ArrayBuffer(44 + sampleRate * 2);
	const view = new DataView(buffer);
	const text = (offset: number, value: string) => {
		for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
	};
	text(0, 'RIFF');
	view.setUint32(4, buffer.byteLength - 8, true);
	text(8, 'WAVE');
	text(12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	text(36, 'data');
	view.setUint32(40, sampleRate * 2, true);
	for (let i = 0; i < sampleRate; i++)
		view.setInt16(44 + i * 2, i < sampleRate / 2 ? 8192 : -8192, true);
	return new Blob([buffer], { type: 'audio/wav' });
}

const crossfadeRamp: Partial<TimelineItem> = {
	durationInFrames: 38,
	speedRamp: [
		{ id: 'slow', sourceFrame: 0, speed: 0.5, easing: 'hold' },
		{ id: 'fast', sourceFrame: 15, speed: 2, easing: 'hold' },
		{ id: 'end', sourceFrame: 30, speed: 2, easing: 'hold' }
	]
};

it.each([
	{ name: 'reverse', patch: { isReversed: true }, expected: -0.25 },
	{
		name: 'reverse with wrapper fade',
		patch: { isReversed: true, audioFadeIn: 1 },
		expected: -0.025
	},
	{
		name: 'reverse twice',
		patch: { isReversed: true },
		childPatch: { isReversed: true },
		expected: -0.25,
		nestedExpected: 0.25
	},
	{
		name: 'reversed child automation',
		patch: { isReversed: true },
		childPatch: { keyframes: { volume: { frames: [0, 30], values: [0, 1] } } },
		expected: -0.25,
		nestedExpected: -0.225
	},
	{
		name: 'reversed delayed child',
		patch: { isReversed: true },
		childPatch: { from: 15, durationInFrames: 15, sourceEnd: 15 },
		expected: -0.25,
		nestedExpected: 0.25
	},
	{
		name: 'pinned source FPS',
		patch: { sourceFps: 30, sourceEnd: 60, durationInFrames: 60 },
		childPatch: { durationInFrames: 60 },
		compositionFps: 60,
		nestedOnly: true,
		at: 1.5,
		expected: -0.25
	},
	{
		name: 'trimmed child automation',
		patch: { sourceEnd: 15, durationInFrames: 15 },
		childPatch: { keyframes: { volume: { frames: [0, 30], values: [0, 1] } } },
		expected: 0.25,
		nestedExpected: 0.025
	},
	{
		name: 'speed ramp',
		patch: {
			durationInFrames: 23,
			speedRamp: [
				{ id: 'fast', sourceFrame: 0, speed: 2, easing: 'hold' },
				{ id: 'normal', sourceFrame: 15, speed: 1, easing: 'hold' },
				{ id: 'end', sourceFrame: 30, speed: 1, easing: 'hold' }
			]
		},
		at: 0.4,
		expected: -0.25
	},
	{
		name: 'speed-ramped child crossfade',
		patch: crossfadeRamp,
		childTransition: true,
		nestedOnly: true,
		at: 0.9,
		// 0.9 output seconds is 0.45 child seconds, one quarter through
		// the crossfade from child time 0.4 to 0.6 seconds.
		expected: 0.25 * Math.cos(Math.PI / 8)
	},
	{
		name: 'reversed speed-ramped child crossfade',
		patch: { ...crossfadeRamp, isReversed: true },
		childTransition: true,
		nestedOnly: true,
		at: 0.35,
		expected: 0.25 * Math.cos(Math.PI / 8)
	},
	{
		name: 'range-trimmed speed-ramped child crossfade',
		patch: crossfadeRamp,
		childTransition: true,
		nestedOnly: true,
		sliceStart: 0.8,
		at: 0.1,
		expected: 0.25 * Math.cos(Math.PI / 8)
	},
	{ name: 'fade-in', patch: { audioFadeIn: 1 }, expected: 0.025 },
	{
		name: 'volume automation',
		patch: { keyframes: { volume: { frames: [0, 30], values: [0, 1] } } },
		expected: 0.025
	}
] satisfies Array<{
	name: string;
	patch: Partial<TimelineItem>;
	childPatch?: Partial<TimelineItem>;
	expected: number;
	nestedExpected?: number;
	at?: number;
	compositionFps?: number;
	nestedOnly?: boolean;
	childTransition?: boolean;
	sliceStart?: number;
}>)(
	'preserves $name in nested audio mixdown',
	async ({
		patch,
		childPatch,
		expected,
		nestedExpected,
		at = 0.1,
		compositionFps = 30,
		childTransition = false,
		sliceStart = 0,
		nestedOnly = false
	}) => {
		const blob = twoPartWav();
		const url = URL.createObjectURL(blob);
		mediaPool.upsert(
			{
				id: 'two-part',
				fileName: 'two-part.wav',
				fileSize: blob.size,
				mimeType: 'audio/wav',
				storageType: 'cloud',
				remoteUrl: url,
				duration: 1,
				width: 0,
				height: 0,
				fps: 0,
				codec: '',
				bitrate: 768000,
				audioCodec: 'pcm-s16',
				tags: ['audio']
			},
			'ready'
		);
		const tracks = createDefaultTracks();
		const clip: TimelineItem = {
			id: 'clip',
			mediaId: 'two-part',
			type: 'audio',
			trackId: tracks.find((track) => track.kind === 'audio')!.id,
			label: 'Two-part audio',
			from: 0,
			durationInFrames: 30,
			sourceStart: 0,
			sourceEnd: 30,
			sourceFps: 30
		};
		const composition: SubComposition = {
			id: 'composition',
			name: 'Audio composition',
			width: 64,
			height: 64,
			fps: compositionFps,
			durationInFrames: compositionFps,
			items: childTransition
				? [
						{ ...clip, durationInFrames: 15, sourceEnd: 15, sourceDuration: 30 },
						{ ...clip, id: 'incoming', from: 15, durationInFrames: 15, sourceStart: 15, volume: 0 }
					]
				: [{ ...clip, ...childPatch }],
			tracks,
			transitions: childTransition
				? [
						{
							id: 'fade',
							type: 'crossfade',
							durationInFrames: 6,
							fromItemId: clip.id,
							toItemId: 'incoming'
						}
					]
				: []
		};
		try {
			for (const nested of nestedOnly ? [true] : [false, true]) {
				const item: TimelineItem = {
					...clip,
					...patch,
					mediaId: nested ? undefined : clip.mediaId,
					compositionId: nested ? composition.id : undefined
				};
				const planned = planNestedMixdown([item], tracks, 30, [], [composition]);
				const entries =
					sliceStart > 0
						? sliceMixEntries(planned, sliceStart, item.durationInFrames / 30)
						: planned;
				const samples: number[] = [];
				const duration = Math.max(1, item.durationInFrames / 30);
				for await (const window of mixAudioWindows(entries, duration))
					for (const sample of window.samples[0]!) samples.push(sample);
				expect(samples).toHaveLength(duration * 48_000);
				expect(
					samples[Math.round(at * 48_000)],
					nested ? 'nested wrapper' : 'direct clip'
				).toBeCloseTo(nested ? (nestedExpected ?? expected) : expected, 3);
			}
		} finally {
			URL.revokeObjectURL(url);
		}
	}
);
