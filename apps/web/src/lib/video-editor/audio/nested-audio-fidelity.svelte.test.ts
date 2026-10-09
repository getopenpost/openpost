import { afterEach, expect, it } from 'vitest';
import { mixAudioWindows } from './bounded-audio-mixer';
import { planNestedMixdown, sliceMixEntries } from '../media/render-plan';
import { mediaPool } from '../media/pool.svelte';
import {
	CURRENT_SCHEMA_VERSION,
	createBlankProject,
	createDefaultTracks,
	createEmptyTimeline,
	migrateProjectDocument
} from '../project/defaults';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import {
	createCompoundClip,
	dissolveCompoundClip,
	nestSequence
} from '../sequences/sequence-actions';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { removeItems, unlinkItems, updateItemProperties } from '../timeline/actions/items';
import type { SubComposition, TimelineItem } from '../project/types';

afterEach(() => {
	mediaPool.clear();
	commandHistory.clearHistory();
	sequenceStore.reset();
	timelineStore.__resetForTesting();
});

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

function registerAudio(): string {
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
	return url;
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
		const url = registerAudio();
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

it.each(
	[
		{ source: 'nested sequence', edit: 'move' },
		{ source: 'nested sequence', edit: 'delete' },
		{ source: 'compound clip', edit: 'move' },
		{ source: 'compound clip', edit: 'delete' },
		{ source: 'legacy project', edit: 'move' },
		{ source: 'legacy project', edit: 'delete' },
		{ source: 'legacy nested sequence', edit: 'move' },
		{ source: 'legacy nested sequence', edit: 'delete' },
		{ source: 'compound clip', edit: 'move', dissolve: true },
		{ source: 'compound clip', edit: 'delete', dissolve: true },
		{ source: 'compound clip', edit: 'delete', dissolve: true, embedded: true },
		{ source: 'compound clip', edit: 'delete', dissolve: true, timer: true },
		{ source: 'compound clip', edit: 'move', dissolveAudio: true },
		{ source: 'compound clip', edit: 'move', dissolveAudio: true, embedded: true },
		{ source: 'compound clip', edit: 'move', dissolveAudio: true, timer: true },
		{ source: 'compound clip', edit: 'move', dissolveAudio: true, nested: true }
	].map((entry) => ({
		dissolve: false,
		dissolveAudio: false,
		embedded: false,
		timer: false,
		nested: false,
		...entry
	}))
)(
	'keeps $source audio independent after unlink and $edit (dissolve: $dissolve, embedded: $embedded, timer: $timer, audio only: $dissolveAudio, nested: $nested)',
	async ({ source, edit, dissolve, dissolveAudio, embedded, timer, nested }) => {
		const url = registerAudio();
		const tracks = createDefaultTracks();
		const visual: TimelineItem = {
			id: 'title',
			type: nested ? 'composition' : embedded ? 'video' : 'text',
			compositionId: nested ? 'inner' : undefined,
			mediaId: embedded ? 'two-part' : undefined,
			timer: timer
				? { style: 'numbers', direction: 'down', format: 'seconds', warningSound: true }
				: undefined,
			trackId: tracks[0]!.id,
			label: 'Title',
			from: 0,
			durationInFrames: 30
		};
		const audio: TimelineItem = {
			id: 'sound',
			type: 'audio',
			trackId: tracks[2]!.id,
			mediaId: 'two-part',
			label: 'Sound',
			from: 0,
			durationInFrames: 30
		};
		const composition: SubComposition = {
			id: 'saved',
			name: 'Saved',
			width: 64,
			height: 64,
			fps: 30,
			durationInFrames: 30,
			tracks,
			items: embedded || timer ? [visual] : [visual, { ...audio, volume: nested ? 0 : 1 }],
			transitions: []
		};
		const metadata = { width: 64, height: 64, fps: 30 };
		const compositions = nested
			? [composition, { ...composition, id: 'inner', items: [audio] }]
			: [composition];
		try {
			if (source.startsWith('legacy')) {
				const wrapper: TimelineItem = {
					...visual,
					type: 'composition',
					compositionId: 'saved',
					linkedGroupId: 'pair',
					sourceStart: 0,
					sourceEnd: 30,
					sourceFps: 30
				};
				const stored = {
					...createBlankProject(),
					schemaVersion: 10,
					metadata,
					timeline: {
						...createEmptyTimeline(),
						tracks,
						compositions,
						items: [
							wrapper,
							{ ...wrapper, id: 'audio-wrapper', type: 'audio' as const, trackId: audio.trackId }
						]
					}
				};
				if (source === 'legacy nested sequence') {
					stored.timeline.compositions.push({
						...composition,
						id: 'outer',
						items: stored.timeline.items
					});
					stored.timeline.items = [];
				}
				sequenceStore.load(migrateProjectDocument(stored).project.timeline!, metadata);
				if (source === 'legacy nested sequence') sequenceStore.switchTo('outer');
			} else {
				sequenceStore.load(
					{
						...createEmptyTimeline(),
						tracks,
						compositions,
						items: source === 'compound clip' ? composition.items : []
					},
					metadata
				);
				if (source === 'compound clip')
					createCompoundClip(composition.items.map((item) => item.id));
				else nestSequence(composition.id, 0);
			}
			const audioWrapper = timelineStore.items.find((item) => item.type === 'audio')!;
			unlinkItems([audioWrapper.id]);
			if (edit === 'move') updateItemProperties(audioWrapper.id, { from: 15 });
			else removeItems([audioWrapper.id]);
			if (dissolve)
				dissolveCompoundClip(timelineStore.items.find((item) => item.type === 'composition')!.id);
			if (dissolveAudio) {
				const restoredIds = dissolveCompoundClip(audioWrapper.id);
				const document = migrateProjectDocument({
					...createBlankProject(),
					metadata,
					timeline: JSON.parse(JSON.stringify(sequenceStore.projectTimeline()))
				}).project;
				sequenceStore.load(document.timeline!, metadata);
				const restored = restoredIds.map((id) => timelineStore.itemById.get(id)!);
				expect(restored.length).toBeGreaterThan(0);
				expect(restored.every((item) => item.type === 'audio')).toBe(true);
				expect(
					restored.every(
						(item) =>
							timelineStore.tracks.find((track) => track.id === item.trackId)?.kind === 'audio'
					)
				).toBe(true);
			}
			const entries = planNestedMixdown(
				timelineStore.items,
				timelineStore.tracks,
				30,
				[],
				sequenceStore.compositions
			);
			const samples: number[] = [];
			for await (const window of mixAudioWindows(entries, 1.5))
				for (const sample of window.samples[0]!) samples.push(sample);
			if (edit === 'delete') {
				// A mix without any audio owners produces no audio windows.
				expect(samples).toHaveLength(0);
			} else {
				expect(samples[4800], 'old audio position must be silent').toBeCloseTo(0, 4);
				if (timer)
					expect(Math.max(...samples.slice(26400, 27600).map(Math.abs))).toBeGreaterThan(0.1);
				else expect(samples[28800], 'only the moved audio owns sound').toBeCloseTo(0.25, 4);
			}
		} finally {
			URL.revokeObjectURL(url);
		}
	}
);

it.each([false, true])(
	'keeps embedded composition sound when an unrelated audio wrapper arrives (legacy: %s)',
	async (legacy) => {
		const url = registerAudio();
		const tracks = createDefaultTracks();
		const wrapper: TimelineItem = {
			id: 'visual',
			type: 'composition',
			compositionId: 'saved',
			trackId: tracks[0]!.id,
			label: 'Embedded sound',
			from: 0,
			durationInFrames: 30,
			audioDetached: legacy ? undefined : false
		};
		const project = migrateProjectDocument({
			...createBlankProject(),
			schemaVersion: legacy ? 10 : CURRENT_SCHEMA_VERSION,
			timeline: {
				...createEmptyTimeline(),
				tracks,
				items: [wrapper],
				compositions: [
					{
						id: 'saved',
						name: 'Saved',
						width: 64,
						height: 64,
						fps: 30,
						durationInFrames: 30,
						tracks,
						transitions: [],
						items: [
							{
								id: 'sound',
								type: 'audio',
								trackId: tracks[2]!.id,
								mediaId: 'two-part',
								label: 'Sound',
								from: 0,
								durationInFrames: 30
							}
						]
					}
				]
			}
		}).project;
		project.timeline!.items.push({
			...wrapper,
			id: 'unrelated-audio',
			type: 'audio',
			trackId: tracks[2]!.id,
			audioDetached: undefined
		});
		try {
			const entries = planNestedMixdown(
				project.timeline!.items,
				tracks,
				30,
				[],
				project.timeline!.compositions
			);
			const samples: number[] = [];
			for await (const window of mixAudioWindows(entries, 1))
				for (const sample of window.samples[0]!) samples.push(sample);
			expect(samples[4800], 'both independently owned sources remain audible').toBeCloseTo(0.5, 4);
		} finally {
			URL.revokeObjectURL(url);
		}
	}
);
