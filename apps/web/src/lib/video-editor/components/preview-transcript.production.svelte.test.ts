import { sequenceStore } from '../sequences/sequence-store.svelte';
import { duplicateSequence, switchSequence } from '../sequences/sequence-actions';
import { flushSync } from 'svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { collectAdjustmentLayers } from '../effects/adjustment-layers';
import { commandHistory } from '../timeline/commands/command-store.svelte';

import { splitItemsAtFrame, removeItems } from '../timeline/actions/items';
import { it, expect } from 'vitest';
import type {
	TimelineItem,
	TimelineTrack,
	SubComposition,
	ProjectTimeline
} from '../project/types';
import { render } from 'vitest-browser-svelte';
import PreviewPlayer from './preview-player.svelte';
import { createBlankProject } from '../project/defaults';
import { editorSession } from '../editor.svelte';
import '../../../routes/layout.css';
const nextPaint = () =>
	new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
function saveSnapshot() {
	editorSession.project = { ...editorSession.project!, timeline: sequenceStore.projectTimeline() };
}
// Svelte development array instrumentation hides this transient incomplete-list failure.
// The root test task also runs this file with NODE_ENV=production.
it('keeps the preview mounted while splitting and removing clips in a duplicated mixed sequence', async () => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	const tracks: TimelineTrack[] = Array.from({ length: 14 }, (_, i) => ({
		id: 't' + i,
		name: 't' + i,
		kind: i === 1 ? 'audio' : 'video',
		order: i,
		height: 72,
		visible: true,
		muted: false,
		solo: false,
		locked: false,
		syncLock: true
	}));
	const kinds: TimelineItem['type'][] = [
		'video',
		'audio',
		'subtitle',
		'text',
		'composition',
		'background',
		'video',
		'audio',
		'shape',
		'text',
		'composition',
		'background',
		'video',
		'adjustment'
	];
	const items: TimelineItem[] = kinds.map((type, i) => ({
		id: 'i' + i,
		trackId: 't' + i,
		type,
		label: 'Item' + i,
		from: 0,
		durationInFrames: 300,
		mediaId: 'm' + i,
		sourceStart: 0,
		sourceEnd: 300,
		sourceFps: 30,
		text: 'Text',
		shapeType: 'rectangle',
		fillColor: '#fff',
		fontFamily: 'Arial',
		fontSize: 24,
		color: '#fff'
	}));
	Object.assign(items[13]!, { effects: [], sequenceColorGrade: true });
	items[2]!.captionSource = {
		type: 'transcript',
		clipId: 'i0',
		mediaId: 'm0',
		sourceStartSeconds: 0,
		sourceEndSeconds: 10,
		playbackSpeed: 1
	};
	items[2]!.cues = [
		{
			id: 'cue',
			startFrame: 0,
			endFrame: 300,
			text: 'This is a test',
			words: [
				{ id: 'w1', startFrame: 3, endFrame: 9, text: 'This' },
				{ id: 'w2', startFrame: 10, endFrame: 100, text: 'is a test' }
			]
		}
	];
	Object.assign(items[0], { linkedGroupId: 'g', originId: 'i0' });
	Object.assign(items[1], { linkedGroupId: 'g', originId: 'i0', mediaId: 'm0' });
	Object.assign(items[6], {
		type: 'subtitle',
		captionSource: {
			type: 'ai-captions',
			clipId: 'i3',
			mediaId: 'm3',
			sourceStartSeconds: 0,
			sourceEndSeconds: 10,
			playbackSpeed: 1
		},
		cues: structuredClone(items[2]!.cues)
	});
	tracks[9]!.locked = true;
	tracks[10]!.syncLock = false;
	sequenceStore.reset();
	const inner: SubComposition = {
		id: 'inner',
		name: 'Inner',
		editorKind: 'sequence',
		items: [
			{
				id: 'inner-shape',
				label: 'Inner shape',
				type: 'shape',
				trackId: 'inner-track',
				from: 0,
				durationInFrames: 300
			}
		],
		tracks: [{ ...tracks[0]!, id: 'inner-track' }],
		transitions: [],
		fps: 30,
		width: 1920,
		height: 1080,
		durationInFrames: 300
	};
	for (const item of items) if (item.type === 'composition') item.compositionId = 'inner';
	const source: SubComposition = {
		id: 'template',
		name: 'Template',
		editorKind: 'sequence',
		items,
		tracks,
		transitions: [],
		fps: 30,
		width: 1920,
		height: 1080,
		durationInFrames: 300
	};
	const main: ProjectTimeline = {
		items: [
			{
				id: 'main-wrapper',
				label: 'Main wrapper',
				type: 'composition',
				compositionId: 'template',
				trackId: 'main-track',
				from: 0,
				durationInFrames: 300
			}
		],
		tracks: [{ ...tracks[0]!, id: 'main-track' }],
		compositions: [source, inner],
		topLevelSequenceIds: ['template']
	};
	const project = createBlankProject('Mounted probe');
	project.timeline = main;
	editorSession.project = project;
	sequenceStore.load(main, { width: 1920, height: 1080, fps: 30 });
	flushSync();
	const duplicateId = duplicateSequence('template');
	if (!duplicateId) throw Error('duplicate failed');
	switchSequence(duplicateId);
	saveSnapshot();
	flushSync();
	const screen = await render(PreviewPlayer, { onedit: () => {} });
	await nextPaint();
	try {
		const target = timelineStore.items.find((i) => i.type === 'text' && i.label === 'Item3');
		if (!target) throw new Error('Missing title clip');
		splitItemsAtFrame(9, [target.id]);
		const middle = splitItemsAtFrame(3, [target.id]);
		removeItems(middle.right);
		collectAdjustmentLayers(timelineStore.items, timelineStore.tracks);
		saveSnapshot();
		flushSync();
		await nextPaint();
		expect(timelineStore.itemById.get(target.id)?.durationInFrames).toBe(3);
		expect(screen.container.querySelector('canvas')).not.toBeNull();
	} finally {
		await screen.unmount();
		timelineStore.__resetForTesting();
		sequenceStore.reset();
		editorSession.project = null;
		commandHistory.clearHistory();
	}
}, 30000);
