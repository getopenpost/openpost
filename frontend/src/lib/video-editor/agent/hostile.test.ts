import { beforeEach, describe, expect, it, vi } from 'vitest';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import type { TimelineTrack, TimelineItem } from '../project/types';
import { getEditorTool } from './registry';
import { buildClipRefs, setClipRefSelectionProvider } from './clip-refs';
import { parsePlan, buildMessages } from './prompt';
import { planRequest } from './service';
import { buildTimelineContext } from './timeline-context';
import type { LlmAdapter } from './llm/types';

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
const lockedTrack: TimelineTrack = { ...track, id: 'locked', name: 'Locked', locked: true };

beforeEach(() => {
	commandHistory.clearHistory();
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [track], items: [], fps: 30 });
	buildClipRefs();
	setClipRefSelectionProvider(null);
});

describe('hostile prompt and plan bounds', () => {
	it('bounds and escapes long injected labels with quotes and newlines', async () => {
		const evilLabel = '\"; DROP TABLE\n'.repeat(20) + 'a'.repeat(500);
		const item: TimelineItem = {
			id: 'a',
			trackId: track.id,
			from: 0,
			durationInFrames: 30,
			label: evilLabel,
			type: 'video'
		};
		timelineStore.setAll({ tracks: [track], items: [item], fps: 30 });
		const ctx = buildTimelineContext([], 0);
		expect(ctx.text.length).toBeLessThanOrEqual(4000);
		expect(ctx.text).not.toContain('"; DROP');
		expect(ctx.text).not.toContain('\n"');
		const messages = buildMessages(
			[{ role: 'user', content: 'hi'.repeat(1000) }],
			'x'.repeat(2000),
			evilLabel.repeat(100)
		);
		const total = messages.map((m) => m.content).join('').length;
		expect(total).toBeLessThanOrEqual(9000);
	});

	it('caps oversized plans to 8 steps and bounds reply', () => {
		const steps = Array.from({ length: 20 }, () => ({ tool: 'find_clips', args: { query: 'a' } }));
		const raw = JSON.stringify({ reply: 'x'.repeat(500), steps });
		const parsed = parsePlan(raw);
		expect(parsed.valid).toBe(true);
		expect(parsed.reply.length).toBeLessThanOrEqual(203);
		expect(parsed.steps.length).toBeLessThanOrEqual(8);
		for (const step of parsed.steps) {
			const query = (step.args as Record<string, unknown>).query as string | undefined;
			if (query) expect(query.length).toBeLessThanOrEqual(500);
		}
	});

	it('rejects non-word tool names and oversized arg keys', () => {
		const raw = JSON.stringify({
			reply: 'hi',
			steps: [
				{ tool: 'bad-tool!', args: { a: '1' } },
				{ tool: 'find_clips', args: { ['x'.repeat(50)]: 'y' } }
			]
		});
		const parsed = parsePlan(raw);
		expect(parsed.steps.some((s) => s.tool === 'bad-tool!')).toBe(false);
	});

	it('cancels during read-only tool before second hop', async () => {
		const item: TimelineItem = {
			id: 'a',
			trackId: track.id,
			from: 0,
			durationInFrames: 30,
			label: 'Clip',
			type: 'video'
		};
		timelineStore.setAll({ tracks: [track], items: [item], fps: 30 });
		buildClipRefs();
		const slowAdapter: LlmAdapter = {
			id: 'test',
			label: 'Test',
			isSupported: () => true,
			load: async () => {},
			generate: async (_msgs: unknown, opts: { signal?: AbortSignal } = {}) => {
				if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
				return JSON.stringify({
					reply: 'Searching',
					steps: [{ tool: 'search_transcript', args: { query: 'hi' } }]
				});
			},
			dispose: () => {}
		};
		const controller = new AbortController();
		controller.abort();
		const promise = planRequest('test', {
			history: [],
			adapter: slowAdapter,
			signal: controller.signal
		});
		await expect(promise).rejects.toThrow();
	});
});

