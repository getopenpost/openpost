import { beforeEach, describe, expect, it, vi } from 'vitest';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import type { TimelineTrack, TimelineItem } from '../project/types';
import { agentStore } from './store.svelte';
import { registerLlmAdapter } from './llm/registry';
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

function stubAdapter(responses: string[], delayMs = 0): LlmAdapter {
	let idx = 0;
	return {
		id: 'gemma',
		label: 'Stub',
		isSupported: () => true,
		load: async () => {
			if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
		},
		generate: async (_msgs, opts) => {
			if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
			if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
			const next = responses[idx++] ?? responses[responses.length - 1] ?? '{}';
			if (opts?.onToken) opts.onToken(next, next);
			return next;
		},
		dispose: () => undefined
	};
}

beforeEach(() => {
	if (!('gpu' in navigator)) {
		Object.defineProperty(navigator, 'gpu', {
			value: { requestAdapter: async () => ({}) },
			configurable: true
		});
	}
	agentStore.__resetForTesting();
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [track], items: [], fps: 30 });
});

describe('agent store project scoping and cancellation', () => {
	it('does not publish plan into new project if cancelled during load', async () => {
		const valid = JSON.stringify({
			reply: 'Hi',
			steps: [{ tool: 'add_title', args: { text: 'Hello' } }]
		});
		const unregister = registerLlmAdapter(stubAdapter([valid], 30));
		try {
			agentStore.setProjectId('p1');
			const promise = agentStore.submit('add Hello', { projectId: 'p1' });
			// Cancel and switch project before load completes
			agentStore.setProjectId('p2');
			await promise;
			expect(agentStore.phase).toBe('idle');
			expect(agentStore.plan).toBeNull();
			expect(agentStore.messages.some((m) => m.content.includes('Hello'))).toBe(false);
		} finally {
			unregister();
		}
	});

	it('rejects stale plan when timeline reorder changes c2 mapping', async () => {
		const a: TimelineItem = {
			id: 'a',
			trackId: track.id,
			from: 0,
			durationInFrames: 30,
			label: 'First',
			type: 'video'
		};
		const b: TimelineItem = {
			id: 'b',
			trackId: track.id,
			from: 30,
			durationInFrames: 30,
			label: 'Second',
			type: 'video'
		};
		timelineStore.setAll({ tracks: [track], items: [a, b], fps: 30 });
		const planJson = JSON.stringify({
			reply: 'Delete second',
			steps: [{ tool: 'delete_clips', args: { clips: ['c2'] } }]
		});
		const unregister = registerLlmAdapter(stubAdapter([planJson]));
		try {
			agentStore.setProjectId('p1');
			await agentStore.submit('delete second', { projectId: 'p1' });
			expect(agentStore.plan?.[0]?.tool).toBe('delete_clips');
			// Reorder: swap positions so c2 now points to different id
			const a2: TimelineItem = { ...a, from: 30 };
			const b2: TimelineItem = { ...b, from: 0 };
			timelineStore.setAll({ tracks: [track], items: [a2, b2], fps: 30 });
			await agentStore.runPlan({ projectId: 'p1' });
			expect(agentStore.plan).toBeNull();
			expect(agentStore.messages.some((m) => m.content.includes('Timeline changed'))).toBe(true);
			expect(timelineStore.itemById.has('b')).toBe(true);
		} finally {
			unregister();
		}
	});

	it('stops on first failure and skips remaining steps with autosave on partial success', async () => {
		const a: TimelineItem = {
			id: 'a',
			trackId: track.id,
			from: 0,
			durationInFrames: 60,
			label: 'Clip',
			type: 'video'
		};
		const b: TimelineItem = {
			id: 'b',
			trackId: track.id,
			from: 60,
			durationInFrames: 60,
			label: 'Clip2',
			type: 'video'
		};
		timelineStore.setAll({ tracks: [track], items: [a, b], fps: 30 });
		const threeSteps = JSON.stringify({
			reply: 'Delete then fail then skip',
			steps: [
				{ tool: 'delete_clips', args: { clips: ['c1'] } },
				{ tool: 'delete_clips', args: { clips: ['c1'] } },
				{ tool: 'add_title', args: { text: 'Hello' } }
			]
		});
		const unregister = registerLlmAdapter(stubAdapter([threeSteps]));
		try {
			agentStore.setProjectId('p1');
			await agentStore.submit('delete twice then add', { projectId: 'p1' });
			expect(agentStore.plan).toHaveLength(3);
			await agentStore.runPlan({ projectId: 'p1' });
			const lastMessage = agentStore.messages.at(-1)?.content ?? '';
			expect(lastMessage).toContain('✓ Deleted 1 clip');
			expect(lastMessage).toContain('✕');
			expect(lastMessage).toContain('Skipped after previous failure.');
			expect(agentStore.plan?.[2]?.status).toBe('skipped');
		} finally {
			unregister();
		}
	});

	it('treats handoff as terminal and does not run later edits behind dialog', async () => {
		const a: TimelineItem = {
			id: 'a',
			trackId: track.id,
			from: 0,
			durationInFrames: 60,
			label: 'Clip',
			type: 'video',
			mediaId: 'm1'
		};
		timelineStore.setAll({ tracks: [track], items: [a], fps: 30 });
		const handoffThenEdit = JSON.stringify({
			reply: 'Handoff then delete',
			steps: [
				{ tool: 'remove_silence', args: { clips: ['c1'] } },
				{ tool: 'delete_clips', args: { clips: ['c1'] } }
			]
		});
		const unregister = registerLlmAdapter(stubAdapter([handoffThenEdit]));
		// Mock handoff to not error
		const { setAgentHandoffHandlers } = await import('./tools/definitions');
		setAgentHandoffHandlers({ openSilenceReview: () => {}, openFillerReview: () => {} });
		try {
			agentStore.setProjectId('p1');
			await agentStore.submit('silence then delete', { projectId: 'p1' });
			await agentStore.runPlan({ projectId: 'p1' });
			expect(agentStore.plan?.[1]?.status).toBe('skipped');
			expect(timelineStore.itemById.has('a')).toBe(true);
		} finally {
			setAgentHandoffHandlers({});
			unregister();
		}
	});

	it('stops later mutations when a project changes during a running step', async () => {
		const item: TimelineItem = {
			id: 'a',
			trackId: track.id,
			from: 0,
			durationInFrames: 60,
			label: 'Clip',
			type: 'video'
		};
		timelineStore.setAll({ tracks: [track], items: [item], fps: 30 });
		const plan = JSON.stringify({
			reply: 'Select then delete',
			steps: [
				{ tool: 'select_clips', args: { clips: ['c1'] } },
				{ tool: 'delete_clips', args: { clips: ['c1'] } }
			]
		});
		const unregister = registerLlmAdapter(stubAdapter([plan]));
		const { setAgentSelectionHandler } = await import('./tools/definitions');
		setAgentSelectionHandler(() => {
			queueMicrotask(() => agentStore.setProjectId('p2'));
		});
		try {
			agentStore.setProjectId('p1');
			await agentStore.submit('select and delete', { projectId: 'p1' });
			await agentStore.runPlan({ projectId: 'p1' });
			expect(timelineStore.itemById.has('a')).toBe(true);
			expect(agentStore.phase).toBe('idle');
			expect(agentStore.plan).toBeNull();
		} finally {
			setAgentSelectionHandler(null);
			unregister();
		}
	});
});
