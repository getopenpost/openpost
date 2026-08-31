import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { getGpuEffectDefaultParams } from '$lib/video-editor/effects/gpu/registry';
import { scopeSamples } from '$lib/video-editor/effects/scope-samples.svelte';
import { colorPreviewStore } from '$lib/video-editor/effects/color-preview-store.svelte';
import { COLOR_GRADE_PRESETS_STORAGE_KEY } from '$lib/video-editor/effects/color-grade-presets';
import ColorWorkspace from './color-workspace.svelte';

const videoTrack: TimelineTrack = {
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

const videoItem: TimelineItem = {
	id: 'video',
	trackId: videoTrack.id,
	from: 0,
	durationInFrames: 60,
	label: 'Video',
	type: 'video',
	effects: [
		{
			id: 'wheels',
			type: 'gpu',
			effectId: 'gpu-color-wheels',
			enabled: true,
			params: getGpuEffectDefaultParams('gpu-color-wheels')
		}
	]
};

beforeEach(() => {
	localStorage.removeItem(COLOR_GRADE_PRESETS_STORAGE_KEY);
	colorPreviewStore.__resetForTesting();
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	timelineStore.setAll({ tracks: [videoTrack], items: [videoItem], fps: 30 });
	scopeSamples.publish(
		'video',
		new ImageData(new Uint8ClampedArray([3, 3, 3, 255, 250, 250, 250, 255]), 2, 1)
	);
});

describe('ColorWorkspace', () => {
	it('auto-balances the current frame as one undoable color-wheels edit', async () => {
		const onedit = vi.fn();
		await render(ColorWorkspace, { itemId: 'video', onedit });
		const button = document.querySelector<HTMLButtonElement>(
			'[title="Auto balance from the current frame"]'
		);
		expect(button).not.toBeNull();
		button?.click();
		colorPreviewStore.resolveFrameCapture(
			'video',
			scopeSamples.current?.image ?? new ImageData(1, 1)
		);

		await vi.waitFor(() => {
			const effect = timelineStore.itemById.get('video')?.effects?.[0];
			expect(effect?.type === 'gpu' ? Number(effect.params.lift) : 0).toBeLessThan(0);
			expect(effect?.type === 'gpu' ? Number(effect.params.gain) : 1).toBeGreaterThan(1);
		});
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledTimes(1);
	});

	it('saves, applies, and deletes a browser-wide grade preset', async () => {
		const onedit = vi.fn();
		const screen = await render(ColorWorkspace, { itemId: 'video', onedit });
		await screen.getByRole('button', { name: 'Saved grade presets' }).click();
		const name = document.querySelector<HTMLInputElement>('[aria-label="Grade preset name"]');
		expect(name).not.toBeNull();
		if (!name) return;
		name.value = 'Warm launch';
		name.dispatchEvent(new InputEvent('input', { bubbles: true }));
		const save = document.querySelector<HTMLButtonElement>(
			'[aria-label="Save or update grade preset"]'
		);
		await vi.waitFor(() => expect(save?.disabled).toBe(false));
		save?.click();

		await vi.waitFor(() => {
			expect(localStorage.getItem(COLOR_GRADE_PRESETS_STORAGE_KEY)).toContain('Warm launch');
		});
		await expect.element(screen.getByText('Warm launch', { exact: true })).toBeVisible();
		await screen.getByRole('button', { name: 'Warm launch', exact: true }).click();
		await vi.waitFor(() => expect(onedit).toHaveBeenCalledTimes(1));
		await screen.getByRole('button', { name: 'Delete grade preset: Warm launch' }).click();
		await vi.waitFor(() => {
			expect(localStorage.getItem(COLOR_GRADE_PRESETS_STORAGE_KEY)).toBe('[]');
		});
	});

	it('changes only preview comparison state', async () => {
		const before = JSON.stringify(timelineStore.items);
		await render(ColorWorkspace, { itemId: 'video', onedit: vi.fn() });
		const split = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
			(button) => button.textContent?.trim() === 'Split'
		);
		split?.click();
		await vi.waitFor(() => expect(colorPreviewStore.comparisonMode).toBe('split'));
		expect(JSON.stringify(timelineStore.items)).toBe(before);
		expect(commandHistory.undoStack).toHaveLength(0);
	});

	it('surfaces the grading actions and delegates adjustment-layer creation', async () => {
		const oncreateadjustment = vi.fn();
		const screen = await render(ColorWorkspace, {
			itemId: 'video',
			onedit: vi.fn(),
			oncreateadjustment
		});

		await expect.element(screen.getByRole('button', { name: 'Copy grade' })).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Paste grade' })).toBeVisible();
		await screen.getByRole('button', { name: 'Adjustment layer' }).click();
		expect(oncreateadjustment).toHaveBeenCalledOnce();
	});
});