describe('tool semantics with locks and FPS', () => {
	it('rejects set_speed on locked tracks and keeps atomic undo', async () => {
		const a: TimelineItem = {
			id: 'a',
			trackId: lockedTrack.id,
			from: 0,
			durationInFrames: 30,
			label: 'A',
			type: 'video',
			sourceFps: 60
		};
		const b: TimelineItem = {
			id: 'b',
			trackId: track.id,
			from: 30,
			durationInFrames: 30,
			label: 'B',
			type: 'video',
			sourceFps: 60
		};
		timelineStore.setAll({ tracks: [track, lockedTrack], items: [a, b], fps: 30 });
		buildClipRefs();
		setClipRefSelectionProvider(() => ['a', 'b']);
		const tool = getEditorTool('set_speed')!;
		await expect(async () => await tool.execute({ clips: ['c1', 'c2'], speed: 2 })).rejects.toThrow(
			/locked/
		);
		expect(timelineStore.itemById.get('b')?.speed).not.toBe(2);
		const before = commandHistory.undoStack.length;
		// Now try with only unlocked
		setClipRefSelectionProvider(() => ['b']);
		buildClipRefs();
		await tool.execute({ clips: ['c2'], speed: 2 });
		expect(commandHistory.undoStack.length).toBe(before + 1);
		commandHistory.undo();
		expect(timelineStore.itemById.get('b')?.speed ?? 1).toBe(1);
	});

	it('handles mismatched source/timeline FPS correctly for trim', async () => {
		const item: TimelineItem = {
			id: 'a',
			trackId: track.id,
			from: 0,
			durationInFrames: 60,
			label: 'Clip',
			type: 'video',
			sourceFps: 60,
			sourceStart: 0,
			sourceEnd: 120,
			speed: 1
		};
		timelineStore.setAll({ tracks: [track], items: [item], fps: 30 });
		buildClipRefs();
		const tool = getEditorTool('trim_clip')!;
		// Trim 1 second off start at 30fps timeline = 30 frames, should convert to 60 source frames at 60fps source
		await tool.execute({ clip: 'c1', side: 'start', seconds: 1 });
		const updated = timelineStore.itemById.get('a')!;
		expect(updated.from).toBe(30);
		expect(updated.sourceStart).toBe(60);
	});

	it('reports no-op for set_speed when already at speed', async () => {
		const item: TimelineItem = {
			id: 'a',
			trackId: track.id,
			from: 0,
			durationInFrames: 30,
			label: 'A',
			type: 'video',
			speed: 2
		};
		timelineStore.setAll({ tracks: [track], items: [item], fps: 30 });
		buildClipRefs();
		setClipRefSelectionProvider(() => ['a']);
		const tool = getEditorTool('set_speed')!;
		await expect(async () => await tool.execute({ clips: ['c1'], speed: 2 })).rejects.toThrow(
			/already/
		);
	});

	it('inserts title without moving playhead when seek is locked', async () => {
		timelineStore.setAll({ tracks: [track], items: [], fps: 30, currentFrame: 10 });
		timelineStore.__setSeekLockedForTesting(true);
		buildClipRefs();
		const tool = getEditorTool('add_title')!;
		const beforeFrame = timelineStore.currentFrame;
		await tool.execute({ text: 'Hello', atSeconds: 5 });
		expect(timelineStore.currentFrame).toBe(beforeFrame);
		const added = timelineStore.items.find((i) => i.type === 'text');
		expect(added?.from).toBe(150);
		timelineStore.__setSeekLockedForTesting(false);
	});

	it('detects stale plan when sourceStart changes but from/duration unchanged', async () => {
		const item: TimelineItem = {
			id: 'a',
			trackId: track.id,
			from: 0,
			durationInFrames: 30,
			label: 'A',
			type: 'video',
			sourceStart: 0,
			sourceEnd: 30,
			speed: 1,
			volume: 1
		};
		timelineStore.setAll({ tracks: [track], items: [item], fps: 30 });
		buildClipRefs();
		timelineStore.__updateItemsForTesting([{ id: 'a', patch: { volume: 0.5 } }]);
		const ctx1 = buildTimelineContext([], 0);
		expect(ctx1.text).toContain('A');
	});
});
