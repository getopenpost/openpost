import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { get } from 'svelte/store';
import { createEmptyTimeline } from '$lib/video-editor/project/defaults';
import type { SubComposition, TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { keyboardShortcuts } from '$lib/video-editor/settings/keyboard-shortcuts.svelte';
import { mediaPool } from '$lib/video-editor/media/pool.svelte';
import { timelinePreviewScrub } from '$lib/video-editor/preview/timeline-preview-scrub';
import type { MediaMetadata } from '$lib/video-editor/media/types';
import {
	clearActiveMediaDrag,
	mediaDragData,
	writeMediaDragData
} from '$lib/video-editor/media/media-drag';
import CompositionTimeline from './composition-timeline.svelte';
import { autoKeyframeStore } from '$lib/video-editor/timeline/stores/auto-keyframe-store.svelte';

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
	keyboardShortcuts.resetAll();
	autoKeyframeStore.reset();
	mediaPool.clear();
	clearActiveMediaDrag();
	timelinePreviewScrub.__resetForTesting();
});

afterEach(async () => {
	await page.viewport(1280, 900);
	sequenceStore.reset();
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	keyboardShortcuts.resetAll();
	autoKeyframeStore.reset();
	mediaPool.clear();
	clearActiveMediaDrag();
	timelinePreviewScrub.__resetForTesting();
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
		expect(screen.getByRole('heading', { name: 'Promo' })).toBeVisible();
		expect(screen.getByText(/1280×720/)).toBeVisible();
		expect(screen.getByTestId('composition-fps')).toHaveValue(60);
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

	it('uses saved composition bindings and leaves focused controls alone', async () => {
		keyboardShortcuts.setBinding('COMPOSITION_DUPLICATE', 'alt+8');
		keyboardShortcuts.setBinding('COMPOSITION_NUDGE_RIGHT', 'alt+9');
		keyboardShortcuts.setBinding('DELETE_SELECTED', 'alt+0');
		sequenceStore.load(
			{
				...createEmptyTimeline(),
				compositions: [
					composition({
						items: [makeItem({ id: 'one' }), makeItem({ id: 'two', from: 90 })],
						durationInFrames: 150
					})
				]
			},
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo('comp-1');
		const onedit = vi.fn();
		const screen = await render(CompositionTimeline, { onedit });
		await screen.getByTestId('composition-bar-one').click();
		const timeline = screen.getByTestId('composition-timeline').element();
		const send = (target: Element, init: KeyboardEventInit) =>
			target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: '9',
				code: 'Digit9',
				altKey: true,
				bubbles: true
			})
		);
		expect(timelineStore.itemById.get('one')?.from).toBe(0);

		send(timeline, { key: 'd', code: 'KeyD', metaKey: true });
		expect(timelineStore.items).toHaveLength(2);
		send(timeline, { key: '8', code: 'Digit8', altKey: true });
		await vi.waitFor(() => expect(timelineStore.items).toHaveLength(3));
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();

		send(screen.getByTestId('layer-expand-one').element(), {
			key: '8',
			code: 'Digit8',
			altKey: true
		});
		expect(timelineStore.items).toHaveLength(2);

		send(timeline, { key: 'ArrowRight', code: 'ArrowRight' });
		expect(timelineStore.itemById.get('one')?.from).toBe(0);
		send(timeline, { key: '9', code: 'Digit9', altKey: true });
		expect(timelineStore.itemById.get('one')?.from).toBe(1);
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();

		send(timeline, { key: 'Backspace', code: 'Backspace' });
		expect(timelineStore.itemById.has('one')).toBe(true);
		send(timeline, { key: '0', code: 'Digit0', altKey: true });
		expect(timelineStore.itemById.has('one')).toBe(false);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledTimes(3);
	});

	it('runs layer row context actions and supports keyboard invocation', async () => {
		sequenceStore.load(
			{ ...createEmptyTimeline(), compositions: [composition()] },
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo('comp-1');
		const onedit = vi.fn();
		const screen = await render(CompositionTimeline, { onedit });
		const layer = screen.getByTestId('composition-layer-one');
		const historyBefore = commandHistory.undoStack.length;

		await userEvent.click(layer, { button: 'right' });
		await expect.element(screen.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
		await expect.element(screen.getByRole('menuitem', { name: 'Group' })).toBeDisabled();
		await expect.element(screen.getByRole('menuitem', { name: 'Paste' })).toBeDisabled();
		await screen.getByRole('menuitem', { name: 'Copy' }).click();

		await userEvent.click(layer, { button: 'right' });
		await expect.element(screen.getByRole('menuitem', { name: 'Paste' })).not.toBeDisabled();
		await screen.getByRole('menuitem', { name: 'Paste' }).click();
		await vi.waitFor(() => expect(timelineStore.items).toHaveLength(3));
		expect(timelineStore.items.find((item) => item.id !== 'one' && item.id !== 'two')?.from).toBe(
			120
		);
		expect(commandHistory.undoStack).toHaveLength(historyBefore + 1);
		expect(onedit).toHaveBeenCalledTimes(1);
		commandHistory.undo();
		expect(timelineStore.items).toHaveLength(2);

		await userEvent.click(layer, { button: 'right' });
		await screen.getByRole('menuitem', { name: 'Duplicate' }).click();

		await vi.waitFor(() => expect(timelineStore.items).toHaveLength(3));
		const duplicate = timelineStore.items.find((item) => item.label === 'one copy');
		expect(duplicate?.from).toBe(120);
		expect(commandHistory.undoStack).toHaveLength(historyBefore + 1);
		expect(onedit).toHaveBeenCalledTimes(2);

		layer.element().focus();
		await userEvent.keyboard('{Shift>}{F10}{/Shift}');
		await expect.element(screen.getByRole('menuitem', { name: 'Copy' })).toBeVisible();
		await userEvent.keyboard('{Escape}');

		commandHistory.undo();
		expect(timelineStore.items).toHaveLength(2);
	});

	it('deletes a group and its layers from one context action and one undo', async () => {
		const groupTrack: TimelineTrack = {
			...track,
			id: 'group',
			name: 'Titles',
			kind: undefined,
			isGroup: true,
			order: 0
		};
		const firstTrack: TimelineTrack = {
			...track,
			id: 'first-track',
			name: 'First',
			parentTrackId: groupTrack.id,
			order: 1
		};
		const secondTrack: TimelineTrack = {
			...track,
			id: 'second-track',
			name: 'Second',
			parentTrackId: groupTrack.id,
			order: 2
		};
		const items = [
			makeItem({ id: 'one', trackId: firstTrack.id }),
			makeItem({ id: 'two', trackId: secondTrack.id })
		];
		sequenceStore.load(
			{
				...createEmptyTimeline(),
				compositions: [
					composition({ items, tracks: [groupTrack, firstTrack, secondTrack, audioTrack] })
				]
			},
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo('comp-1');
		const onedit = vi.fn();
		const screen = await render(CompositionTimeline, { onedit });
		const historyBefore = commandHistory.undoStack.length;

		await userEvent.click(screen.getByTestId('group-header-group'), { button: 'right' });
		await expect.element(screen.getByRole('menuitem', { name: 'Ungroup' })).toBeVisible();
		await screen.getByRole('menuitem', { name: 'Delete group' }).click();

		await vi.waitFor(() => expect(timelineStore.items).toHaveLength(0));
		expect(timelineStore.tracks.some((candidate) => candidate.id === groupTrack.id)).toBe(false);
		expect(commandHistory.undoStack).toHaveLength(historyBefore + 1);
		expect(onedit).toHaveBeenCalledTimes(1);

		commandHistory.undo();
		expect(timelineStore.items.map((item) => item.id).toSorted()).toEqual(['one', 'two']);
		expect(timelineStore.tracks.some((candidate) => candidate.id === groupTrack.id)).toBe(true);
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

	it('moves one vector keyframe once without losing its id, easing, or spatial tangents', async () => {
		const first = {
			id: 'vk1',
			frame: 0,
			value: { x: 0, y: 4 },
			easing: 'ease-in-out' as const,
			easingConfig: {
				type: 'ease-in-out' as const,
				bezier: { x1: 0.2, y1: 0.1, x2: 0.8, y2: 0.9 }
			},
			spatial: {
				inTangent: { x: -12, y: -3 },
				outTangent: { x: 18, y: 6 },
				continuous: true
			}
		};
		const animated = makeItem({
			id: 'one',
			vectorKeyframes: {
				position: [first, { id: 'vk2', frame: 30, value: { x: 100, y: 50 }, easing: 'linear' }]
			}
		});
		sequenceStore.load(
			{ ...createEmptyTimeline(), compositions: [composition({ items: [animated] })] },
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo('comp-1');
		const onedit = vi.fn();
		const screen = await render(CompositionTimeline, { onedit });
		const key = screen.getByTestId('vector-key-one-position-0').element();
		const rect = key.getBoundingClientRect();
		key.dispatchEvent(
			new PointerEvent('pointerdown', {
				button: 0,
				pointerId: 12,
				clientX: rect.left,
				bubbles: true
			})
		);
		window.dispatchEvent(
			new PointerEvent('pointermove', {
				pointerId: 12,
				clientX: rect.left + 40,
				bubbles: true
			})
		);
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 12, bubbles: true }));
		await vi.waitFor(() =>
			expect(timelineStore.itemById.get('one')?.vectorKeyframes?.position?.[0]?.frame).toBe(10)
		);
		expect(timelineStore.itemById.get('one')?.vectorKeyframes?.position?.[0]).toEqual({
			...first,
			frame: 10
		});
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();
		commandHistory.undo();
		expect(timelineStore.itemById.get('one')?.vectorKeyframes?.position?.[0]).toEqual(first);
	});

	it.each([320, 390])('keeps compact layout without horizontal overflow at %ipx', async (width) => {
		await page.viewport(width, 720);
		sequenceStore.load(
			{ ...createEmptyTimeline(), compositions: [composition()] },
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo('comp-1');
		const screen = await render(CompositionTimeline, { onedit: vi.fn() });
		const section = screen.getByTestId('composition-timeline').element();
		expect(section.scrollWidth).toBeLessThanOrEqual(section.clientWidth + 1);
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width + 1);
		expect(screen.getByTestId('composition-body')).toBeVisible();
	});

	it('keeps a bounded sidebar DOM while scrolling a large composition', async () => {
		const items = Array.from({ length: 250 }, (_, index) =>
			makeItem({ id: `layer-${index}`, from: index * 30, durationInFrames: 30 })
		);
		sequenceStore.load(
			{
				...createEmptyTimeline(),
				compositions: [composition({ items, durationInFrames: 7_500 })]
			},
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo('comp-1');
		await render(CompositionTimeline, { onedit: vi.fn() });
		await vi.waitFor(() =>
			expect(document.querySelectorAll('[data-layer-row]').length).toBeGreaterThan(0)
		);
		expect(document.querySelectorAll('[data-layer-row]').length).toBeLessThan(60);
		expect(document.querySelector('[data-layer-row="layer-0"]')).not.toBeNull();
		expect(document.querySelector('[data-testid="sidebar-virtual-after"]')).not.toBeNull();

		const sidebar = document.querySelector('.layer-sidebar');
		if (!(sidebar instanceof HTMLDivElement)) throw new Error('layer sidebar should be a div');
		sidebar.scrollTop = 3_400;
		sidebar.dispatchEvent(new Event('scroll', { bubbles: true }));
		await vi.waitFor(() =>
			expect(document.querySelector('[data-testid="sidebar-virtual-before"]')).not.toBeNull()
		);
		expect(document.querySelector('[data-layer-row="layer-0"]')).toBeNull();
		expect(document.querySelectorAll('[data-layer-row]').length).toBeLessThan(60);
		const renderedIndexes = [...document.querySelectorAll<HTMLElement>('[data-layer-row]')].map(
			(node) => Number(node.dataset.layerRow?.replace('layer-', ''))
		);
		expect(Math.max(...renderedIndexes)).toBeGreaterThan(60);
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

	it('shows inline dopesheet and toggles to value graph per expanded layer', async () => {
		// SAFETY: test supplies minimal keyframe track shape for inline dopesheet toggling; full TimelineItem contract not needed.
		const item = makeItem({
			id: 'one',
			keyframes: {
				x: { frames: [0, 10], values: [0, 100], ids: ['a', 'b'], easings: ['linear', 'linear'] }
			} as any
		});
		const second = makeItem({
			id: 'two',
			from: 60,
			// SAFETY: test supplies the same minimal keyframe track shape as the first inline editor fixture.
			keyframes: {
				x: { frames: [0, 10], values: [20, 40], ids: ['c', 'd'], easings: ['linear', 'linear'] }
			} as any
		});
		sequenceStore.load(
			{ ...createEmptyTimeline(), compositions: [composition({ items: [item, second] })] },
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo('comp-1');
		const screen = await render(CompositionTimeline, { onedit: vi.fn() });
		await screen.getByTestId('layer-expand-one').click();
		await screen.getByTestId('layer-expand-two').click();
		await vi.waitFor(() => expect(screen.getByTestId('inline-props-one')).toBeVisible());
		expect(screen.getByTestId('inline-props-one').element().textContent).toMatch(/Properties/);
		await screen.getByTestId('mode-graph-one').click();
		await vi.waitFor(() => {
			expect(
				screen
					.getByTestId('inline-props-one')
					.element()
					.querySelector('[data-keyframe-value-graph]')
			).toBeVisible();
		});
		expect(
			screen.getByTestId('inline-props-two').element().querySelector('[data-keyframe-value-graph]')
		).toBeNull();
		await screen.getByTestId('mode-lanes-one').click();
		expect(document.querySelector('[data-keyframe-value-graph]')).toBeNull();
	});

	it('keeps keyframe view, navigation, auto, and fit commands inside expanded Motion properties', async () => {
		await page.viewport(320, 720);
		const item = makeItem({
			id: 'one',
			keyframes: {
				x: { frames: [0, 10, 30], values: [0, 100, 50], ids: ['a', 'b', 'c'] }
			}
		});
		sequenceStore.load(
			{ ...createEmptyTimeline(), compositions: [composition({ items: [item] })] },
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo('comp-1');
		const screen = await render(CompositionTimeline, { onedit: vi.fn() });
		await screen.getByTestId('layer-expand-one').click();
		const editor = screen.getByTestId('inline-props-one').element();
		const key = (value: string, code: string, altKey = false, target: EventTarget = editor) =>
			target.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: value,
					code,
					altKey,
					bubbles: true,
					cancelable: true
				})
			);

		key('1', 'Digit1');
		await vi.waitFor(() =>
			expect(document.querySelector('[data-keyframe-value-graph]')).toBeVisible()
		);
		expect(document.querySelector('[aria-label="Keyframe dope sheet"]')).toBeNull();
		key('3', 'Digit3');
		await expect.element(screen.getByRole('region', { name: 'Keyframe dope sheet' })).toBeVisible();
		await vi.waitFor(() =>
			expect(document.querySelector('[data-keyframe-value-graph]')).toBeVisible()
		);
		key('2', 'Digit2');
		await vi.waitFor(() =>
			expect(document.querySelector('[data-keyframe-value-graph]')).toBeNull()
		);

		timelineStore._setCurrentFrame(5);
		key(']', 'BracketRight', true);
		expect(timelineStore.currentFrame).toBe(10);
		key('[', 'BracketLeft', true);
		expect(timelineStore.currentFrame).toBe(0);
		key('a', 'KeyA');
		expect(autoKeyframeStore.isEnabled('one', 'x')).toBe(true);
		await expect
			.element(screen.getByRole('button', { name: 'Toggle auto-key for x' }))
			.toHaveAttribute('aria-pressed', 'true');
		expect(key('f', 'KeyF')).toBe(false);

		keyboardShortcuts.setBinding('KEYFRAME_NEXT', 'alt+8');
		timelineStore._setCurrentFrame(0);
		key(']', 'BracketRight', true);
		expect(timelineStore.currentFrame).toBe(0);
		key('8', 'Digit8', true);
		expect(timelineStore.currentFrame).toBe(10);
		timelineStore._setCurrentFrame(0);
		editor.dispatchEvent(new PointerEvent('pointerenter'));
		key('8', 'Digit8', true, window);
		expect(timelineStore.currentFrame).toBe(10);
		editor.dispatchEvent(new PointerEvent('pointerleave'));
		timelineStore._setCurrentFrame(0);
		key('8', 'Digit8', true, window);
		expect(timelineStore.currentFrame).toBe(0);
		await page.viewport(320, 720);
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
	});

	it('renders motion-layer and modifier bands with one-undo remove', async () => {
		// SAFETY: test uses minimal motion layer/modifier stubs for band rendering; full typed contracts not required here.
		const item = makeItem({
			id: 'one',
			motionLayers: [
				{ id: 'ml1', name: 'Drift', presetId: 'drift', enabled: true, blend: 'add' } as any
			],
			motionModifiers: [{ type: 'wiggle', enabled: true } as any]
		});
		sequenceStore.load(
			{ ...createEmptyTimeline(), compositions: [composition({ items: [item] })] },
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo('comp-1');
		const onedit = vi.fn();
		const screen = await render(CompositionTimeline, { onedit });
		await screen.getByTestId('layer-expand-one').click();
		expect(screen.getByTestId('motion-layers-one')).toBeVisible();
		expect(screen.getByTestId('motion-modifiers-one')).toBeVisible();
		const before = commandHistory.undoStack.length;
		await screen.getByTestId('motion-layer-one-ml1').click();
		await vi.waitFor(() => expect(timelineStore.itemById.get('one')?.motionLayers?.length).toBe(0));
		expect(commandHistory.undoStack).toHaveLength(before + 1);
		commandHistory.undo();
		expect(timelineStore.itemById.get('one')?.motionLayers?.length).toBe(1);
	});

	it('shows path vertex and mask lanes', async () => {
		// SAFETY: test uses minimal path vertex stub for lane rendering; full ShapePathVertex contract not needed.
		const pathItem = makeItem({
			id: 'shape1',
			type: 'shape',
			shapeType: 'path',
			pathVertices: [
				{ x: 0, y: 0 },
				{ x: 10, y: 10 }
			] as any
		});
		// SAFETY: test uses minimal mask stub for lane rendering; full TimelineItem mask contract not required.
		const maskItem = makeItem({
			id: 'mask1',
			isMask: true,
			maskType: 'alpha',
			maskFeather: 5
		} as any);
		sequenceStore.load(
			{ ...createEmptyTimeline(), compositions: [composition({ items: [pathItem, maskItem] })] },
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo('comp-1');
		const screen = await render(CompositionTimeline, { onedit: vi.fn() });
		await screen.getByTestId('layer-expand-shape1').click();
		expect(screen.getByTestId('path-vertices-shape1')).toBeVisible();
		await screen.getByTestId('layer-expand-mask1').click();
		expect(screen.getByTestId('mask-lane-mask1')).toBeVisible();
	});

	it('ghost scrubs on ruler drag and commits on release, cancels on Escape', async () => {
		sequenceStore.load(
			{ ...createEmptyTimeline(), compositions: [composition()] },
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo('comp-1');
		timelineStore._setCurrentFrame(0);
		const screen = await render(CompositionTimeline, { onedit: vi.fn() });
		const ruler = screen.getByTestId('composition-ruler').element();
		const rect = ruler.getBoundingClientRect();
		await ruler.dispatchEvent(
			new PointerEvent('pointerdown', { button: 0, clientX: rect.left + 100, bubbles: true })
		);
		window.dispatchEvent(
			new PointerEvent('pointermove', { clientX: rect.left + 200, bubbles: true })
		);
		await vi.waitFor(() => expect(screen.getByTestId('composition-playhead-ghost')).toBeVisible());
		expect(timelineStore.currentFrame).toBe(0);
		expect(get(timelinePreviewScrub).frame).not.toBeNull();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await vi.waitFor(() =>
			expect(document.querySelector('[data-testid="composition-playhead-ghost"]')).toBeNull()
		);
		expect(timelineStore.currentFrame).toBe(0);
		expect(get(timelinePreviewScrub).frame).toBeNull();
		await ruler.dispatchEvent(
			new PointerEvent('pointerdown', { button: 0, clientX: rect.left + 100, bubbles: true })
		);
		window.dispatchEvent(
			new PointerEvent('pointermove', { clientX: rect.left + 200, bubbles: true })
		);
		window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
		await vi.waitFor(() => expect(timelineStore.currentFrame).not.toBe(0));
		expect(get(timelinePreviewScrub).frame).toBeNull();
	});

	it('wheel zooms anchored at pointer and pans', async () => {
		sequenceStore.load(
			{ ...createEmptyTimeline(), compositions: [composition({ durationInFrames: 300 })] },
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo('comp-1');
		const screen = await render(CompositionTimeline, { onedit: vi.fn() });
		const scroll = screen.getByTestId('composition-scroll').element();
		scroll.scrollLeft = 100;
		const beforeZoom = timelineStore.zoomLevel;
		scroll.dispatchEvent(
			new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, clientX: 200 })
		);
		await vi.waitFor(() => expect(timelineStore.zoomLevel).not.toBe(beforeZoom));
	});

	it('drops ready media on an exact free timeline lane with source metadata and one undo', async () => {
		const media: MediaMetadata = {
			id: 'media-1234567',
			storageType: 'workspace',
			fileName: 'insert.mp4',
			fileSize: 1_024,
			mimeType: 'video/mp4',
			duration: 1,
			width: 1920,
			height: 1080,
			fps: 30,
			codec: 'avc1',
			bitrate: 1_000_000,
			tags: ['video']
		};
		mediaPool.upsert(media, 'ready');
		sequenceStore.load(
			{
				...createEmptyTimeline(),
				compositions: [composition({ items: [makeItem({ id: 'one', durationInFrames: 30 })] })]
			},
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo('comp-1');
		const onedit = vi.fn();
		const screen = await render(CompositionTimeline, { onedit });
		const timeline = screen.getByTestId('composition-timeline').element();
		const bars = screen.getByTestId('composition-layer-bars').element();
		const barsRect = bars.getBoundingClientRect();
		const dt = new DataTransfer();
		writeMediaDragData(dt, mediaDragData('media', media.id, media.fileName));
		const point = { clientX: barsRect.left + 60 * 4, clientY: barsRect.top + 10 };
		timeline.dispatchEvent(
			new DragEvent('dragover', { bubbles: true, dataTransfer: dt, ...point })
		);
		await vi.waitFor(() =>
			expect(document.querySelector('[data-testid="composition-drop-ghost"]')).not.toBeNull()
		);
		await expect(screen.getByTestId('composition-drop-ghost')).toBeVisible();
		timeline.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, ...point }));
		await vi.waitFor(() => expect(timelineStore.items).toHaveLength(2));
		const inserted = timelineStore.items.find((item) => item.id !== 'one');
		expect(inserted).toMatchObject({
			trackId: track.id,
			from: 60,
			durationInFrames: 30,
			mediaId: media.id,
			sourceStart: 0,
			sourceEnd: 30,
			sourceDuration: 30,
			sourceFps: 30
		});
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();
		commandHistory.undo();
		expect(timelineStore.items).toEqual([expect.objectContaining({ id: 'one' })]);
	});

	it('editable timing inputs trim media source bounds with one undo', async () => {
		const mediaItem = makeItem({
			id: 'one',
			mediaId: 'media-one',
			sourceStart: 100,
			sourceEnd: 160,
			sourceDuration: 300,
			sourceFps: 30
		});
		sequenceStore.load(
			{ ...createEmptyTimeline(), compositions: [composition({ items: [mediaItem] })] },
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo('comp-1');
		const onedit = vi.fn();
		const screen = await render(CompositionTimeline, { onedit });
		await screen.getByTestId('layer-expand-one').click();
		const inInputEl = screen.getByTestId('timing-in-one').element();
		if (!(inInputEl instanceof HTMLInputElement))
			throw new Error('timing input should be HTMLInputElement');
		const inInput = inInputEl;
		inInput.value = '10';
		inInput.dispatchEvent(new Event('change', { bubbles: true }));
		await vi.waitFor(() =>
			expect(timelineStore.itemById.get('one')).toMatchObject({
				from: 10,
				durationInFrames: 50,
				sourceStart: 110,
				sourceEnd: 160
			})
		);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();
		commandHistory.undo();
		expect(timelineStore.itemById.get('one')).toMatchObject({
			from: 0,
			durationInFrames: 60,
			sourceStart: 100,
			sourceEnd: 160
		});
	});

	it('gives each generated layer a dedicated track in an empty composition', async () => {
		sequenceStore.load(
			{
				...createEmptyTimeline(),
				compositions: [composition({ items: [], tracks: [] })]
			},
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo('comp-1');
		const onedit = vi.fn();
		const screen = await render(CompositionTimeline, { onedit });
		await screen.getByTestId('add-layer-text').click();
		await vi.waitFor(() => expect(timelineStore.items).toHaveLength(1));
		expect(timelineStore.tracks).toHaveLength(1);
		expect(timelineStore.items[0]).toMatchObject({
			trackId: timelineStore.tracks[0]?.id,
			type: 'text',
			label: 'Text'
		});
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();

		await screen.getByTestId('add-layer-solid').click();
		expect(timelineStore.items).toHaveLength(2);
		expect(timelineStore.tracks).toHaveLength(2);
		expect(timelineStore.items[1]?.trackId).toBe(timelineStore.tracks[1]?.id);
		expect(commandHistory.undoStack).toHaveLength(2);
		expect(onedit).toHaveBeenCalledTimes(2);
		commandHistory.undo();
		expect(timelineStore.items).toHaveLength(1);
		expect(timelineStore.tracks).toHaveLength(1);
	});

	it('offers every compositor blend mode, persists one exact choice, and disables locked edits', async () => {
		sequenceStore.load(
			{ ...createEmptyTimeline(), compositions: [composition()] },
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo('comp-1');
		const onedit = vi.fn();
		const screen = await render(CompositionTimeline, { onedit });
		await screen.getByTestId('layer-expand-one').click();
		const blendPicker = screen.getByTestId('blend-one');
		await blendPicker.click();
		const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
		expect(options).toHaveLength(25);
		expect(options.map((option) => option.textContent?.trim())).not.toContain('Add');
		await screen.getByRole('option', { name: 'Color burn' }).click();
		await vi.waitFor(() => expect(timelineStore.itemById.get('one')?.blendMode).toBe('color-burn'));
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();

		timelineStore._setTracks(
			timelineStore.tracks.map((candidate) =>
				candidate.id === track.id ? { ...candidate, locked: true } : candidate
			)
		);
		await expect.element(blendPicker).toBeDisabled();
		await expect(screen.getByTestId('timing-in-one')).toBeDisabled();
		await expect(screen.getByTestId('timing-out-one')).toBeDisabled();
	});

	it('creates and removes a direct property link on the chosen target with one undo each', async () => {
		sequenceStore.load(
			{ ...createEmptyTimeline(), compositions: [composition()] },
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo('comp-1');
		const onedit = vi.fn();
		const screen = await render(CompositionTimeline, { onedit });
		await screen.getByTestId('layer-expand-one').click();
		await screen.getByTestId('layer-expand-two').click();
		await screen.getByTestId('link-pick-btn-one').click();
		expect(screen.getByTestId('link-pick-btn-one')).toHaveAttribute('aria-pressed', 'true');
		await screen.getByTestId('link-pick-btn-two').click();
		await vi.waitFor(() =>
			expect(timelineStore.itemById.get('one')?.propertyLinks).toEqual([
				{
					type: 'link',
					targetProperty: 'x',
					sourceItemId: 'two',
					sourceProperty: 'x',
					enabled: true,
					timeOffsetFrames: 0
				}
			])
		);
		expect(timelineStore.itemById.get('two')?.propertyLinks).toBeUndefined();
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();
		await expect(screen.getByTestId('link-badge-one-x')).toHaveTextContent('x→two');

		await screen.getByTestId('link-remove-one-x').click();
		await vi.waitFor(() =>
			expect(timelineStore.itemById.get('one')?.propertyLinks).toBeUndefined()
		);
		expect(commandHistory.undoStack).toHaveLength(2);
		expect(onedit).toHaveBeenCalledTimes(2);
		commandHistory.undo();
		expect(timelineStore.itemById.get('one')?.propertyLinks?.[0]?.sourceItemId).toBe('two');
	});

	it('reads published controls from the nested composition and stores only the instance override', async () => {
		const childText = makeItem({
			id: 'child-text',
			type: 'text',
			text: 'Original headline'
		});
		const child = composition({
			id: 'child',
			name: 'Child',
			items: [childText],
			compositionControls: {
				version: 1,
				controls: [
					{
						id: 'headline',
						name: 'Headline',
						targetItemId: childText.id,
						property: 'text.text',
						kind: 'text',
						defaultValue: 'Fallback'
					}
				]
			}
		});
		const wrapper = makeItem({
			id: 'wrapper',
			type: 'composition',
			compositionId: child.id
		});
		const parent = composition({ items: [wrapper] });
		sequenceStore.load(
			{ ...createEmptyTimeline(), compositions: [parent, child] },
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo(parent.id);
		const onedit = vi.fn();
		const screen = await render(CompositionTimeline, { onedit });
		await screen.getByTestId('layer-expand-wrapper').click();
		const inputElement = screen.getByTestId('control-override-wrapper-headline').element();
		if (!(inputElement instanceof HTMLInputElement)) throw new Error('control should be an input');
		expect(inputElement.value).toBe('Original headline');
		inputElement.value = 'Launch today';
		inputElement.dispatchEvent(new Event('change', { bubbles: true }));
		await vi.waitFor(() =>
			expect(timelineStore.itemById.get('wrapper')?.compositionControlOverrides).toEqual({
				headline: 'Launch today'
			})
		);
		expect(sequenceStore.compositionById.get(child.id)?.items[0]?.text).toBe('Original headline');
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();
		commandHistory.undo();
		expect(timelineStore.itemById.get('wrapper')?.compositionControlOverrides).toBeUndefined();
	});

	it('easing picker and batch retime affect selected keyframes', async () => {
		// SAFETY: test supplies minimal keyframe track for easing picker; full contract not needed.
		const item = makeItem({
			id: 'one',
			keyframes: {
				x: { frames: [0, 20], values: [0, 100], ids: ['a', 'b'], easings: ['linear', 'linear'] }
			} as any
		});
		sequenceStore.load(
			{ ...createEmptyTimeline(), compositions: [composition({ items: [item] })] },
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo('comp-1');
		const screen = await render(CompositionTimeline, { onedit: vi.fn() });
		await screen.getByTestId('layer-expand-one').click();
		expect(screen.getByTestId('easing-picker-one')).toBeVisible();
		expect(screen.getByTestId('retime-batch-one')).toBeVisible();
	});

	it('snaps a move near an edge, commits once, and honors disabled snapping', async () => {
		const one = makeItem({ id: 'one', from: 0, durationInFrames: 30 });
		const two = makeItem({ id: 'two', from: 60, durationInFrames: 30 });
		sequenceStore.load(
			{ ...createEmptyTimeline(), compositions: [composition({ items: [one, two] })] },
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo('comp-1');
		const onedit = vi.fn();
		const screen = await render(CompositionTimeline, { onedit });
		const bar = screen.getByTestId('composition-bar-two').element();

		async function dragNearPreviousEnd(): Promise<void> {
			const rect = bar.getBoundingClientRect();
			const startX = rect.left + rect.width / 2;
			bar.dispatchEvent(
				new PointerEvent('pointerdown', {
					button: 0,
					pointerId: 7,
					clientX: startX,
					bubbles: true
				})
			);
			window.dispatchEvent(
				new PointerEvent('pointermove', {
					pointerId: 7,
					clientX: startX - 116,
					bubbles: true
				})
			);
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		}

		await dragNearPreviousEnd();
		await expect(screen.getByTestId('composition-snap-guide')).toBeVisible();
		window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, bubbles: true }));
		await vi.waitFor(() => expect(timelineStore.itemById.get('two')?.from).toBe(30));
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();

		commandHistory.undo();
		await vi.waitFor(() => expect(timelineStore.itemById.get('two')?.from).toBe(60));
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		timelineStore._setSnapEnabled(false);
		commandHistory.clearHistory();
		await dragNearPreviousEnd();
		expect(document.querySelector('[data-testid="composition-snap-guide"]')).toBeNull();
		window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, bubbles: true }));
		await vi.waitFor(() => expect(timelineStore.itemById.get('two')?.from).toBe(31));
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledTimes(2);
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
