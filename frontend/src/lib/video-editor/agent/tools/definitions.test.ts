import { beforeEach, describe, expect, it, vi } from 'vitest';
import { timelineStore } from '../../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../../timeline/commands/command-store.svelte';
import type { TimelineItem, TimelineTrack } from '../../project/types';
import { getEditorTool } from '../registry';
import { buildClipRefs, setClipRefSelectionProvider } from '../clip-refs';
import { setAgentSelectionHandler } from './definitions';

const track: TimelineTrack = {
	id: 'v1',
	name: 'V1',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

beforeEach(() => {
	commandHistory.clearHistory();
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [track], items: [], fps: 30 });
	buildClipRefs();
	setClipRefSelectionProvider(null);
	setAgentSelectionHandler(null);
});

describe('editor tool registry', () => {
	it('validates args at runtime and surfaces typed errors', () => {
		const tool = getEditorTool('set_speed')!;
		expect(tool.validate({ speed: 2 }).ok).toBe(true);
		const bad = tool.validate({ speed: 'fast' });
		expect(bad.ok).toBe(false);
		if (!bad.ok) expect(bad.error).toContain('speed');
	});

	it('exposes destructive and handoff labels', () => {
		expect(getEditorTool('delete_clips')?.destructive).toBe(true);
		expect(getEditorTool('remove_silence')?.handoff).toBe(true);
		expect(getEditorTool('find_clips')?.readOnly).toBe(true);
	});

	it('find_clips returns grounded refs for filtering', async () => {
		const a: TimelineItem = {
			id: 'a',
			trackId: track.id,
			from: 0,
			durationInFrames: 30,
			label: 'Hello',
			type: 'video'
		};
		const b: TimelineItem = {
			id: 'b',
			trackId: track.id,
			from: 30,
			durationInFrames: 30,
			label: 'World',
			type: 'text'
		};
		timelineStore.setAll({ tracks: [track], items: [a, b], fps: 30 });
		buildClipRefs();
		const tool = getEditorTool('find_clips')!;
		const result = await tool.execute({ query: 'hello' });
		expect(result.ok).toBe(true);
		expect(String(result.message)).toContain('c1');
	});

	it('select_clips uses callback and rejects stale refs', async () => {
		const a: TimelineItem = {
			id: 'a',
			trackId: track.id,
			from: 0,
			durationInFrames: 30,
			label: 'Clip',
			type: 'video'
		};
		timelineStore.setAll({ tracks: [track], items: [a], fps: 30 });
		buildClipRefs();
		const handler = vi.fn();
		setAgentSelectionHandler(handler);
		const tool = getEditorTool('select_clips')!;
		await expect(async () => await tool.execute({ clips: ['c99'] })).rejects.toThrow();
		expect(handler).not.toHaveBeenCalled();
		const ok = await tool.execute({ clips: ['c1'] });
		expect(ok.ok).toBe(true);
		expect(handler).toHaveBeenCalledWith(['a']);
	});

	it('delete uses ripple delete and is undoable', async () => {
		const a: TimelineItem = {
			id: 'a',
			trackId: track.id,
			from: 0,
			durationInFrames: 30,
			label: 'Clip',
			type: 'video'
		};
		const b: TimelineItem = {
			id: 'b',
			trackId: track.id,
			from: 30,
			durationInFrames: 30,
			label: 'Clip2',
			type: 'video'
		};
		timelineStore.setAll({ tracks: [track], items: [a, b], fps: 30 });
		buildClipRefs();
		setClipRefSelectionProvider(() => ['a']);
		const tool = getEditorTool('delete_clips')!;
		const before = commandHistory.undoStack.length;
		await tool.execute({ clips: ['c1'] });
		expect(timelineStore.itemById.has('a')).toBe(false);
		expect(commandHistory.undoStack.length).toBeGreaterThan(before);
		commandHistory.undo();
		expect(timelineStore.itemById.has('a')).toBe(true);
	});

	it('set_volume uses public action and is undoable', async () => {
		const a: TimelineItem = {
			id: 'a',
			trackId: track.id,
			from: 0,
			durationInFrames: 30,
			label: 'Clip',
			type: 'video',
			volume: 1
		};
		timelineStore.setAll({ tracks: [track], items: [a], fps: 30 });
		buildClipRefs();
		setClipRefSelectionProvider(() => ['a']);
		const tool = getEditorTool('set_volume')!;
		const before = commandHistory.undoStack.length;
		await tool.execute({ volume: 0.5 });
		expect(timelineStore.itemById.get('a')?.volume).toBe(0.5);
		expect(commandHistory.undoStack.length).toBeGreaterThan(before);
		commandHistory.undo();
		expect(timelineStore.itemById.get('a')?.volume).toBe(1);
	});
});
