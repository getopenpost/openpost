import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyTimeline } from '../project/defaults';
import type { SubComposition, TimelineItem, TimelineTrack } from '../project/types';
import { transitionsStore } from '../timeline/actions/transitions.svelte';
import { commandHistory, execute } from '../timeline/commands/command-store.svelte';
import { setCurrentFrame } from '../timeline/actions/items';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import {
	createCompositeComposition,
	createCompoundClip,
	createSequence,
	deleteSequence,
	deleteSequences,
	duplicateSequence,
	dissolveCompoundClip,
	nestSequence,
	nestSequenceOnExactTracks,
	sequenceDeletionImpact,
	sequenceDeletionImpactFor,
	switchSequence,
	updateCompositeCompositionCanvas
} from './sequence-actions';
import { sequenceStore } from './sequence-store.svelte';

function track(id: string, kind: 'video' | 'audio', order: number): TimelineTrack {
	return {
		id,
		name: id,
		kind,
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order
	};
}

function item(extra: Partial<TimelineItem>): TimelineItem {
	return {
		id: 'clip',
		trackId: 'video',
		from: 0,
		durationInFrames: 30,
		label: 'Clip',
		type: 'video',
		...extra
	};
}

function composition(id: string, items: TimelineItem[] = []): SubComposition {
	return {
		id,
		name: id,
		editorKind: 'sequence',
		items,
		tracks: [track(`${id}-video`, 'video', 0), track(`${id}-audio`, 'audio', 1)],
		transitions: [],
		fps: 30,
		width: 1920,
		height: 1080,
		durationInFrames: items.reduce(
			(max, candidate) => Math.max(max, candidate.from + candidate.durationInFrames),
			0
		)
	};
}

beforeEach(() => {
	commandHistory.clearHistory();
	sequenceStore.reset();
	timelineStore.__resetForTesting();
	transitionsStore.clear();
	sequenceStore.load(
		{
			...createEmptyTimeline(),
			tracks: [track('video', 'video', 0), track('audio', 'audio', 1)]
		},
		{ width: 1920, height: 1080, fps: 30 }
	);
});

