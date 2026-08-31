import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import '../../../routes/layout.css';
import type { TimelineTrack } from '$lib/video-editor/project/types';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import AudioMixerPanel from './audio-mixer-panel.svelte';

function track(id: string, name: string, patch: Partial<TimelineTrack> = {}): TimelineTrack {
	return {
		id,
		name,
		kind: 'audio',
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		volume: 1,
		order: 0,
		...patch
	};
}

function pointer(type: string, y: number, pointerId: number): PointerEvent {
	return new PointerEvent(type, {
		bubbles: true,
		button: type === 'pointerdown' ? 0 : undefined,
		buttons: type === 'pointermove' ? 1 : 0,
		clientX: 122,
		clientY: y,
		pointerId,
		pointerType: 'mouse'
	});
}

beforeEach(async () => {
	await page.viewport(1280, 900);
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	timelineStore.setAll({
		tracks: [track('dialogue', 'Dialogue'), track('music', 'Music', { locked: true })],
		items: [],
		masterVolumeDb: 0,
		masterMuted: false
	});
});

afterEach(async () => {
	await page.viewport(1280, 900);
});

describe('AudioMixerPanel', () => {
	it('commits one pointer gesture, cancels Escape, and supports one-step undo', async () => {
		const screen = await render(AudioMixerPanel);
		const fader = screen.getByRole('slider', { name: 'Dialogue volume' }).element();
		vi.spyOn(fader, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 44, 100));
		vi.spyOn(fader, 'setPointerCapture').mockImplementation(() => undefined);
		vi.spyOn(fader, 'hasPointerCapture').mockReturnValue(true);
		vi.spyOn(fader, 'releasePointerCapture').mockImplementation(() => undefined);

		fader.dispatchEvent(pointer('pointerdown', 117, 1));
		fader.dispatchEvent(pointer('pointermove', 150, 1));
		fader.dispatchEvent(pointer('pointerup', 150, 1));
		await vi.waitFor(() => expect(timelineStore.tracks[0]?.volume).toBeLessThan(1));
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.tracks[0]?.volume).toBe(1);

		fader.dispatchEvent(pointer('pointerdown', 117, 2));
		fader.dispatchEvent(pointer('pointermove', 180, 2));
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		fader.dispatchEvent(pointer('pointerup', 180, 2));
		expect(timelineStore.tracks[0]?.volume).toBe(1);
		expect(commandHistory.undoStack).toHaveLength(0);
	});

	it('keeps mute, solo, keyboard faders, and master controls atomic', async () => {
		const screen = await render(AudioMixerPanel);
		await screen.getByRole('button', { name: 'Mute Dialogue' }).click();
		expect(timelineStore.tracks[0]?.muted).toBe(true);
		expect(commandHistory.undoStack).toHaveLength(1);

		const fader = screen.getByRole('slider', { name: 'Dialogue volume' });
		fader.element().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
		expect(timelineStore.tracks[0]?.volume).toBeCloseTo(Math.pow(10, 1 / 20), 8);
		expect(commandHistory.undoStack).toHaveLength(2);

		await screen.getByRole('button', { name: 'Mute master output' }).click();
		expect(timelineStore.masterMuted).toBe(true);
		expect(commandHistory.undoStack).toHaveLength(3);
		commandHistory.undo();
		expect(timelineStore.masterMuted).toBe(false);

		await expect.element(screen.getByRole('button', { name: 'Mute Music' })).toBeDisabled();
		await expect
			.element(screen.getByRole('slider', { name: 'Music volume' }))
			.toHaveAttribute('tabindex', '-1');
		await expect
			.element(screen.getByRole('button', { name: 'Parametric EQ: Music' }))
			.toBeDisabled();
	});

	it('edits track and master EQ in the mixer with atomic undo', async () => {
		const screen = await render(AudioMixerPanel);

		await screen.getByRole('button', { name: 'Parametric EQ: Dialogue' }).click();
		await expect.element(screen.getByLabelText('Dialogue Parametric EQ')).toBeVisible();
		await screen.getByRole('button', { name: 'Bypass', exact: true }).click();
		expect(timelineStore.tracks[0]?.audioEq?.enabled).toBe(false);
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.tracks[0]?.audioEq).toBeUndefined();

		await screen.getByRole('button', { name: 'Close', exact: true }).click();
		await screen.getByRole('button', { name: 'Parametric EQ: Master' }).click();
		await expect.element(screen.getByLabelText('Master Parametric EQ')).toBeVisible();
		await screen.getByRole('button', { name: 'Bypass', exact: true }).click();
		expect(timelineStore.busAudioEq?.enabled).toBe(false);
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.busAudioEq).toBeUndefined();
	});

	it('cancels an unfinished fader draft when the mixer closes', async () => {
		const screen = await render(AudioMixerPanel);
		const fader = screen.getByRole('slider', { name: 'Dialogue volume' }).element();
		vi.spyOn(fader, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 44, 100));
		vi.spyOn(fader, 'setPointerCapture').mockImplementation(() => undefined);
		vi.spyOn(fader, 'hasPointerCapture').mockReturnValue(true);
		vi.spyOn(fader, 'releasePointerCapture').mockImplementation(() => undefined);

		fader.dispatchEvent(pointer('pointerdown', 117, 3));
		fader.dispatchEvent(pointer('pointermove', 190, 3));
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		await screen.unmount();

		expect(timelineStore.tracks[0]?.volume).toBe(1);
		expect(commandHistory.undoStack).toHaveLength(0);
		expect(fader.hasPointerCapture(3)).toBe(true);
		expect(fader.releasePointerCapture).toHaveBeenCalledWith(3);
	});

	it('contains narrow layouts inside the mixer scroller', async () => {
		await page.viewport(320, 720);
		const screen = await render(AudioMixerPanel);
		const panel = screen.container.querySelector<HTMLElement>('[data-audio-mixer]')!;
		expect(panel.clientWidth).toBeLessThanOrEqual(320);
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
		expect(panel.querySelector('[data-mixer-master]')).not.toBeNull();
		await page.screenshot({
			element: panel,
			path: '../../../../.svelte-kit/openpost-audio-mixer-320.png'
		});

		await screen.getByRole('button', { name: 'Parametric EQ: Dialogue' }).click();
		const eqPanel = panel.querySelector<HTMLElement>('[data-mixer-eq-panel]')!;
		expect(eqPanel.clientWidth).toBeLessThanOrEqual(320);
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
		await page.screenshot({
			element: panel,
			path: '../../../../.svelte-kit/openpost-audio-mixer-eq-320.png'
		});
	});
});
