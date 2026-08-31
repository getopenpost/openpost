import { describe, expect, it } from 'vitest';
import type { SubComposition, TimelineItem, TimelineTrack } from '../project/types';
import { planMixdown, planNestedMixdown } from './render-plan';
import { assessSmartCopy } from './smart-copy-plan';
import type { MediaMetadata } from './types';
import {
	captureSnapshot,
	restoreSnapshot,
	snapshotsEqual
} from '../timeline/commands/snapshot.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { transitionsStore } from '../timeline/actions/transitions.svelte';
import type { Project } from '../project/types';
import { isAudioEqStageActive, resolveAudioEqSettings } from '../audio/audio-eq';
import {
	previewAudioEqStagesForTimeline,
	requiresProcessedPreviewAudioForTimeline
} from '../audio/preview-processing';

function track(id: string, extra: Partial<TimelineTrack> = {}): TimelineTrack {
	return {
		id,
		name: id,
		kind: 'audio',
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order: 0,
		...extra
	};
}

function item(extra: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'clip',
		trackId: 'track-audio',
		from: 0,
		durationInFrames: 60,
		label: '',
		type: 'audio',
		mediaId: 'media',
		...extra
	};
}

describe('audio EQ data plumbing', () => {
	it('uses bus -> track -> clip stages to select processed live preview audio', () => {
		const bus = { lowGainDb: 1 };
		const trk = track('track-audio', { audioEq: { highGainDb: 2 } });
		const clip = item({ trackId: trk.id, audioEqLowMidGainDb: 3 });

		const stages = previewAudioEqStagesForTimeline(clip, [trk], bus);
		expect(stages).toHaveLength(3);
		expect(stages[0]?.lowGainDb).toBe(1);
		expect(stages[1]?.highGainDb).toBe(2);
		expect(stages[2]?.lowMidGainDb).toBe(3);
		expect(requiresProcessedPreviewAudioForTimeline(clip, [trk], bus)).toBe(true);

		const disabledTrack = track('track-audio', {
			audioEq: { enabled: false, highGainDb: 8 }
		});
		expect(
			requiresProcessedPreviewAudioForTimeline(item(), [disabledTrack], {
				enabled: false,
				lowGainDb: 8
			})
		).toBe(false);
	});

	it('orders mix stages as bus -> track -> clip for root', () => {
		const bus = { lowGainDb: 3 };
		const trk = track('track-audio', { audioEq: { highGainDb: 4 } });
		const clip = item({ audioEqLowGainDb: 5, trackId: 'track-audio' });
		const [entry] = planMixdown([clip], [trk], 30, [], bus);
		expect(entry.audioEqStages).toHaveLength(3);
		expect(entry.audioEqStages[0]?.lowGainDb).toBe(resolveAudioEqSettings(bus).lowGainDb);
		expect(entry.audioEqStages[1]?.highGainDb).toBe(resolveAudioEqSettings(trk.audioEq).highGainDb);
		expect(entry.audioEqStages[2]?.lowGainDb).toBe(resolveAudioEqSettings(clip).lowGainDb);
	});

	it('preserves exact stage order for nested compositions outer->inner', () => {
		const rootBus = { lowGainDb: 1 };
		const rootTrack = track('root-audio', { audioEq: { lowGainDb: 2 } });
		const wrapper = item({
			id: 'wrapper',
			trackId: 'root-audio',
			type: 'composition',
			compositionId: 'nested',
			from: 0,
			durationInFrames: 60,
			sourceStart: 0,
			sourceEnd: 120,
			volume: 1,
			audioEqLowMidGainDb: 3
		});
		const nestedBus = { highGainDb: 4 };
		const nestedTrack = track('nested-audio', { audioEq: { highGainDb: 5 } });
		const leaf = item({
			id: 'leaf',
			trackId: 'nested-audio',
			type: 'audio',
			from: 10,
			durationInFrames: 40,
			mediaId: 'voice',
			audioEqHighMidGainDb: 6
		});
		const nested: SubComposition = {
			id: 'nested',
			name: 'Nested',
			items: [leaf],
			tracks: [nestedTrack],
			transitions: [],
			fps: 30,
			width: 1920,
			height: 1080,
			durationInFrames: 120,
			busAudioEq: nestedBus
		};
		const entries = planNestedMixdown([wrapper], [rootTrack], 30, [], [nested], new Set(), rootBus);
		expect(entries).toHaveLength(1);
		const stages = entries[0]!.audioEqStages;
		// expected: rootBus -> rootTrack -> wrapper -> nestedBus -> nestedTrack -> leaf
		expect(stages).toHaveLength(6);
		expect(stages[0]?.lowGainDb).toBe(resolveAudioEqSettings(rootBus).lowGainDb);
		expect(stages[1]?.lowGainDb).toBe(resolveAudioEqSettings(rootTrack.audioEq).lowGainDb);
		expect(stages[2]?.lowMidGainDb).toBe(resolveAudioEqSettings(wrapper).lowMidGainDb);
		expect(stages[3]?.highGainDb).toBe(resolveAudioEqSettings(nestedBus).highGainDb);
		expect(stages[4]?.highGainDb).toBe(resolveAudioEqSettings(nestedTrack.audioEq).highGainDb);
		expect(stages[5]?.highMidGainDb).toBe(resolveAudioEqSettings(leaf).highMidGainDb);
	});

	it('blocks smart copy when track EQ or bus EQ active', () => {
		const baseTrack: TimelineTrack = {
			id: 'video-track',
			name: 'Video',
			kind: 'video',
			height: 64,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			order: 0
		};
		const baseItem: TimelineItem = {
			id: 'video',
			trackId: baseTrack.id,
			from: 0,
			durationInFrames: 100,
			label: '',
			type: 'video',
			mediaId: 'source',
			sourceStart: 0,
			sourceEnd: 100,
			sourceDuration: 100,
			sourceFps: 30,
			sourceWidth: 1920,
			sourceHeight: 1080
		};
		const media: MediaMetadata = {
			id: 'source',
			storageType: 'workspace',
			fileName: 'clip.webm',
			fileSize: 1000,
			mimeType: 'video/webm',
			duration: 3.33,
			width: 1920,
			height: 1080,
			fps: 30,
			codec: 'vp9',
			audioCodec: 'opus',
			bitrate: 1000,
			keyframeTimestamps: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.33],
			tags: ['video']
		};
		const projectFor = (
			tracks: TimelineTrack[],
			bus?: import('../audio/types').AudioEqSettings
		): Project => ({
			id: 'p',
			name: 'P',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 10,
			metadata: { width: 1920, height: 1080, fps: 30 },
			timeline: {
				tracks,
				items: [baseItem],
				transitions: [],
				busAudioEq: bus
			}
		});
		const activeTrack = { ...baseTrack, audioEq: { lowGainDb: 3 } };
		expect(
			assessSmartCopy(
				projectFor([activeTrack]),
				{ format: 'webm', codec: 'vp9', width: 1920, height: 1080 },
				[media]
			)
		).toEqual({ eligible: false, blocker: 'edited-audio' });

		const busActive = { highGainDb: 2 };
		expect(
			assessSmartCopy(
				projectFor([baseTrack], busActive),
				{ format: 'webm', codec: 'vp9', width: 1920, height: 1080 },
				[media]
			)
		).toEqual({ eligible: false, blocker: 'edited-audio' });

		const compBusActive: Project = {
			id: 'p',
			name: 'P',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 10,
			metadata: { width: 1920, height: 1080, fps: 30 },
			timeline: {
				tracks: [baseTrack],
				items: [baseItem],
				transitions: [],
				compositions: [
					{
						id: 'comp',
						name: 'Comp',
						items: [],
						tracks: [],
						transitions: [],
						fps: 30,
						width: 1920,
						height: 1080,
						durationInFrames: 0,
						busAudioEq: { lowGainDb: 3 }
					}
				]
			}
		};
		expect(
			assessSmartCopy(compBusActive, { format: 'webm', codec: 'vp9', width: 1920, height: 1080 }, [
				media
			])
		).toEqual({ eligible: false, blocker: 'edited-audio' });
	});

	it('snapshots capture and restore busAudioEq atomically with tracks', () => {
		timelineStore.__resetForTesting();
		sequenceStore.reset();
		transitionsStore.setAll([]);
		timelineStore.setAll({
			items: [item({ id: 'a' })],
			tracks: [track('track-audio', { audioEq: { lowGainDb: 2 } })],
			busAudioEq: { highGainDb: 3 }
		});
		const before = captureSnapshot();
		expect(before.busAudioEq?.highGainDb).toBe(3);
		expect(before.tracks[0]?.audioEq?.lowGainDb).toBe(2);
		expect(isAudioEqStageActive(resolveAudioEqSettings(before.busAudioEq))).toBe(true);

		timelineStore._setBusAudioEq({ lowGainDb: 9 });
		timelineStore._setTracks([track('track-audio', { audioEq: { lowGainDb: 9 } })]);
		const after = captureSnapshot();
		expect(after.busAudioEq?.lowGainDb).toBe(9);
		expect(snapshotsEqual(before, after)).toBe(false);

		restoreSnapshot(before);
		expect(timelineStore.busAudioEq?.highGainDb).toBe(3);
		expect(timelineStore.tracks[0]?.audioEq?.lowGainDb).toBe(2);
	});

	it('snapshot undo clears a bus EQ created from an empty project', () => {
		timelineStore.__resetForTesting();
		sequenceStore.reset();
		transitionsStore.setAll([]);
		timelineStore.setAll({ items: [item()], tracks: [track('track-audio')] });
		const before = captureSnapshot();

		timelineStore._setBusAudioEq({ lowGainDb: 4 });
		expect(timelineStore.busAudioEq?.lowGainDb).toBe(4);
		restoreSnapshot(before);
		expect(timelineStore.busAudioEq).toBeUndefined();
	});

	it('planMixdown includes bus stage in export even when muted tracks excluded', () => {
		const bus = { highGainDb: 6 };
		const muted = track('muted', { muted: true, audioEq: { lowGainDb: 9 } });
		const audible = track('track-audio', { audioEq: { lowGainDb: 3 } });
		const clipMuted = item({ id: 'muted-clip', trackId: 'muted', mediaId: 'm1' });
		const clipAudible = item({ id: 'audible', trackId: 'track-audio', mediaId: 'm2' });
		const entries = planMixdown([clipMuted, clipAudible], [muted, audible], 30, [], bus);
		expect(entries).toHaveLength(1);
		expect(entries[0]!.itemId).toBe('audible');
		expect(entries[0]!.audioEqStages[0]?.highGainDb).toBe(resolveAudioEqSettings(bus).highGainDb);
	});
});