describe('sequence navigation', () => {
	it('creates an isolated empty Motion composition with an editable duration', () => {
		const id = createCompositeComposition({
			name: 'Lower third',
			width: 1080,
			height: 1080,
			fps: 60,
			durationInFrames: 360
		});
		const composition = sequenceStore.compositionById.get(id);

		expect(composition).toMatchObject({
			name: 'Lower third',
			editorKind: 'composite-2d',
			width: 1080,
			height: 1080,
			fps: 60,
			durationInFrames: 360,
			items: [],
			tracks: []
		});
		expect(sequenceStore.topLevelSequenceIds).not.toContain(id);
		commandHistory.undo();
		expect(sequenceStore.compositionById.has(id)).toBe(false);

		const reopenedId = createCompositeComposition({
			name: 'Empty title card',
			width: 1920,
			height: 1080,
			fps: 30,
			durationInFrames: 300
		});
		expect(
			updateCompositeCompositionCanvas(reopenedId, {
				width: 1080,
				height: 1920,
				backgroundColor: '#123456'
			})
		).toBe(true);
		expect(sequenceStore.compositionById.get(reopenedId)).toMatchObject({
			width: 1080,
			height: 1920,
			backgroundColor: '#123456'
		});
		commandHistory.undo();
		expect(sequenceStore.compositionById.get(reopenedId)).toMatchObject({
			width: 1920,
			height: 1080
		});
		expect(switchSequence(reopenedId)).toBe(true);
		expect(switchSequence(null)).toBe(true);
		expect(sequenceStore.compositionById.get(reopenedId)?.durationInFrames).toBe(300);
	});

	it('keeps Motion compositions out of editorial tabs while allowing focused editing', () => {
		const sequence = composition('sequence');
		const motion = {
			...composition('motion'),
			editorKind: 'composite-2d' as const
		};
		sequenceStore.load(
			{
				...createEmptyTimeline(),
				tracks: [track('video', 'video', 0), track('audio', 'audio', 1)],
				compositions: [sequence, motion],
				topLevelSequenceIds: [sequence.id, motion.id]
			},
			{ width: 1920, height: 1080, fps: 30 }
		);

		expect(sequenceStore.topLevelSequenceIds).toEqual([sequence.id]);
		expect(sequenceStore.promoteToTab(motion.id)).toBe(false);
		expect(switchSequence(motion.id)).toBe(true);
		expect(sequenceStore.activeSequence?.editorKind).toBe('composite-2d');
	});

	it('creates a promoted sequence and restores each tab playhead', () => {
		const id = createSequence('Alt cut');
		expect(sequenceStore.topLevelSequenceIds).toEqual([id]);
		expect(sequenceStore.compositionById.get(id)?.name).toBe('Alt cut');

		setCurrentFrame(42);
		expect(switchSequence(id)).toBe(true);
		expect(timelineStore.currentFrame).toBe(0);
		setCurrentFrame(11);
		expect(switchSequence(null)).toBe(true);
		expect(timelineStore.currentFrame).toBe(42);
		expect(switchSequence(id)).toBe(true);
		expect(timelineStore.currentFrame).toBe(11);
	});

	it('flushes edited sequence contents into the project document', () => {
		const id = createSequence('Scene');
		switchSequence(id);
		timelineStore._setItems([item({ id: 'inside', trackId: 'track-video-main' })]);
		const saved = sequenceStore.projectTimeline();
		expect(saved.items).toEqual([]);
		expect(saved.compositions?.find((entry) => entry.id === id)?.items[0]?.id).toBe('inside');
	});

	it('keeps separate master bus settings for the root and each sequence', () => {
		timelineStore._setMasterVolumeDb(-3);
		const id = createSequence('Mix pass');
		expect(switchSequence(id)).toBe(true);
		timelineStore._setMasterVolumeDb(4);
		timelineStore._setMasterMuted(true);

		expect(switchSequence(null)).toBe(true);
		expect(timelineStore.masterVolumeDb).toBe(-3);
		expect(timelineStore.masterMuted).toBe(false);
		const saved = sequenceStore.projectTimeline();
		const sequence = saved.compositions?.find((entry) => entry.id === id);
		expect(saved.masterVolumeDb).toBe(-3);
		expect(sequence?.masterVolumeDb).toBe(4);
		expect(sequence?.masterMuted).toBe(true);
	});
});

