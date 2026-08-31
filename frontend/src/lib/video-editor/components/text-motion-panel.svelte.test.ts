import { beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import TextMotionPanel from './text-motion-panel.svelte';

const track: TimelineTrack = {
	id: 'visual',
	name: 'Visual',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

function item(id: string): TimelineItem {
	return {
		id,
		trackId: track.id,
		from: 0,
		durationInFrames: 60,
		label: id,
		text: 'Open Post',
		type: 'text'
	};
}

async function setSlider(slider: Element, value: number, step: number): Promise<void> {
	if (!(slider instanceof HTMLElement)) throw new Error('Slider control is missing.');
	const current = Number(slider.getAttribute('aria-valuenow'));
	if (!Number.isFinite(current)) throw new Error('Slider value is missing.');
	const steps = Math.round(Math.abs(value - current) / step);
	if (steps === 0) return;
	const key = value > current ? 'ArrowRight' : 'ArrowLeft';
	slider.focus();
	await userEvent.keyboard(steps === 1 ? `{${key}}` : `{${key}>${steps}/}`);
}

beforeEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	timelineStore.setAll({ tracks: [track], items: [item('one'), item('two')], fps: 30 });
});

describe('TextMotionPanel', () => {
	it('shows three independent motion slots', async () => {
		const screen = await render(TextMotionPanel, {
			itemId: 'one',
			itemIds: ['one'],
			onedit: vi.fn()
		});
		expect(screen.getByText('In', { exact: true })).toBeVisible();
		expect(screen.getByText('Out', { exact: true })).toBeVisible();
		expect(screen.getByText('Loop', { exact: true })).toBeVisible();
	});

	it('applies and removes the active preset across selected text clips', async () => {
		const onedit = vi.fn();
		const screen = await render(TextMotionPanel, {
			itemId: 'one',
			itemIds: ['one', 'two'],
			onedit
		});
		await screen.getByRole('button', { name: 'Rise' }).click();
		expect(timelineStore.itemById.get('one')?.textMotion?.in?.presetId).toBe('rise');
		expect(timelineStore.itemById.get('two')?.textMotion?.in?.presetId).toBe('rise');
		expect(commandHistory.undoStack).toHaveLength(1);
		await screen.getByRole('button', { name: 'Remove Rise' }).click();
		expect(timelineStore.itemById.get('one')?.textMotion).toBeUndefined();
		expect(onedit).toHaveBeenCalledTimes(2);
	});

	it('coalesces a slider gesture and commits unit and order changes', async () => {
		const screen = await render(TextMotionPanel, {
			itemId: 'one',
			itemIds: ['one'],
			onedit: vi.fn()
		});
		await screen.getByRole('button', { name: 'Wave', exact: true }).click();
		commandHistory.clearHistory();
		const intensity = screen.getByRole('slider', { name: 'Intensity' });
		await setSlider(intensity.element(), 0.35, 0.05);
		expect(commandHistory.undoStack).toHaveLength(1);
		await screen.getByRole('button', { name: 'Unit' }).click();
		await screen.getByRole('option', { name: 'Word' }).click();
		await screen.getByRole('button', { name: 'Order' }).click();
		await screen.getByRole('option', { name: 'From center' }).click();
		expect(timelineStore.itemById.get('one')?.textMotion?.loop).toMatchObject({
			intensity: 0.35,
			unit: 'word',
			order: 'center'
		});
		expect(commandHistory.undoStack).toHaveLength(3);
	});
});
