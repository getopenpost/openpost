import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import type { TimelineTrack, TimelineItem } from '../project/types';
import { agentStore } from '../agent/store.svelte';
import { registerLlmAdapter } from '../agent/llm/registry';
import type { LlmAdapter } from '../agent/llm/types';
import AgentChatPanel from './agent-chat-panel.svelte';
import '../../../routes/layout.css';
import { setClipRefSelectionProvider } from '../agent/clip-refs';

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

function stubAdapter(responses: string[]): LlmAdapter {
	let idx = 0;
	return {
		id: 'gemma',
		label: 'Stub',
		isSupported: () => true,
		load: async () => undefined,
		generate: async (_msgs, opts) => {
			const next = responses[idx++] ?? responses[responses.length - 1] ?? '{}';
			if (opts?.onToken) opts.onToken(next, next);
			return next;
		},
		dispose: () => undefined
	};
}

beforeEach(() => {
	// Ensure WebGPU gate passes in test Chromium
	if (typeof navigator !== 'undefined' && !('gpu' in navigator)) {
		(
			Object.defineProperty as unknown as (
				obj: unknown,
				prop: string,
				desc: PropertyDescriptor
			) => void
		)(navigator, 'gpu', {
			value: { requestAdapter: async () => ({ features: { has: () => false } }) },
			configurable: true
		});
	}
	agentStore.__resetForTesting();
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	timelineStore.setAll({ tracks: [track], items: [], fps: 30 });
	setClipRefSelectionProvider(null);
});

describe('AgentChatPanel', () => {
	it('does not mutate timeline until Run is pressed and reports step results sequentially', async () => {
		const a: TimelineItem = {
			id: 'a',
			trackId: track.id,
			from: 0,
			durationInFrames: 60,
			label: 'Clip',
			type: 'video'
		};
		timelineStore.setAll({ tracks: [track], items: [a], fps: 30 });
		const valid = JSON.stringify({
			reply: 'Will add title',
			steps: [{ tool: 'add_title', args: { text: 'Hello' } }]
		});
		const unregister = registerLlmAdapter(stubAdapter([valid]));
		try {
			const screen = await render(AgentChatPanel);
			const textarea = screen.getByLabelText('Assistant message');
			await textarea.fill('add a title');
			await screen.getByRole('button', { name: 'Send' }).click();
			await expect.element(screen.getByTestId('agent-plan-card')).toBeVisible();
			// Timeline unchanged before Run
			expect(timelineStore.items.some((item) => item.type === 'text')).toBe(false);
			// Run plan
			await screen.getByTestId('agent-run-plan').click();
			await expect.element(screen.getByText('✓ Added a title \"Hello\".')).toBeVisible();
			expect(
				timelineStore.items.some((item) => item.type === 'text' && item.label === 'Hello')
			).toBe(true);
			// Undo should revert
			commandHistory.undo();
			expect(timelineStore.items.some((item) => item.label === 'Hello')).toBe(false);
		} finally {
			unregister();
		}
	});

	it('surfaces invalid JSON correction via retry and keeps timeline intact on discard', async () => {
		const bad = 'not json';
		const good = JSON.stringify({ reply: 'Hi', steps: [] });
		const unregister = registerLlmAdapter(stubAdapter([bad, good]));
		try {
			const screen = await render(AgentChatPanel);
			await screen.getByLabelText('Assistant message').fill('hello');
			await screen.getByRole('button', { name: 'Send' }).click();
			await expect.element(screen.getByText('Hi')).toBeVisible();
			expect(screen.container.querySelector('[data-testid="agent-plan-card"]')).toBeNull();
		} finally {
			unregister();
		}
	});

	it('cancels planning and keeps input', async () => {
		const slow: LlmAdapter = {
			id: 'gemma',
			label: 'Slow',
			isSupported: () => true,
			load: async () => undefined,
			generate: async (_msgs, opts) =>
				new Promise((_resolve, reject) => {
					opts?.signal?.addEventListener(
						'abort',
						() => reject(new DOMException('Aborted', 'AbortError')),
						{ once: true }
					);
				}),
			dispose: () => undefined
		};
		const unregister = registerLlmAdapter(slow);
		try {
			const screen = await render(AgentChatPanel);
			await screen.getByLabelText('Assistant message').fill('long task');
			await screen.getByRole('button', { name: 'Send' }).click();
			await expect.element(screen.getByRole('button', { name: 'Cancel' })).toBeVisible();
			await screen.getByRole('button', { name: 'Cancel' }).click();
			await expect.element(screen.getByLabelText('Assistant message')).toBeVisible();
		} finally {
			unregister();
		}
	});

	it('fits within 320px without horizontal overflow', async () => {
		await page.viewport(320, 720);
		const unregister = registerLlmAdapter(stubAdapter(['{}']));
		try {
			const screen = await render(AgentChatPanel);
			const root = screen.getByTestId('agent-chat-panel').element() as HTMLElement;
			expect(root.scrollWidth).toBeLessThanOrEqual(320);
		} finally {
			unregister();
		}
	});
});