describe('compound clips', () => {
	it('duplicates owned content and reports root and nested deletion impact', () => {
		const nested = composition('nested', [
			item({
				id: 'nested-title',
				trackId: 'nested-video',
				type: 'text',
				mediaId: undefined
			})
		]);
		const source = composition('source', [
			item({
				id: 'source-video',
				trackId: 'source-video',
				mediaId: 'shared-media'
			}),
			item({
				id: 'source-nested',
				trackId: 'source-video',
				from: 30,
				type: 'composition',
				mediaId: undefined,
				compositionId: nested.id
			})
		]);
		const host = composition('host', [
			item({
				id: 'host-reference',
				trackId: 'host-video',
				type: 'composition',
				compositionId: source.id
			})
		]);
		sequenceStore.load(
			{
				...createEmptyTimeline(),
				tracks: [track('video', 'video', 0), track('audio', 'audio', 1)],
				items: [
					item({
						id: 'root-reference',
						type: 'composition',
						compositionId: source.id
					})
				],
				compositions: [nested, source, host],
				topLevelSequenceIds: [source.id]
			},
			{ width: 1920, height: 1080, fps: 30 }
		);

		expect(sequenceDeletionImpact(source.id)).toEqual({
			rootReferenceCount: 1,
			nestedReferenceCount: 1,
			totalReferenceCount: 2
		});
		const duplicateId = duplicateSequence(source.id);
		expect(duplicateId).not.toBeNull();
		const duplicate = sequenceStore.compositionById.get(duplicateId!);
		expect(duplicate?.name).toBe('source copy');
		expect(duplicate?.id).not.toBe(source.id);
		expect(duplicate?.tracks[0]?.id).not.toBe(source.tracks[0]?.id);
		expect(duplicate?.items[0]?.id).not.toBe(source.items[0]?.id);
		expect(duplicate?.items[0]?.mediaId).toBe('shared-media');
		expect(duplicate?.items[1]?.compositionId).toBe(nested.id);
		expect(sequenceStore.topLevelSequenceIds).toContain(duplicateId);

		commandHistory.undo();
		expect(sequenceStore.compositionById.has(duplicateId!)).toBe(false);
		expect(sequenceStore.compositionById.has(source.id)).toBe(true);
	});

	it('moves linked visual and audio items into one reusable composition', () => {
		const visual = item({
			id: 'visual',
			linkedGroupId: 'pair',
			mediaId: 'media'
		});
		const audio = item({
			id: 'audio-item',
			type: 'audio',
			trackId: 'audio',
			linkedGroupId: 'pair',
			mediaId: 'media'
		});
		timelineStore._setItems([visual, audio]);
		transitionsStore.setAll([]);
		const compositionId = createCompoundClip(['visual'], 'Interview');
		expect(compositionId).not.toBeNull();
		const stored = sequenceStore.compositionById.get(compositionId!);
		expect(stored?.items.map((entry) => entry.id)).toEqual(['visual', 'audio-item']);
		expect(timelineStore.items).toHaveLength(2);
		expect(timelineStore.items.every((entry) => entry.compositionId === compositionId)).toBe(true);
		expect(new Set(timelineStore.items.map((entry) => entry.linkedGroupId)).size).toBe(1);

		commandHistory.undo();
		expect(sequenceStore.compositionById.has(compositionId!)).toBe(false);
		expect(timelineStore.items.map((entry) => entry.id)).toEqual(['visual', 'audio-item']);
	});

	it('places a compound wrapper on another visual track when its span contains an unselected item', () => {
		timelineStore._setItems([
			item({ id: 'left', from: 0, durationInFrames: 30 }),
			item({ id: 'blocker', from: 30, durationInFrames: 30 }),
			item({ id: 'right', from: 60, durationInFrames: 30 })
		]);

		const compositionId = createCompoundClip(['left', 'right'], 'Selected clips');
		const visualWrapper = timelineStore.items.find(
			(entry) => entry.type === 'composition' && entry.compositionId === compositionId
		);

		expect(visualWrapper?.trackId).not.toBe('video');
		expect(timelineStore.itemById.get('blocker')?.trackId).toBe('video');
		expect(timelineStore.tracks).toHaveLength(3);
		commandHistory.undo();
		expect(timelineStore.tracks).toHaveLength(2);
		expect(timelineStore.items.map((entry) => entry.id)).toEqual(['left', 'blocker', 'right']);
	});

	it('cuts transform relationships cleanly at a new composition boundary', () => {
		const parent = item({
			id: 'parent',
			transform: { x: 20, y: 0, width: 100, height: 100 }
		});
		const child = item({
			id: 'child',
			transform: { x: 40, y: 0, width: 100, height: 100 },
			transformParent: {
				parentItemId: 'parent',
				parentReference: { x: 20, y: 0, width: 100, height: 100, rotation: 0 },
				childLocalReference: {
					x: 40,
					y: 0,
					width: 100,
					height: 100,
					rotation: 0
				},
				childWorldReference: {
					x: 40,
					y: 0,
					width: 100,
					height: 100,
					rotation: 0
				}
			}
		});
		timelineStore._setItems([parent, child]);

		const parentCompositionId = createCompoundClip(['parent']);
		expect(timelineStore.itemById.get('child')?.transformParent?.parentItemId).toBeUndefined();
		expect(sequenceStore.compositionById.get(parentCompositionId!)?.items[0]?.id).toBe('parent');

		commandHistory.undo();
		const childCompositionId = createCompoundClip(['child']);
		expect(
			sequenceStore.compositionById.get(childCompositionId!)?.items[0]?.transformParent
				?.parentItemId
		).toBeUndefined();
		expect(timelineStore.itemById.has('parent')).toBe(true);
	});

	it('dissolves a wrapper with fresh ids and restores internal transitions', () => {
		const left = item({ id: 'left', durationInFrames: 15 });
		const right = item({ id: 'right', from: 15, durationInFrames: 15 });
		timelineStore._setItems([left, right]);
		transitionsStore.setAll([
			{
				id: 'transition',
				type: 'crossfade',
				durationInFrames: 4,
				fromItemId: 'left',
				toItemId: 'right'
			}
		]);
		const compositionId = createCompoundClip(['left', 'right']);
		const wrapper = timelineStore.items.find((entry) => entry.type === 'composition')!;
		const restoredIds = dissolveCompoundClip(wrapper.id);
		expect(restoredIds).toHaveLength(2);
		expect(restoredIds).not.toContain('left');
		expect(transitionsStore.list).toHaveLength(1);
		expect(transitionsStore.list[0]?.fromItemId).toBe(restoredIds[0]);
		expect(sequenceStore.compositionById.has(compositionId!)).toBe(true);
	});

	it('remaps internal property links and transform parents when dissolving', () => {
		const parent = item({
			id: 'parent',
			transform: { x: 20, y: 0, width: 100, height: 100 }
		});
		const child = item({
			id: 'child',
			from: 15,
			transform: { x: 40, y: 0, width: 100, height: 100 },
			propertyLinks: [
				{
					type: 'link',
					sourceItemId: 'parent',
					sourceProperty: 'opacity',
					targetProperty: 'opacity',
					enabled: true,
					timeOffsetFrames: 0
				}
			],
			transformParent: {
				parentItemId: 'parent',
				parentReference: { x: 20, y: 0, width: 100, height: 100, rotation: 0 },
				childLocalReference: {
					x: 40,
					y: 0,
					width: 100,
					height: 100,
					rotation: 0
				},
				childWorldReference: {
					x: 40,
					y: 0,
					width: 100,
					height: 100,
					rotation: 0
				}
			}
		});
		timelineStore._setItems([parent, child]);
		createCompoundClip(['parent', 'child']);
		const wrapper = timelineStore.items.find((entry) => entry.type === 'composition')!;
		const restoredIds = dissolveCompoundClip(wrapper.id);
		const restored = restoredIds.map((id) => timelineStore.itemById.get(id)!);
		const restoredParent = restored.find((entry) => entry.originId === 'parent')!;
		const restoredChild = restored.find((entry) => entry.originId === 'child')!;

		expect(restoredChild.propertyLinks?.[0]?.sourceItemId).toBe(restoredParent.id);
		expect(restoredChild.transformParent?.parentItemId).toBe(restoredParent.id);
	});

	it('maps a trimmed retimed wrapper window back to child source frames', () => {
		const source = item({
			id: 'source',
			from: 10,
			durationInFrames: 30,
			sourceStart: 100,
			sourceEnd: 160,
			sourceFps: 60,
			speed: 2
		});
		timelineStore._setItems([source]);
		const compositionId = createCompoundClip(['source']);
		const wrapper = timelineStore.items.find((entry) => entry.type === 'composition')!;
		timelineStore._setItems([
			{
				...wrapper,
				from: 90,
				durationInFrames: 10,
				sourceStart: 5,
				sourceEnd: 25,
				sourceFps: 30,
				speed: 2
			}
		]);

		const [restoredId] = dissolveCompoundClip(wrapper.id);
		const restored = timelineStore.itemById.get(restoredId!);
		expect(restored).toMatchObject({
			from: 90,
			durationInFrames: 10,
			sourceStart: 120,
			sourceEnd: 140,
			speed: 4
		});
		expect(sequenceStore.compositionById.has(compositionId!)).toBe(true);
	});

	it('uses a nested child sequence fps when dissolving a trimmed parent', () => {
		sequenceStore.addComposition({
			...composition('child'),
			fps: 60,
			durationInFrames: 120
		});
		sequenceStore.addComposition(
			composition('parent', [
				item({
					id: 'child-wrapper',
					type: 'composition',
					trackId: 'parent-video',
					compositionId: 'child',
					sourceStart: 20,
					sourceEnd: 100,
					sourceFps: undefined,
					durationInFrames: 30
				})
			])
		);
		timelineStore._setItems([
			item({
				id: 'parent-wrapper',
				type: 'composition',
				compositionId: 'parent',
				sourceStart: 5,
				sourceEnd: 25,
				sourceFps: 30,
				speed: 2,
				durationInFrames: 10
			})
		]);

		const [restoredId] = dissolveCompoundClip('parent-wrapper');
		expect(timelineStore.itemById.get(restoredId!)?.sourceStart).toBe(30);
	});

	it('does not map restored audio onto an id-colliding video track', () => {
		sequenceStore.addComposition({
			...composition('audio-composition', [
				item({
					id: 'inside-audio',
					type: 'audio',
					trackId: 'video',
					mediaId: 'voice'
				})
			]),
			tracks: [track('video', 'audio', 0)],
			durationInFrames: 30
		});
		timelineStore._setItems([
			item({
				id: 'audio-wrapper',
				type: 'audio',
				trackId: 'audio',
				compositionId: 'audio-composition'
			})
		]);

		const [restoredId] = dissolveCompoundClip('audio-wrapper');
		const restored = timelineStore.itemById.get(restoredId!);
		expect(restored?.trackId).not.toBe('video');
		expect(timelineStore.tracks.find((entry) => entry.id === restored?.trackId)?.kind).toBe(
			'audio'
		);
	});

	it('blocks direct and indirect nesting cycles', () => {
		const a = composition('a');
		const b = composition('b', [
			item({
				id: 'a-in-b',
				type: 'composition',
				trackId: 'b-video',
				compositionId: 'a'
			})
		]);
		sequenceStore.addComposition(a, true);
		sequenceStore.addComposition(b, true);
		switchSequence('a');
		expect(() => nestSequence('a')).toThrow('cannot contain itself');
		expect(() => nestSequence('b')).toThrow('cannot contain itself');
	});

	it('nests a sequence on another visual track when the preferred range is occupied', () => {
		const nested = composition('nested', [item({ id: 'inside' })]);
		sequenceStore.addComposition(nested, true);
		timelineStore._setItems([
			item({ id: 'occupied', from: 40, durationInFrames: 20 }),
			item({ id: 'audio-mix', trackId: 'audio', type: 'audio', from: 40, durationInFrames: 20 })
		]);

		const ids = nestSequence('nested', 45);
		const wrappers = ids.map((id) => timelineStore.itemById.get(id));
		const visualWrapper = wrappers.find((candidate) => candidate?.type === 'composition');
		const audioWrapper = wrappers.find((candidate) => candidate?.type === 'audio');

		expect(visualWrapper?.trackId).not.toBe('video');
		expect(audioWrapper?.trackId).toBe('audio');
		expect(timelineStore.tracks).toHaveLength(3);
		commandHistory.undo();
		expect(timelineStore.tracks).toHaveLength(2);
		expect(timelineStore.items.map((entry) => entry.id)).toEqual(['occupied', 'audio-mix']);
	});

	it('nests linked visual and audio wrappers on exact open tracks as one undo step', () => {
		const nested = composition('nested', [item({ id: 'inside' })]);
		sequenceStore.addComposition(nested, true);

		const ids = nestSequenceOnExactTracks('nested', 45, {
			visualTrackId: 'video',
			audioTrackId: 'audio'
		});
		expect(ids).toHaveLength(2);
		expect(timelineStore.items).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: 'composition',
					trackId: 'video',
					from: 45,
					compositionId: 'nested'
				}),
				expect.objectContaining({
					type: 'audio',
					trackId: 'audio',
					from: 45,
					compositionId: 'nested'
				})
			])
		);
		expect(new Set(timelineStore.items.map((candidate) => candidate.linkedGroupId)).size).toBe(1);
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.items).toHaveLength(0);
	});

	it('rejects an occupied exact sequence track without partial wrappers or history', () => {
		const nested = composition('nested', [item({ id: 'inside' })]);
		sequenceStore.addComposition(nested, true);
		timelineStore._addItem(item({ id: 'occupied', from: 40, durationInFrames: 20 }));
		commandHistory.clearHistory();

		expect(() =>
			nestSequenceOnExactTracks('nested', 45, {
				visualTrackId: 'video',
				audioTrackId: 'audio'
			})
		).toThrow('occupied');
		expect(timelineStore.items.map((candidate) => candidate.id)).toEqual(['occupied']);
		expect(commandHistory.canUndo).toBe(false);
	});

	it('deletes references from Main and every nested sequence', () => {
		const target = composition('target');
		const host = composition('host', [
			item({
				id: 'nested-target',
				type: 'composition',
				trackId: 'host-video',
				compositionId: 'target'
			})
		]);
		sequenceStore.addComposition(target, true);
		sequenceStore.addComposition(host, true);
		timelineStore._setItems([
			item({ id: 'root-target', type: 'composition', compositionId: 'target' })
		]);
		transitionsStore.setAll([
			{
				id: 'orphan-after-delete',
				type: 'crossfade',
				durationInFrames: 3,
				fromItemId: 'root-target',
				toItemId: 'root-target'
			}
		]);

		expect(deleteSequence('target')).toBe(true);
		expect(sequenceStore.compositionById.has('target')).toBe(false);
		expect(sequenceStore.compositionById.get('host')?.items).toEqual([]);
		expect(timelineStore.items).toEqual([]);
		expect(transitionsStore.list).toEqual([]);

		commandHistory.undo();
		expect(sequenceStore.compositionById.has('target')).toBe(true);
		expect(timelineStore.items[0]?.compositionId).toBe('target');
	});

	it('deletes several sequences and all external references as one undoable edit', () => {
		const second = composition('second');
		const first = composition('first', [
			item({
				id: 'first-second',
				type: 'composition',
				trackId: 'first-video',
				compositionId: second.id
			})
		]);
		const host = composition('host', [
			item({
				id: 'host-first',
				type: 'composition',
				trackId: 'host-video',
				compositionId: first.id
			}),
			item({
				id: 'host-second',
				type: 'composition',
				trackId: 'host-video',
				compositionId: second.id
			})
		]);
		sequenceStore.addComposition(first, true);
		sequenceStore.addComposition(second, true);
		sequenceStore.addComposition(host, true);
		timelineStore._setItems([
			item({ id: 'root-first', type: 'composition', compositionId: first.id })
		]);
		expect(switchSequence(second.id)).toBe(true);
		commandHistory.clearHistory();
		expect(sequenceDeletionImpactFor([first.id, second.id])).toEqual({
			rootReferenceCount: 1,
			nestedReferenceCount: 2,
			totalReferenceCount: 3
		});

		expect(deleteSequences([first.id, second.id])).toEqual([first.id, second.id]);
		expect(sequenceStore.activeSequenceId).toBeNull();
		expect(sequenceStore.compositions.map((candidate) => candidate.id)).toEqual([host.id]);
		expect(sequenceStore.compositionById.get(host.id)?.items).toEqual([]);
		expect(timelineStore.items).toEqual([]);
		expect(commandHistory.undoStack).toHaveLength(1);

		commandHistory.undo();
		expect(sequenceStore.compositions.map((candidate) => candidate.id)).toEqual([
			first.id,
			second.id,
			host.id
		]);
		expect(sequenceStore.compositionById.get(host.id)?.items).toHaveLength(2);
		expect(timelineStore.items[0]?.compositionId).toBe(first.id);
	});

	it('keeps undo history isolated between Main and a sequence tab', () => {
		const id = createSequence('Cutaway');
		timelineStore._setItems([item({ id: 'root-base' })]);
		execute('ROOT_EDIT', () => {
			timelineStore._setItems([...timelineStore.items, item({ id: 'root-edit', from: 30 })]);
		});
		switchSequence(id);
		execute('SEQUENCE_EDIT', () => {
			timelineStore._setItems([item({ id: 'sequence-edit', trackId: 'track-video-main' })]);
		});

		commandHistory.undo();
		expect(timelineStore.items).toEqual([]);
		switchSequence(null);
		expect(commandHistory.getLastCommandType()).toBe('ROOT_EDIT');
		commandHistory.undo();
		expect(timelineStore.items.map((entry) => entry.id)).toEqual(['root-base']);
	});

	it('does not roll back newer Main edits when undoing an older sequence edit', () => {
		const id = createSequence('Cutaway');
		switchSequence(id);
		execute('SEQUENCE_EDIT', () => {
			timelineStore._setItems([item({ id: 'sequence-edit', trackId: 'track-video-main' })]);
		});
		switchSequence(null);
		execute('ROOT_EDIT', () => {
			timelineStore._setItems([item({ id: 'newer-root-edit' })]);
		});
		switchSequence(id);

		commandHistory.undo();
		expect(timelineStore.items).toEqual([]);
		switchSequence(null);
		expect(timelineStore.items.map((entry) => entry.id)).toEqual(['newer-root-edit']);
	});
});
