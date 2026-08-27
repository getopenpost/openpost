import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { setCurrentFrame } from '$lib/video-editor/timeline/actions/items';
import { transitionsStore } from '$lib/video-editor/timeline/actions/transitions-store.svelte';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { keyframeSelectionStore } from '$lib/video-editor/timeline/stores/keyframe-selection-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { CUSTOM_EASING_PRESETS_STORAGE_KEY } from '$lib/video-editor/timeline/custom-easing-presets';
import TimelinePanel from './timeline-panel.svelte';

const videoTrack: TimelineTrack = {
	id: 'video-track',
	name: 'Video',
	kind: 'video',
	height: 64,
	locked: false,
	syncLock: true,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

const animatedItem: TimelineItem = {
	id: 'video',
	trackId: videoTrack.id,
	from: 0,
	durationInFrames: 60,
	label: 'Animated clip',
	type: 'video',
	keyframes: {
		opacity: {
			frames: [10, 20, 30],
			values: [0, 0.5, 1],
			ids: ['first', 'middle', 'last'],
			easings: ['hold', 'cubic-bezier', 'linear'],
			easingConfigs: [
				null,
				{
					type: 'cubic-bezier',
					bezier: { x1: 0.2, y1: 0.8, x2: 0.4, y2: 1 }
				},
				null
			]
		},
		rotation: { frames: [12], values: [90], ids: ['rotation'] }
	}
};

function pointer(
	target: EventTarget,
	type: 'pointerdown' | 'pointermove' | 'pointerup',
	x: number,
	y: number,
	options: { altKey?: boolean; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}
): void {
	target.dispatchEvent(
		new PointerEvent(type, {
			bubbles: true,
			button: 0,
			buttons: type === 'pointerup' ? 0 : 1,
			clientX: x,
			clientY: y,
			pointerId: 17,
			...options
		})
	);
}

function center(element: Element) {
	const rect = element.getBoundingClientRect();
	return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

beforeEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	keyframeSelectionStore.clear();
	keyframeSelectionStore.clearClipboard();
	transitionsStore.clear();
	localStorage.removeItem(CUSTOM_EASING_PRESETS_STORAGE_KEY);
	timelineStore.setAll({ tracks: [videoTrack], items: [structuredClone(animatedItem)], fps: 30 });
});

