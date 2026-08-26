import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { createEmptyTimeline } from '$lib/video-editor/project/defaults';
import type { SubComposition, TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import CompositionTimeline from './composition-timeline.svelte';

const track: TimelineTrack = {
	id: 'visual',
	name: 'Visual',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

const audioTrack: TimelineTrack = {
	id: 'audio',
	name: 'Audio',
	kind: 'audio',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 1
};

function makeItem(overrides: Partial<TimelineItem> & { id: string }): TimelineItem {
	return {
		trackId: track.id,
		from: 0,
		durationInFrames: 60,
		label: overrides.id,
		type: 'video',
		...overrides
	};
}

function composition(overrides: Partial<SubComposition> = {}): SubComposition {
	return {
		id: 'comp-1',
		name: 'Card',
		editorKind: 'composite-2d',
		items: [makeItem({ id: 'one' }), makeItem({ id: 'two', from: 60 })],
		tracks: [track, audioTrack],
		transitions: [],
		fps: 30,
		width: 1920,
		height: 1080,
		durationInFrames: 120,
		...overrides
	};
}

beforeEach(() => {
	sequenceStore.reset();
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
});

afterEach(async () => {
	await page.viewport(1280, 900);
	sequenceStore.reset();
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
});

describe('CompositionTimeline focused 2D composition timeline', () => {
	it('shows the focused composition fps and does not hardcode 30', async () => {
		sequenceStore.load(
			{
				...createEmptyTimeline(),
				compositions: [composition({ fps: 60, name: 'Promo', width: 1280, height: 720 })]
			},
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo('comp-1');
		const screen = await render(CompositionTimeline, { onedit: vi.fn() });
		expect(screen.getByText('Promo')).toBeVisible();
		expect(screen.getByText(/1280×720/)).toBeVisible();
		expect(screen.getByText(/60 fps/)).toBeVisible();
		expect(screen.getByTestId('composition-timeline')).toBeVisible();
	});

	it('scrubs via ruler without marking dirty or calling onedit', async () => {
		sequenceStore.load(
			{ ...createEmptyTimeline(), compositions: [composition()] },
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo('comp-1');
		timelineStore._setCurrentFrame(0);
		timelineStore._clearDirty();
		const onedit = vi.fn();
		const screen = await render(CompositionTimeline, { onedit });
		expect(timelineStore.isDirty).toBe(false);
		const historyBefore = commandHistory.undoStack.length;
		await screen.getByTestId('ruler-tick-30').click();
		await vi.waitFor(() => expect(timelineStore.currentFrame).toBe(30));
		expect(onedit).not.toHaveBeenCalled();
		expect(commandHistory.undoStack).toHaveLength(historyBefore);
		expect(timelineStore.isDirty).toBe(false);
	});

	it('selects layers and deletes via keyboard with one undo', async () => {
		sequenceStore.load(
			{ ...createEmptyTimeline(), compositions: [composition()] },
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo('comp-1');
		const onedit = vi.fn();
		const screen = await render(CompositionTimeline, { onedit });
		await screen.getByTestId('composition-bar-one').click();
		expect(screen.getByTestId('composition-bar-one')).toHaveAttribute('aria-pressed', 'true');
		expect(screen.getByTestId('composition-delete')).not.toBeDisabled();
		await screen.getByTestId('composition-timeline').element().focus();
		screen
			.getByTestId('composition-timeline')
			.element()
			.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
		await vi.waitFor(() => expect(timelineStore.itemById.has('one')).toBe(false));
		expect(timelineStore.itemById.has('two')).toBe(true);
		expect(commandHistory.undoStack.length).toBeGreaterThanOrEqual(1);
		expect(onedit).toHaveBeenCalledTimes(1);
		commandHistory.undo();
		expect(timelineStore.itemById.has('one')).toBe(true);
	});

	it('links transform parent via pick whip with undo and shows cycle status', async () => {
		const one = makeItem({ id: 'one' });
		const two = makeItem({ id: 'two', from: 60 });
		sequenceStore.load(
			{ ...createEmptyTimeline(), compositions: [composition({ items: [one, two] })] },
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo('comp-1');
		const onedit = vi.fn();
		const screen = await render(CompositionTimeline, { onedit });
		// pick two as child, one as parent via pointer drag simulation
		const pickButton = screen.getByTestId('parent-pick-two');
		// start pick gesture on child
		await pickButton
			.element()
			.dispatchEvent(
				new PointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 10, bubbles: true })
			);
		// move over target layer row
		const targetRow = screen.getByTestId('composition-layer-one');
		const rect = targetRow.element().getBoundingClientRect();
		window.dispatchEvent(
			new PointerEvent('pointermove', {
				clientX: rect.left + 5,
				clientY: rect.top + 5,
				bubbles: true
			})
		);
		window.dispatchEvent(
			new PointerEvent('pointerup', {
				clientX: rect.left + 5,
				clientY: rect.top + 5,
				bubbles: true
			})
		);
		await vi.waitFor(() =>
			expect(timelineStore.itemById.get('two')?.transformParent?.parentItemId).toBe('one')
		);
		expect(commandHistory.undoStack.length).toBeGreaterThanOrEqual(1);
		await expect(screen.getByTestId('composition-status')).toHaveTextContent('Parent linked');
		expect(onedit).toHaveBeenCalledTimes(1);
		// attempt cycle: parent one to child two should be rejected and show status
		const pickOne = screen.getByTestId('parent-pick-one');
		await pickOne
			.element()
			.dispatchEvent(
				new PointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 10, bubbles: true })
			);
		const twoRow = screen.getByTestId('composition-layer-two');
		const rect2 = twoRow.element().getBoundingClientRect();
		window.dispatchEvent(
			new PointerEvent('pointermove', {
				clientX: rect2.left + 5,
				clientY: rect2.top + 5,
				bubbles: true
			})
		);
		window.dispatchEvent(
			new PointerEvent('pointerup', {
				clientX: rect2.left + 5,
				clientY: rect2.top + 5,
				bubbles: true
			})
		);
		await vi.waitFor(() =>
			expect(screen.getByTestId('composition-status').element().textContent).toMatch(
				/cycle|circular/i
			)
		);
		expect(timelineStore.itemById.get('one')?.transformParent).toBeUndefined();
		// undo parent link
		commandHistory.undo();
		expect(timelineStore.itemById.get('two')?.transformParent).toBeUndefined();
	});

	it('shows in/out work area, comp end overlay and vector rows with localized labels', async () => {
		const withKeyframes = makeItem({
			id: 'one',
			vectorKeyframes: {
				position: [
					{ id: 'vk1', frame: 0, value: { x: 0, y: 0 }, easing: 'linear' },
					{ id: 'vk2', frame: 30, value: { x: 100, y: 50 }, easing: 'linear' }
				]
			}
		});
		sequenceStore.load(
			{
				...createEmptyTimeline(),
				compositions: [
					composition({
						items: [withKeyframes, makeItem({ id: 'two', from: 60 })],
						durationInFrames: 120
					})
				]
			},
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo('comp-1');
		timelineStore._setInPoint(10);
		timelineStore._setOutPoint(50);
		const screen = await render(CompositionTimeline, { onedit: vi.fn() });
		expect(screen.getByTestId('composition-io-range')).toBeVisible();
		expect(screen.getByTestId('composition-active-dim-left')).toBeVisible();
		expect(screen.getByTestId('composition-end-dim')).toBeVisible();
		// localized Position/Scale/Anchor via paraglide
		expect(screen.getByTestId('vector-row-one-position')).toBeVisible();
		expect(document.querySelectorAll('[data-testid^="vector-row-"]').length).toBeGreaterThanOrEqual(
			2
		);
		expect(screen.getByTestId('vector-key-one-position-0')).toBeVisible();
	});

	it('keeps compact layout without horizontal overflow at 320px', async () => {
		await page.viewport(320, 720);
		sequenceStore.load(
			{ ...createEmptyTimeline(), compositions: [composition()] },
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo('comp-1');
		const screen = await render(CompositionTimeline, { onedit: vi.fn() });
		const section = screen.getByTestId('composition-timeline').element();
		expect(section.scrollWidth).toBeLessThanOrEqual(section.clientWidth + 1);
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(321);
		expect(screen.getByTestId('composition-body')).toBeVisible();
	});

	it('renders typed In Loop Out bands for text items and shows preset metadata', async () => {
		const txt = makeItem({
			id: 'txt',
			type: 'text',
			text: 'Hello world',
			textMotion: {
				in: {
					presetId: 'typewriter',
					durationFrames: 12,
					staggerFrames: 2,
					intensity: 1,
					order: 'forward',
					easing: 'linear',
					seed: 0
				},
				loop: {
					presetId: 'pulse',
					durationFrames: 10,
					staggerFrames: 0,
					intensity: 1,
					order: 'forward',
					easing: 'linear',
					seed: 0
				},
				out: {
					presetId: 'fade-down',
					durationFrames: 8,
					staggerFrames: 1,
					intensity: 1,
					order: 'forward',
					easing: 'linear',
					seed: 0
				}
			}
		});
		sequenceStore.load(
			{ ...createEmptyTimeline(), compositions: [composition({ items: [txt] })] },
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo('comp-1');
		const screen = await render(CompositionTimeline, { onedit: vi.fn() });
		expect(screen.getByTestId('text-band-txt-in')).toBeVisible();
		expect(screen.getByTestId('text-band-txt-loop')).toBeVisible();
		expect(screen.getByTestId('text-band-txt-out')).toBeVisible();
		expect(screen.getByTestId('text-band-handle-txt-in')).toBeVisible();
		expect(screen.getByTestId('text-band-handle-txt-out')).toBeVisible();
		expect(screen.getByTestId('text-band-handle-txt-loop')).toBeVisible();
		expect(screen.getByTestId('text-band-row-txt-in')).toBeVisible();
		expect(document.querySelectorAll('[data-testid^="text-lane-txt-"]').length).toBe(3);
	});

	it('drags In handle to change duration with live preview and one undo, cancel restores', async () => {
		const txt = makeItem({
			id: 'txt',
			type: 'text',
			text: 'Hello world',
			textMotion: {
				in: {
					presetId: 'typewriter',
					durationFrames: 12,
					staggerFrames: 2,
					intensity: 1,
					order: 'forward',
					easing: 'linear',
					seed: 0
				}
			}
		});
		sequenceStore.load(
			{ ...createEmptyTimeline(), compositions: [composition({ items: [txt] })] },
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo('comp-1');
		timelineStore._clearDirty();
		commandHistory.clearHistory();
		const onedit = vi.fn();
		const screen = await render(CompositionTimeline, { onedit });
		const handle = screen.getByTestId('text-band-handle-txt-in');
		const beforeDuration = timelineStore.itemById.get('txt')?.textMotion?.in?.durationFrames;
		expect(beforeDuration).toBe(12);
		const beforeUndo = commandHistory.undoStack.length;
		await handle
			.element()
			.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 100, bubbles: true }));
		window.dispatchEvent(new PointerEvent('pointermove', { clientX: 130, bubbles: true }));
		await vi.waitFor(() =>
			expect(timelineStore.itemById.get('txt')?.textMotion?.in?.durationFrames).not.toBe(
				beforeDuration
			)
		);
		expect(timelineStore.isDirty).toBe(true);
		// cancel via pointercancel should restore
		window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
		await vi.waitFor(() =>
			expect(timelineStore.itemById.get('txt')?.textMotion?.in?.durationFrames).toBe(beforeDuration)
		);
		expect(commandHistory.undoStack).toHaveLength(beforeUndo);
		// now do real commit
		await handle
			.element()
			.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 100, bubbles: true }));
		window.dispatchEvent(new PointerEvent('pointermove', { clientX: 130, bubbles: true }));
		window.dispatchEvent(new PointerEvent('pointerup', { clientX: 130, bubbles: true }));
		await vi.waitFor(() =>
			expect(timelineStore.itemById.get('txt')?.textMotion?.in?.durationFrames).not.toBe(
				beforeDuration
			)
		);
		expect(commandHistory.undoStack).toHaveLength(beforeUndo + 1);
		expect(onedit).toHaveBeenCalledTimes(1);
		commandHistory.undo();
		expect(timelineStore.itemById.get('txt')?.textMotion?.in?.durationFrames).toBe(beforeDuration);
	});

	it('drags In band body to change offset and Loop has no offset', async () => {
		const txt = makeItem({
			id: 'txt',
			type: 'text',
			text: 'Hello world hello world hello world',
			durationInFrames: 120,
			textMotion: {
				in: {
					presetId: 'typewriter',
					durationFrames: 8,
					staggerFrames: 1,
					intensity: 1,
					order: 'forward',
					easing: 'linear',
					seed: 0,
					offsetFrames: 2
				},
				loop: {
					presetId: 'pulse',
					durationFrames: 10,
					staggerFrames: 0,
					intensity: 1,
					order: 'forward',
					easing: 'linear',
					seed: 0
				},
				out: {
					presetId: 'fade-down',
					durationFrames: 8,
					staggerFrames: 1,
					intensity: 1,
					order: 'forward',
					easing: 'linear',
					seed: 0,
					offsetFrames: 0
				}
			}
		});
		sequenceStore.load(
			{ ...createEmptyTimeline(), compositions: [composition({ items: [txt] })] },
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo('comp-1');
		const screen = await render(CompositionTimeline, { onedit: vi.fn() });
		const inBand = screen.getByTestId('text-band-txt-in');
		const beforeOffset = timelineStore.itemById.get('txt')?.textMotion?.in?.offsetFrames;
		await inBand
			.element()
			.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 100, bubbles: true }));
		window.dispatchEvent(new PointerEvent('pointermove', { clientX: 120, bubbles: true }));
		await vi.waitFor(() =>
			expect(timelineStore.itemById.get('txt')?.textMotion?.in?.offsetFrames).not.toBe(beforeOffset)
		);
		window.dispatchEvent(new PointerEvent('pointerup', { clientX: 120, bubbles: true }));
		await vi.waitFor(() => expect(commandHistory.undoStack.length).toBeGreaterThanOrEqual(1));
		// loop band body drag should not change offset
		const loopBand = screen.getByTestId('text-band-txt-loop');
		const beforeLoopOffset = timelineStore.itemById.get('txt')?.textMotion?.loop?.offsetFrames;
		await loopBand
			.element()
			.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 100, bubbles: true }));
		window.dispatchEvent(new PointerEvent('pointermove', { clientX: 140, bubbles: true }));
		window.dispatchEvent(new PointerEvent('pointerup', { clientX: 140, bubbles: true }));
		expect(timelineStore.itemById.get('txt')?.textMotion?.loop?.offsetFrames).toBe(
			beforeLoopOffset
		);
	});

	it('rejects text motion edits on locked tracks', async () => {
		const lockedTrack: TimelineTrack = { ...track, id: 'locked', locked: true };
		const txt = makeItem({
			id: 'txt',
			trackId: 'locked',
			type: 'text',
			text: 'Hello',
			textMotion: {
				in: {
					presetId: 'typewriter',
					durationFrames: 10,
					staggerFrames: 1,
					intensity: 1,
					order: 'forward',
					easing: 'linear',
					seed: 0
				}
			}
		});
		sequenceStore.load(
			{
				...createEmptyTimeline(),
				compositions: [composition({ items: [txt], tracks: [lockedTrack] })]
			},
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo('comp-1');
		const screen = await render(CompositionTimeline, { onedit: vi.fn() });
		const handle = screen.getByTestId('text-band-handle-txt-in');
		await handle
			.element()
			.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 100, bubbles: true }));
		window.dispatchEvent(new PointerEvent('pointermove', { clientX: 130, bubbles: true }));
		window.dispatchEvent(new PointerEvent('pointerup', { clientX: 130, bubbles: true }));
		expect(timelineStore.itemById.get('txt')?.textMotion?.in?.durationFrames).toBe(10);
		expect(commandHistory.undoStack.length).toBe(0);
	});

	it('keeps text bands without overflow at 320px', async () => {
		await page.viewport(320, 720);
		const txt = makeItem({
			id: 'txt',
			type: 'text',
			text: 'Hello world',
			textMotion: {
				in: {
					presetId: 'typewriter',
					durationFrames: 12,
					staggerFrames: 2,
					intensity: 1,
					order: 'forward',
					easing: 'linear',
					seed: 0
				},
				loop: {
					presetId: 'pulse',
					durationFrames: 10,
					staggerFrames: 0,
					intensity: 1,
					order: 'forward',
					easing: 'linear',
					seed: 0
				},
				out: {
					presetId: 'fade-down',
					durationFrames: 8,
					staggerFrames: 1,
					intensity: 1,
					order: 'forward',
					easing: 'linear',
					seed: 0
				}
			}
		});
		sequenceStore.load(
			{ ...createEmptyTimeline(), compositions: [composition({ items: [txt] })] },
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo('comp-1');
		const screen = await render(CompositionTimeline, { onedit: vi.fn() });
		expect(
			document.querySelectorAll('[data-testid^="text-band-txt-"]').length
		).toBeGreaterThanOrEqual(3);
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(321);
	});
});