describe('KeyframeDopesheet', () => {
	it('filters animated and all properties and exposes row locks', async () => {
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await expect.element(screen.getByRole('region', { name: 'Keyframe dope sheet' })).toBeVisible();
		expect(screen.container.querySelectorAll('[data-dopesheet-keyframe-id]')).toHaveLength(4);
		await screen.getByRole('button', { name: 'All' }).click();
		await expect
			.element(screen.getByRole('button', { name: 'Add x keyframe at playhead' }))
			.toBeVisible();
		await screen.getByRole('button', { name: 'Lock opacity' }).click();
		await expect.element(screen.getByRole('button', { name: 'Unlock opacity' })).toBeVisible();
		expect(
			screen.container
				.querySelector('[data-dopesheet-keyframe-id="first"]')
				?.hasAttribute('disabled')
		).toBe(true);
		const search = screen.getByRole('searchbox', { name: 'Search keyframe properties' });
		await search.fill('rotation');
		await expect.element(screen.getByRole('group', { name: 'rotation keyframes' })).toBeVisible();
		expect(screen.container.querySelector('[aria-label="x keyframes"]')).toBeNull();
		await search.clear();
		await screen.getByRole('button', { name: 'Property group' }).click();
		await page.getByRole('option', { name: 'Audio' }).click();
		await expect
			.element(screen.getByRole('button', { name: 'Add volume keyframe at playhead' }))
			.toBeVisible();
		expect(screen.container.querySelector('[aria-label="x keyframes"]')).toBeNull();
	});

	it('moves a multi-key selection as one collision-safe retime', async () => {
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, {
			onedit,
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		const first = screen.container.querySelector<HTMLElement>(
			'[data-dopesheet-keyframe-id="first"]'
		);
		const middle = screen.container.querySelector<HTMLElement>(
			'[data-dopesheet-keyframe-id="middle"]'
		);
		expect(first).not.toBeNull();
		expect(middle).not.toBeNull();
		if (!first || !middle) return;
		let point = center(first);
		pointer(first, 'pointerdown', point.x, point.y);
		pointer(window, 'pointerup', point.x, point.y);
		point = center(middle);
		pointer(middle, 'pointerdown', point.x, point.y, { ctrlKey: true });
		pointer(window, 'pointerup', point.x, point.y, { ctrlKey: true });
		expect(keyframeSelectionStore.forItem(animatedItem.id).size).toBe(2);

		point = center(first);
		pointer(first, 'pointerdown', point.x, point.y);
		pointer(window, 'pointermove', point.x + 20, point.y);
		pointer(window, 'pointerup', point.x + 20, point.y);

		await vi.waitFor(() => {
			expect(timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.frames).toEqual([
				15, 25, 30
			]);
		});
		expect(commandHistory.getLastCommandType()).toBe('UPDATE_KEYFRAMES');
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();
	});

	it('duplicates the selected key with Alt-drag and preserves easing', async () => {
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		const middle = screen.container.querySelector<HTMLElement>(
			'[data-dopesheet-keyframe-id="middle"]'
		);
		expect(middle).not.toBeNull();
		if (!middle) return;
		const point = center(middle);
		pointer(middle, 'pointerdown', point.x, point.y, { altKey: true });
		pointer(window, 'pointermove', point.x + 40, point.y, { altKey: true });
		await vi.waitFor(() => {
			expect(screen.container.querySelector('[data-dopesheet-duplicate-preview]')).not.toBeNull();
		});
		pointer(window, 'pointerup', point.x + 40, point.y, { altKey: true });

		await vi.waitFor(() => {
			expect(timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity).toMatchObject({
				frames: [10, 20, 29, 30],
				easings: ['hold', 'cubic-bezier', 'cubic-bezier', 'linear']
			});
		});
		expect(commandHistory.getLastCommandType()).toBe('DUPLICATE_KEYFRAMES');
	});

	it('copies and pastes normalized keyframes at the playhead in one undo step', async () => {
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		const first = screen.container.querySelector<HTMLElement>(
			'[data-dopesheet-keyframe-id="first"]'
		);
		expect(first).not.toBeNull();
		if (!first) return;
		const point = center(first);
		pointer(first, 'pointerdown', point.x, point.y);
		pointer(window, 'pointerup', point.x, point.y);
		await screen.getByRole('button', { name: 'Copy selected keyframes' }).click();
		setCurrentFrame(40);
		await screen.getByRole('button', { name: 'Paste keyframes' }).click();

		await vi.waitFor(() => {
			expect(timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity).toMatchObject({
				frames: [10, 20, 30, 40],
				values: [0, 0.5, 1, 0],
				easings: ['hold', 'cubic-bezier', 'linear', 'hold']
			});
		});
		expect(commandHistory.getLastCommandType()).toBe('INSERT_KEYFRAMES');
		expect(commandHistory.undoStack).toHaveLength(1);
	});

	it('Shift-selects a lane range and removes it atomically with the keyboard', async () => {
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		const first = screen.container.querySelector<HTMLElement>(
			'[data-dopesheet-keyframe-id="first"]'
		);
		const last = screen.container.querySelector<HTMLElement>('[data-dopesheet-keyframe-id="last"]');
		const sheet = screen.getByRole('region', { name: 'Keyframe dope sheet' }).element();
		expect(first).not.toBeNull();
		expect(last).not.toBeNull();
		if (!first || !last) return;
		let point = center(first);
		pointer(first, 'pointerdown', point.x, point.y);
		pointer(window, 'pointerup', point.x, point.y);
		point = center(last);
		pointer(last, 'pointerdown', point.x, point.y, { shiftKey: true });
		expect(keyframeSelectionStore.forItem(animatedItem.id)).toEqual(
			new Set(['first', 'middle', 'last'])
		);
		sheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));

		await vi.waitFor(() => {
			expect(timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity).toBeUndefined();
		});
		expect(commandHistory.getLastCommandType()).toBe('REMOVE_KEYFRAMES');
		expect(commandHistory.undoStack).toHaveLength(1);
	});

	it('nudges the selected key one frame with the keyboard', async () => {
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		const first = screen.container.querySelector<HTMLElement>(
			'[data-dopesheet-keyframe-id="first"]'
		);
		const sheet = screen.getByRole('region', { name: 'Keyframe dope sheet' }).element();
		expect(first).not.toBeNull();
		if (!first) return;
		const point = center(first);
		pointer(first, 'pointerdown', point.x, point.y);
		pointer(window, 'pointerup', point.x, point.y);
		sheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		await vi.waitFor(() => {
			expect(timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.frames).toEqual([
				11, 20, 30
			]);
		});
		expect(commandHistory.getLastCommandType()).toBe('UPDATE_KEYFRAMES');
	});

	it('marquee-selects overlapping diamonds across property rows', async () => {
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		const body = screen.container.querySelector<HTMLElement>('.max-h-60');
		const points = [
			...screen.container.querySelectorAll<HTMLElement>('[data-dopesheet-keyframe-id]')
		];
		expect(body).not.toBeNull();
		expect(points).toHaveLength(4);
		if (!body) return;
		const rects = points.map((point) => point.getBoundingClientRect());
		const left = Math.min(...rects.map((rect) => rect.left)) - 5;
		const right = Math.max(...rects.map((rect) => rect.right)) + 5;
		const top = Math.min(...rects.map((rect) => rect.top)) - 5;
		const bottom = Math.max(...rects.map((rect) => rect.bottom)) + 5;
		pointer(body, 'pointerdown', left, top);
		pointer(window, 'pointermove', right, bottom);
		await vi.waitFor(() => {
			expect(keyframeSelectionStore.forItem(animatedItem.id).size).toBe(4);
			expect(screen.container.querySelector('[data-dopesheet-marquee]')).not.toBeNull();
		});
		pointer(window, 'pointerup', right, bottom);
	});

	it('cuts now, moves from the clipboard later, and clears cut state', async () => {
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		const first = screen.container.querySelector<HTMLElement>(
			'[data-dopesheet-keyframe-id="first"]'
		);
		expect(first).not.toBeNull();
		if (!first) return;
		const point = center(first);
		pointer(first, 'pointerdown', point.x, point.y);
		pointer(window, 'pointerup', point.x, point.y);
		await screen.getByRole('button', { name: 'Cut selected keyframes' }).click();
		await vi.waitFor(() => {
			expect(timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.frames).toEqual([
				20, 30
			]);
		});
		expect(keyframeSelectionStore.isCut).toBe(true);
		setCurrentFrame(40);
		await screen.getByRole('button', { name: 'Move keyframes from clipboard' }).click();
		await vi.waitFor(() => {
			expect(timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.frames).toEqual([
				20, 30, 40
			]);
		});
		expect(keyframeSelectionStore.clipboard).toBeNull();
		expect(commandHistory.undoStack).toHaveLength(2);
	});

	it('renders transition-owned ranges in every visible row', async () => {
		transitionsStore.setAll([
			{
				id: 'transition',
				type: 'crossfade',
				durationInFrames: 12,
				fromItemId: animatedItem.id,
				toItemId: 'next'
			}
		]);
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		expect(screen.container.querySelectorAll('[data-dopesheet-transition-blocked]')).toHaveLength(
			2
		);
	});

	it('saves, updates, and removes a reusable custom easing preset', async () => {
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		const middle = screen.container.querySelector<HTMLElement>(
			'[data-dopesheet-keyframe-id="middle"]'
		);
		expect(middle).not.toBeNull();
		if (!middle) return;
		const point = center(middle);
		pointer(middle, 'pointerdown', point.x, point.y);
		pointer(window, 'pointerup', point.x, point.y);

		const name = screen.getByRole('textbox', { name: 'Preset name' });
		await name.fill('My curve');
		await screen.getByRole('button', { name: 'Save preset' }).click();
		expect(JSON.parse(localStorage.getItem(CUSTOM_EASING_PRESETS_STORAGE_KEY) ?? '[]')).toEqual([
			expect.objectContaining({ name: 'My curve', type: 'Easing' })
		]);
		await expect.element(screen.getByRole('button', { name: 'Delete preset' })).toBeVisible();
		await screen.getByRole('button', { name: 'Delete preset' }).click();
		expect(JSON.parse(localStorage.getItem(CUSTOM_EASING_PRESETS_STORAGE_KEY) ?? '[]')).toEqual([]);
	});
});
