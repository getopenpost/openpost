import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { transitionsStore } from '$lib/video-editor/timeline/actions/transitions-store.svelte';
import { keyframeSelectionStore } from '$lib/video-editor/timeline/stores/keyframe-selection-store.svelte';
import TimelinePanel from './timeline-panel.svelte';
import { colorStringToKeyframeValue } from '$lib/video-editor/timeline/color-keyframes';
import { CUSTOM_EASING_PRESETS_STORAGE_KEY } from '$lib/video-editor/timeline/custom-easing-presets';
import { keyboardShortcuts } from '$lib/video-editor/settings/keyboard-shortcuts.svelte';

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
			frames: [0, 30, 59],
			values: [0, 1, 0.5],
			ids: ['first', 'middle', 'last'],
			easings: ['linear', 'cubic-bezier', 'linear'],
			easingConfigs: [
				null,
				{ type: 'cubic-bezier', bezier: { x1: 0.2, y1: 0.8, x2: 0.4, y2: 1 } },
				null
			]
		}
	}
};

function pointer(
	target: EventTarget,
	type: 'pointerdown' | 'pointermove' | 'pointerup',
	x: number,
	y: number,
	options: { altKey?: boolean; shiftKey?: boolean } = {}
): void {
	target.dispatchEvent(
		new PointerEvent(type, {
			bubbles: true,
			button: 0,
			buttons: type === 'pointerup' ? 0 : 1,
			clientX: x,
			clientY: y,
			pointerId: 13,
			...options
		})
	);
}

function frameForKeyframe(id: string): number | undefined {
	const track = timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity;
	const index = track?.ids?.indexOf(id) ?? -1;
	return index >= 0 ? track?.frames[index] : undefined;
}

async function renderTimelinePanel(props: {
	onedit: () => void;
	selectedItemId: string;
	selectedItemIds: string[];
}) {
	const screen = await render(TimelinePanel, props);
	await screen.getByRole('button', { name: 'Keyframes' }).click();
	return screen;
}

beforeEach(() => {
	localStorage.removeItem(CUSTOM_EASING_PRESETS_STORAGE_KEY);
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	keyframeSelectionStore.clear();
	keyboardShortcuts.resetAll();
	transitionsStore.clear();
	timelineStore.setAll({
		tracks: [videoTrack],
		items: [structuredClone(animatedItem)],
		fps: 30
	});
});

describe('KeyframeValueGraph', () => {
	it('exposes coupled scale as percentage X and Y graph rows', async () => {
		const scaled: TimelineItem = {
			...animatedItem,
			transform: { width: 400, height: 200 },
			keyframes: {},
			vectorKeyframes: {
				scale: [
					{
						id: 'scale-a',
						frame: 0,
						value: { x: 100, y: 100 },
						easing: 'linear'
					},
					{
						id: 'scale-b',
						frame: 30,
						value: { x: 200, y: 50 },
						easing: 'linear'
					}
				]
			}
		};
		timelineStore.setAll({ tracks: [videoTrack], items: [scaled], fps: 30 });
		const screen = await renderTimelinePanel({
			onedit: vi.fn(),
			selectedItemId: scaled.id,
			selectedItemIds: [scaled.id]
		});
		await screen.getByRole('button', { name: 'Scale X', exact: true }).click();
		await screen.getByRole('button', { name: 'Keyframe view' }).click();
		await screen.getByRole('option', { name: 'Graph' }).click();
		await expect
			.element(
				screen.getByRole('application', {
					name: 'Keyframe value graph for Scale X'
				})
			)
			.toBeVisible();
		expect(screen.container.textContent).toContain('%');
	});

	it('renders sampled curves, a playhead, and accessible keyframe controls', async () => {
		const screen = await renderTimelinePanel({
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Keyframe view' }).click();
		await screen.getByRole('option', { name: 'Graph' }).click();

		const graph = screen.getByRole('application', {
			name: 'Keyframe value graph for opacity'
		});
		await expect.element(graph).toBeVisible();
		expect(screen.container.querySelectorAll('[data-keyframe-curve]')).toHaveLength(2);
		expect(screen.container.querySelectorAll('g[aria-label*="opacity keyframe"]')).toHaveLength(3);
		expect(screen.container.querySelector('[aria-label="Graph playhead"]')).not.toBeNull();
	});

	it('opens target-aware keyframe actions by pointer and keyboard', async () => {
		const onedit = vi.fn();
		const screen = await renderTimelinePanel({
			onedit,
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Keyframe view' }).click();
		await screen.getByRole('option', { name: 'Graph' }).click();
		const first = screen.getByRole('button', { name: 'opacity keyframe at frame 0' }).element();
		const middle = screen.getByRole('button', { name: 'opacity keyframe at frame 30' }).element();

		first.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
		first.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
		middle.dispatchEvent(
			new MouseEvent('contextmenu', {
				bubbles: true,
				cancelable: true,
				clientX: 320,
				clientY: 160
			})
		);

		await expect
			.element(screen.getByRole('menuitem', { name: /^Copy selected keyframes/ }))
			.toBeVisible();
		expect(keyframeSelectionStore.forItem(animatedItem.id)).toEqual(new Set(['middle']));
		await screen.getByRole('menuitem', { name: /^Delete/ }).click();
		await vi.waitFor(() => expect(frameForKeyframe('middle')).toBeUndefined());
		expect(onedit).toHaveBeenCalledOnce();

		const graph = screen
			.getByRole('application', {
				name: 'Keyframe value graph for opacity'
			})
			.element();
		graph.focus();
		await userEvent.keyboard('{Shift>}{F10}{/Shift}');
		await expect
			.element(screen.getByRole('menuitem', { name: /^Select all graph keyframes/ }))
			.toBeVisible();
	});

	it('moves a keyframe in frame and value as one undoable graph gesture', async () => {
		const onedit = vi.fn();
		const screen = await renderTimelinePanel({
			onedit,
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Keyframe view' }).click();
		await screen.getByRole('option', { name: 'Graph' }).click();
		const first = screen.container.querySelector<SVGGElement>(
			'g[aria-label="opacity keyframe at frame 0"]'
		);
		const middle = screen.container.querySelector<SVGGElement>(
			'g[aria-label="opacity keyframe at frame 30"]'
		);
		const svg = screen.container.querySelector<SVGSVGElement>(
			'svg[aria-label="Editable curves and keyframes"]'
		);
		expect(first).not.toBeNull();
		expect(middle).not.toBeNull();
		expect(svg).not.toBeNull();
		if (!first || !middle || !svg) return;
		const hit = first.querySelector('circle');
		const middleHit = middle.querySelector('circle');
		const rect = svg.getBoundingClientRect();
		const viewWidth = Number(svg.viewBox.baseVal.width);
		const viewHeight = Number(svg.viewBox.baseVal.height);
		const x = rect.left + (Number(hit?.getAttribute('cx')) / viewWidth) * rect.width;
		const y = rect.top + (Number(hit?.getAttribute('cy')) / viewHeight) * rect.height;
		const middleX = rect.left + (Number(middleHit?.getAttribute('cx')) / viewWidth) * rect.width;
		const targetX = x + (middleX - x) / 3;

		pointer(first, 'pointerdown', x, y);
		pointer(svg, 'pointermove', targetX, y - rect.height * 0.1);
		pointer(svg, 'pointerup', targetX, y - rect.height * 0.1);

		await vi.waitFor(() => {
			expect(frameForKeyframe('first')).toBe(10);
			const track = timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity;
			const index = track?.ids?.indexOf('first') ?? -1;
			expect(index).toBeGreaterThanOrEqual(0);
			expect(track?.values[index]).toBeGreaterThan(0);
		});
		expect(commandHistory.getLastCommandType()).toBe('UPDATE_KEYFRAMES');
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();
	});

	it('duplicates instead of moving when Alt is held at drag start', async () => {
		const screen = await renderTimelinePanel({
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Keyframe view' }).click();
		await screen.getByRole('option', { name: 'Graph' }).click();
		const middle = screen.container.querySelector<SVGGElement>(
			'g[aria-label="opacity keyframe at frame 30"]'
		);
		const svg = screen.container.querySelector<SVGSVGElement>(
			'svg[aria-label="Editable curves and keyframes"]'
		);
		expect(middle).not.toBeNull();
		expect(svg).not.toBeNull();
		if (!middle || !svg) return;
		const hit = middle.querySelector('circle');
		const rect = svg.getBoundingClientRect();
		const x =
			rect.left + (Number(hit?.getAttribute('cx')) / svg.viewBox.baseVal.width) * rect.width;
		const y =
			rect.top + (Number(hit?.getAttribute('cy')) / svg.viewBox.baseVal.height) * rect.height;

		pointer(middle, 'pointerdown', x, y, { altKey: true });
		pointer(svg, 'pointermove', x + rect.width * 0.12, y, { altKey: true });
		pointer(svg, 'pointerup', x + rect.width * 0.12, y, { altKey: true });

		await vi.waitFor(() => {
			expect(timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.frames).toHaveLength(
				4
			);
		});
		const track = timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity;
		expect(track).toMatchObject({
			easings: ['linear', 'cubic-bezier', 'cubic-bezier', 'linear']
		});
		expect(track?.frames).toHaveLength(4);
		expect(track?.frames[2]).toBeGreaterThanOrEqual(37);
		expect(track?.frames[2]).toBeLessThanOrEqual(38);
		expect(commandHistory.getLastCommandType()).toBe('DUPLICATE_KEYFRAMES');
	});

	it('uses FreeCut fine adjustment when Alt is pressed after a move starts', async () => {
		const screen = await renderTimelinePanel({
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Keyframe view' }).click();
		await screen.getByRole('option', { name: 'Graph' }).click();
		const first = screen.container.querySelector<SVGGElement>(
			'g[aria-label="opacity keyframe at frame 0"]'
		);
		const middle = screen.container.querySelector<SVGGElement>(
			'g[aria-label="opacity keyframe at frame 30"]'
		);
		const svg = screen.container.querySelector<SVGSVGElement>(
			'svg[aria-label="Editable curves and keyframes"]'
		);
		expect(first).not.toBeNull();
		expect(middle).not.toBeNull();
		expect(svg).not.toBeNull();
		if (!first || !middle || !svg) return;
		const hit = first.querySelector('circle');
		const middleHit = middle.querySelector('circle');
		const rect = svg.getBoundingClientRect();
		const x =
			rect.left + (Number(hit?.getAttribute('cx')) / svg.viewBox.baseVal.width) * rect.width;
		const y =
			rect.top + (Number(hit?.getAttribute('cy')) / svg.viewBox.baseVal.height) * rect.height;
		const middleX =
			rect.left + (Number(middleHit?.getAttribute('cx')) / svg.viewBox.baseVal.width) * rect.width;
		const targetX = x + (middleX - x) / 3;

		pointer(first, 'pointerdown', x, y);
		pointer(svg, 'pointermove', targetX, y, { altKey: true });
		pointer(svg, 'pointerup', targetX, y, { altKey: true });

		await vi.waitFor(() => {
			expect(frameForKeyframe('first')).toBe(5);
		});
		expect(commandHistory.getLastCommandType()).toBe('UPDATE_KEYFRAMES');
	});

	it('shows transition-owned frames and clamps a graph move before them', async () => {
		transitionsStore.setAll([
			{
				id: 'transition',
				type: 'crossfade',
				durationInFrames: 12,
				fromItemId: animatedItem.id,
				toItemId: 'next-video'
			}
		]);
		const screen = await renderTimelinePanel({
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Keyframe view' }).click();
		await screen.getByRole('option', { name: 'Graph' }).click();
		expect(screen.container.querySelector('[data-transition-blocked-range]')).not.toBeNull();
		const middle = screen.container.querySelector<SVGGElement>(
			'g[aria-label="opacity keyframe at frame 30"]'
		);
		const svg = screen.container.querySelector<SVGSVGElement>(
			'svg[aria-label="Editable curves and keyframes"]'
		);
		expect(middle).not.toBeNull();
		expect(svg).not.toBeNull();
		if (!middle || !svg) return;
		const hit = middle.querySelector('circle');
		const rect = svg.getBoundingClientRect();
		const x =
			rect.left + (Number(hit?.getAttribute('cx')) / svg.viewBox.baseVal.width) * rect.width;
		const y =
			rect.top + (Number(hit?.getAttribute('cy')) / svg.viewBox.baseVal.height) * rect.height;

		pointer(middle, 'pointerdown', x, y);
		pointer(svg, 'pointermove', x + rect.width * 0.5, y);
		pointer(svg, 'pointerup', x + rect.width * 0.5, y);

		await vi.waitFor(() => {
			expect(timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.frames).toEqual([
				0, 53, 59
			]);
		});
		expect(commandHistory.getLastCommandType()).toBe('UPDATE_KEYFRAMES');
	});

	it('commits cubic bezier handle edits on pointer release', async () => {
		const onedit = vi.fn();
		const screen = await renderTimelinePanel({
			onedit,
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Keyframe view' }).click();
		await screen.getByRole('option', { name: 'Graph' }).click();
		const middle = screen.container.querySelector<SVGGElement>(
			'g[aria-label="opacity keyframe at frame 30"]'
		);
		expect(middle).not.toBeNull();
		middle?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await vi.waitFor(() => {
			expect(
				screen.container.querySelector('[aria-label="Outgoing easing handle"]')
			).not.toBeNull();
		});
		const handle = screen.container.querySelector<SVGCircleElement>(
			'[aria-label="Outgoing easing handle"]'
		);
		const svg = screen.container.querySelector<SVGSVGElement>(
			'svg[aria-label="Editable curves and keyframes"]'
		);
		expect(handle).not.toBeNull();
		expect(svg).not.toBeNull();
		if (!handle || !svg) return;
		const rect = svg.getBoundingClientRect();
		const x =
			rect.left + (Number(handle.getAttribute('cx')) / svg.viewBox.baseVal.width) * rect.width;
		const y =
			rect.top + (Number(handle.getAttribute('cy')) / svg.viewBox.baseVal.height) * rect.height;

		pointer(handle, 'pointerdown', x, y);
		pointer(svg, 'pointermove', x + 24, y - 12);
		pointer(svg, 'pointerup', x + 24, y - 12);

		await vi.waitFor(() => {
			const config = timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity
				?.easingConfigs?.[1];
			expect(config?.type).toBe('cubic-bezier');
			expect(config?.bezier?.x1).toBeGreaterThan(0.2);
			expect(config?.bezier?.y1).not.toBeCloseTo(0.8);
		});
		expect(commandHistory.getLastCommandType()).toBe('SET_KEYFRAME_EASING');
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();
	});

	it('mirrors a middle-key tangent into the adjacent segment as one undo step', async () => {
		const smoothItem = structuredClone(animatedItem);
		if (!smoothItem.keyframes?.opacity) throw new Error('Expected opacity keyframes');
		smoothItem.keyframes.opacity.easings = ['cubic-bezier', 'cubic-bezier', 'linear'];
		smoothItem.keyframes.opacity.easingConfigs = [
			{
				type: 'cubic-bezier',
				bezier: { x1: 0.25, y1: 0.2, x2: 0.72, y2: 0.8 }
			},
			{ type: 'cubic-bezier', bezier: { x1: 0.2, y1: 0.8, x2: 0.4, y2: 1 } },
			null
		];
		timelineStore.setAll({
			tracks: [videoTrack],
			items: [smoothItem],
			fps: 30
		});
		const onedit = vi.fn();
		const screen = await renderTimelinePanel({
			onedit,
			selectedItemId: smoothItem.id,
			selectedItemIds: [smoothItem.id]
		});
		await screen.getByRole('button', { name: 'Keyframe view' }).click();
		await screen.getByRole('option', { name: 'Graph' }).click();
		const middle = screen.container.querySelector<SVGGElement>(
			'g[aria-label="opacity keyframe at frame 30"]'
		);
		middle?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await vi.waitFor(() => {
			expect(
				screen.container.querySelectorAll('[aria-label="Outgoing easing handle"]')
			).toHaveLength(2);
		});
		const handles = screen.container.querySelectorAll<SVGCircleElement>(
			'[aria-label="Outgoing easing handle"]'
		);
		const handle = handles[1];
		const svg = screen.container.querySelector<SVGSVGElement>(
			'svg[aria-label="Editable curves and keyframes"]'
		);
		expect(handle && svg).toBeTruthy();
		if (!handle || !svg) return;
		const rect = svg.getBoundingClientRect();
		const x =
			rect.left + (Number(handle.getAttribute('cx')) / svg.viewBox.baseVal.width) * rect.width;
		const y =
			rect.top + (Number(handle.getAttribute('cy')) / svg.viewBox.baseVal.height) * rect.height;

		pointer(handle, 'pointerdown', x, y);
		pointer(svg, 'pointermove', x + 30, y - 18);
		pointer(svg, 'pointerup', x + 30, y - 18);

		await vi.waitFor(() => {
			const configs = timelineStore.itemById.get(smoothItem.id)?.keyframes?.opacity?.easingConfigs;
			expect(configs?.[1]?.bezier?.x1).toBeGreaterThan(0.2);
			expect(configs?.[0]?.bezier?.x2).not.toBeCloseTo(0.72);
			expect(configs?.[0]?.bezier?.y2).not.toBeCloseTo(0.8);
		});
		expect(commandHistory.getLastCommandType()).toBe('SET_KEYFRAME_EASINGS');
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();
	});

	it('discards a bezier preview when pointer capture is lost', async () => {
		const screen = await renderTimelinePanel({
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Keyframe view' }).click();
		await screen.getByRole('option', { name: 'Graph' }).click();
		const middle = screen.container.querySelector<SVGGElement>(
			'g[aria-label="opacity keyframe at frame 30"]'
		);
		middle?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await vi.waitFor(() => {
			expect(
				screen.container.querySelector('[aria-label="Outgoing easing handle"]')
			).not.toBeNull();
		});
		const handle = screen.container.querySelector<SVGCircleElement>(
			'[aria-label="Outgoing easing handle"]'
		);
		const svg = screen.container.querySelector<SVGSVGElement>(
			'svg[aria-label="Editable curves and keyframes"]'
		);
		expect(handle && svg).toBeTruthy();
		if (!handle || !svg) return;
		const before = JSON.parse(
			JSON.stringify(timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.easingConfigs)
		);
		const rect = svg.getBoundingClientRect();
		const x =
			rect.left + (Number(handle.getAttribute('cx')) / svg.viewBox.baseVal.width) * rect.width;
		const y =
			rect.top + (Number(handle.getAttribute('cy')) / svg.viewBox.baseVal.height) * rect.height;

		pointer(handle, 'pointerdown', x, y);
		pointer(svg, 'pointermove', x + 24, y - 12);
		svg.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 13 }));

		expect(timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.easingConfigs).toEqual(
			before
		);
		expect(commandHistory.undoStack).toHaveLength(0);
	});

	it('previews exact bezier numbers, cancels cleanly, and commits once', async () => {
		const screen = await renderTimelinePanel({
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Keyframe view' }).click();
		await screen.getByRole('option', { name: 'Graph' }).click();
		const middle = screen.container.querySelector<SVGGElement>(
			'g[aria-label="opacity keyframe at frame 30"]'
		);
		middle?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		const pill = screen.container.querySelector<SVGGElement>('[data-segment-easing="30"]');
		expect(pill).not.toBeNull();
		pill?.dispatchEvent(
			new PointerEvent('pointerdown', {
				bubbles: true,
				button: 0,
				pointerId: 21
			})
		);
		await vi.waitFor(() => {
			expect(screen.container.querySelector('[data-bezier-gesture]')).not.toBeNull();
		});
		const x1 = screen.container.querySelector<HTMLInputElement>(
			'[data-bezier-gesture] input[type="number"]'
		);
		expect(x1).not.toBeNull();
		if (!x1) return;

		x1.value = '0.61';
		x1.dispatchEvent(new Event('input', { bubbles: true }));
		expect(
			timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.easingConfigs?.[1]?.bezier
				?.x1
		).toBe(0.2);
		x1.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(commandHistory.undoStack).toHaveLength(0);
		expect(
			timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.easingConfigs?.[1]?.bezier
				?.x1
		).toBe(0.2);

		x1.value = '0.61';
		x1.dispatchEvent(new Event('input', { bubbles: true }));
		x1.dispatchEvent(new Event('change', { bubbles: true }));
		await vi.waitFor(() => {
			expect(
				timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.easingConfigs?.[1]?.bezier
					?.x1
			).toBe(0.61);
		});
		expect(commandHistory.undoStack).toHaveLength(1);
	});

	it('keeps every dense segment directly keyboard-reachable while culling labels', async () => {
		const dense = structuredClone(animatedItem);
		if (!dense.keyframes?.opacity) throw new Error('Expected opacity keyframes');
		dense.keyframes.opacity = {
			frames: Array.from({ length: 20 }, (_, index) => index * 3),
			values: Array.from({ length: 20 }, (_, index) => (index % 2 === 0 ? 0.2 : 0.8)),
			ids: Array.from({ length: 20 }, (_, index) => `dense-${index}`),
			easings: Array.from({ length: 20 }, () => 'linear'),
			easingConfigs: Array.from({ length: 20 }, () => null)
		};
		timelineStore.setAll({ tracks: [videoTrack], items: [dense], fps: 30 });
		const screen = await renderTimelinePanel({
			onedit: vi.fn(),
			selectedItemId: dense.id,
			selectedItemIds: [dense.id]
		});
		await screen.getByRole('button', { name: 'Keyframe view' }).click();
		await screen.getByRole('option', { name: 'Graph' }).click();
		const segments = screen.container.querySelectorAll<SVGGElement>('[data-segment-easing]');
		expect(segments).toHaveLength(19);
		expect(screen.container.querySelectorAll('[data-segment-easing] rect').length).toBeLessThan(19);
		const hiddenLabelSegment = Array.from(segments).find(
			(segment) => !segment.querySelector('rect')
		);
		expect(hiddenLabelSegment).toBeDefined();
		hiddenLabelSegment?.focus();
		expect(document.activeElement).toBe(hiddenLabelSegment);
		hiddenLabelSegment?.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
		);
		await vi.waitFor(() => {
			expect(screen.container.querySelector('[data-segment-menu]')).not.toBeNull();
		});
	});

	it('saves and deletes a named custom easing and surfaces storage failure', async () => {
		const screen = await renderTimelinePanel({
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Keyframe view' }).click();
		await screen.getByRole('option', { name: 'Graph' }).click();
		const middle = screen.container.querySelector<SVGGElement>(
			'g[aria-label="opacity keyframe at frame 30"]'
		);
		middle?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		const pill = screen.container.querySelector<SVGGElement>('[data-segment-easing="30"]');
		pill?.dispatchEvent(
			new PointerEvent('pointerdown', {
				bubbles: true,
				button: 0,
				pointerId: 22
			})
		);
		await vi.waitFor(() => {
			expect(screen.container.querySelector('[data-segment-menu]')).not.toBeNull();
		});
		const name = screen.getByTestId('segment-preset-name');
		await name.fill('Precise ease');
		await screen.getByTestId('segment-preset-save').click();
		await vi.waitFor(() => {
			expect(localStorage.getItem(CUSTOM_EASING_PRESETS_STORAGE_KEY)).toContain('Precise ease');
		});
		await screen.getByRole('button', { name: 'Delete preset Precise ease' }).click();
		expect(localStorage.getItem(CUSTOM_EASING_PRESETS_STORAGE_KEY)).toBe('[]');

		const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new DOMException('Quota exceeded', 'QuotaExceededError');
		});
		try {
			await name.fill('Cannot save');
			await screen.getByTestId('segment-preset-save').click();
			await expect
				.element(screen.getByRole('alert'))
				.toHaveTextContent('The preset could not be saved.');
		} finally {
			write.mockRestore();
		}
	});

	it('marquee-selects every graph diamond it overlaps', async () => {
		const screen = await renderTimelinePanel({
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Keyframe view' }).click();
		await screen.getByRole('option', { name: 'Graph' }).click();
		const svg = screen.container.querySelector<SVGSVGElement>(
			'svg[aria-label="Editable curves and keyframes"]'
		);
		const groups = [
			...screen.container.querySelectorAll<SVGGElement>('g[aria-label*="opacity keyframe"]')
		];
		expect(svg).not.toBeNull();
		expect(groups).toHaveLength(3);
		if (!svg) return;
		const rect = svg.getBoundingClientRect();
		const centers = groups.map((group) => {
			const hit = group.querySelector('circle');
			return {
				x: rect.left + (Number(hit?.getAttribute('cx')) / svg.viewBox.baseVal.width) * rect.width,
				y: rect.top + (Number(hit?.getAttribute('cy')) / svg.viewBox.baseVal.height) * rect.height
			};
		});
		const left = Math.min(...centers.map((center) => center.x)) - 10;
		const right = Math.max(...centers.map((center) => center.x)) + 10;
		const top = Math.min(...centers.map((center) => center.y)) - 10;
		const bottom = Math.max(...centers.map((center) => center.y)) + 10;

		pointer(svg, 'pointerdown', left, top);
		pointer(svg, 'pointermove', right, bottom);
		expect(keyframeSelectionStore.forItem(animatedItem.id).size).toBe(3);
		await vi.waitFor(() => {
			expect(screen.container.querySelector('rect[stroke-dasharray="3 2"]')).not.toBeNull();
		});
		pointer(svg, 'pointerup', right, bottom);
	});

	it('labels color lanes, formats hex ticks, and keeps keyboard edits frame-only', async () => {
		const property = 'effect:gpu-ascii:ascii-effect:textColor' as const;
		timelineStore.setAll({
			items: [
				{
					...animatedItem,
					effects: [
						{
							id: 'ascii-effect',
							type: 'gpu',
							effectId: 'gpu-ascii',
							enabled: true,
							params: { matchSourceColor: false, textColor: '#ff0000' }
						}
					],
					keyframes: {
						[property]: {
							frames: [0, 30],
							values: [
								colorStringToKeyframeValue('#ff0000')!,
								colorStringToKeyframeValue('#0000ff')!
							],
							ids: ['red', 'blue']
						}
					}
				}
			]
		});
		const screen = await renderTimelinePanel({
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByText('ASCII: Text Color', { exact: true }).click();
		await screen.getByRole('button', { name: 'Keyframe view' }).click();
		await screen.getByRole('option', { name: 'Graph' }).click();
		await expect
			.element(
				screen.getByRole('application', {
					name: 'Keyframe value graph for ASCII: Text Color'
				})
			)
			.toBeVisible();
		expect(screen.container.textContent).toMatch(/#[0-9a-f]{6}/);

		const red = screen.container.querySelector<SVGGElement>(
			'g[aria-label="ASCII: Text Color keyframe at frame 0"]'
		);
		expect(red).not.toBeNull();
		red?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		red?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
		expect(timelineStore.itemById.get(animatedItem.id)?.keyframes?.[property]?.values[0]).toBe(
			colorStringToKeyframeValue('#ff0000')
		);
		expect(commandHistory.undoStack).toHaveLength(0);
	});

	it('shows snap guides when dragging near a neighbor frame and snaps with one undo', async () => {
		const screen = await renderTimelinePanel({
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Keyframe view' }).click();
		await screen.getByRole('option', { name: 'Graph' }).click();
		const first = screen.container.querySelector<SVGGElement>(
			'g[aria-label="opacity keyframe at frame 0"]'
		);
		const second = screen.container.querySelector<SVGGElement>(
			'g[aria-label="opacity keyframe at frame 30"]'
		);
		const svg = screen.container.querySelector<SVGSVGElement>(
			'svg[aria-label="Editable curves and keyframes"]'
		);
		expect(first).not.toBeNull();
		expect(second).not.toBeNull();
		expect(svg).not.toBeNull();
		if (!first || !second || !svg) return;
		const hit = first.querySelector('circle');
		const secondHit = second.querySelector('circle');
		const rect = svg.getBoundingClientRect();
		const x =
			rect.left + (Number(hit?.getAttribute('cx')) / svg.viewBox.baseVal.width) * rect.width;
		const y =
			rect.top + (Number(hit?.getAttribute('cy')) / svg.viewBox.baseVal.height) * rect.height;
		const secondX =
			rect.left + (Number(secondHit?.getAttribute('cx')) / svg.viewBox.baseVal.width) * rect.width;
		pointer(first, 'pointerdown', x, y);
		// Move to within ~4px of neighbor frame 30
		pointer(svg, 'pointermove', secondX - 3, y);
		await vi.waitFor(() => {
			expect(screen.container.querySelector('[data-snap-guide="frame"]')).not.toBeNull();
		});
		pointer(svg, 'pointerup', secondX - 3, y);
		await vi.waitFor(() => {
			const frames = timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.frames;
			expect(frames?.[0]).toBe(30);
		});
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.frames?.[0]).toBe(0);
		expect(screen.container.querySelector('[data-snap-guide="frame"]')).toBeNull();
	});

	it('honors the shared snap setting, guides disappear when disabled, and Ctrl bypasses snap', async () => {
		timelineStore._setSnapEnabled(false);
		const screen = await renderTimelinePanel({
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Keyframe view' }).click();
		await screen.getByRole('option', { name: 'Graph' }).click();
		expect(screen.container.textContent).toContain('Snap off');
		const first = screen.container.querySelector<SVGGElement>(
			'g[aria-label="opacity keyframe at frame 0"]'
		);
		const middle = screen.container.querySelector<SVGGElement>(
			'g[aria-label="opacity keyframe at frame 30"]'
		);
		const svg = screen.container.querySelector<SVGSVGElement>(
			'svg[aria-label="Editable curves and keyframes"]'
		);
		expect(first && middle && svg).not.toBeNull();
		if (!first || !middle || !svg) return;
		const hit = first.querySelector('circle');
		const middleHit = middle.querySelector('circle');
		const rect = svg.getBoundingClientRect();
		const x =
			rect.left + (Number(hit?.getAttribute('cx')) / svg.viewBox.baseVal.width) * rect.width;
		const y =
			rect.top + (Number(hit?.getAttribute('cy')) / svg.viewBox.baseVal.height) * rect.height;
		const middleX =
			rect.left + (Number(middleHit?.getAttribute('cx')) / svg.viewBox.baseVal.width) * rect.width;
		const targetX = x + ((middleX - x) * 28) / 30;
		pointer(first, 'pointerdown', x, y);
		pointer(svg, 'pointermove', targetX, y);
		expect(screen.container.querySelector('[data-snap-guide="frame"]')).toBeNull();
		pointer(svg, 'pointerup', targetX, y);
		await vi.waitFor(() => {
			expect(frameForKeyframe('first')).toBe(28);
		});
		// Re-enable and verify Ctrl bypass when snap is enabled
		timelineStore._setSnapEnabled(true);
		commandHistory.clearHistory();
		timelineStore.setAll({
			tracks: [videoTrack],
			items: [structuredClone(animatedItem)],
			fps: 30
		});
		await screen.getByRole('button', { name: 'Keyframe view' }).click();
		await screen.getByRole('option', { name: 'Graph' }).click();
		const first2 = screen.container.querySelector<SVGGElement>(
			'g[aria-label="opacity keyframe at frame 0"]'
		);
		const middle2 = screen.container.querySelector<SVGGElement>(
			'g[aria-label="opacity keyframe at frame 30"]'
		);
		const svg2 = screen.container.querySelector<SVGSVGElement>(
			'svg[aria-label="Editable curves and keyframes"]'
		);
		if (!first2 || !middle2 || !svg2) return;
		const hit2 = first2.querySelector('circle');
		const middleHit2 = middle2.querySelector('circle');
		const rect2 = svg2.getBoundingClientRect();
		const x2 =
			rect2.left + (Number(hit2?.getAttribute('cx')) / svg2.viewBox.baseVal.width) * rect2.width;
		const y2 =
			rect2.top + (Number(hit2?.getAttribute('cy')) / svg2.viewBox.baseVal.height) * rect2.height;
		const middleX2 =
			rect2.left +
			(Number(middleHit2?.getAttribute('cx')) / svg2.viewBox.baseVal.width) * rect2.width;
		const targetX2 = x2 + ((middleX2 - x2) * 28) / 30;
		pointer(first2, 'pointerdown', x2, y2);
		svg2.dispatchEvent(
			new PointerEvent('pointermove', {
				bubbles: true,
				clientX: targetX2,
				clientY: y2,
				ctrlKey: true,
				pointerId: 13
			})
		);
		expect(screen.container.querySelector('[data-snap-guide="frame"]')).toBeNull();
		svg2.dispatchEvent(
			new PointerEvent('pointerup', {
				bubbles: true,
				clientX: targetX2,
				clientY: y2,
				ctrlKey: true,
				pointerId: 13
			})
		);
		await vi.waitFor(() => {
			expect(frameForKeyframe('first')).toBe(28);
		});
	});

	it('keeps the segment menu open for spring edits, commits one undo on release, and cancels on Escape', async () => {
		const screen = await renderTimelinePanel({
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Keyframe view' }).click();
		await screen.getByRole('option', { name: 'Graph' }).click();
		// Make pills visible by selecting a keyframe (required by dense-aware rendering)
		const firstPoint = screen.container.querySelector<SVGGElement>(
			'g[aria-label="opacity keyframe at frame 0"]'
		);
		firstPoint?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await vi.waitFor(() => {
			expect(screen.container.textContent).toContain('1 selected');
		});
		const pillGroup = screen.container.querySelector<HTMLElement>('[data-segment-easing="0"]');
		expect(pillGroup).not.toBeNull();
		const pill = pillGroup?.querySelector('rect') ?? pillGroup;
		expect(pill).not.toBeNull();
		pill?.dispatchEvent(
			new PointerEvent('pointerdown', {
				bubbles: true,
				button: 0,
				clientX: 0,
				clientY: 0,
				pointerId: 1
			})
		);
		await vi.waitFor(() => {
			expect(screen.container.querySelector('[data-segment-menu]')).not.toBeNull();
		});
		const springBtn = Array.from(screen.container.querySelectorAll('button')).find((b) =>
			b.textContent?.includes('Spring')
		);
		expect(springBtn).not.toBeNull();
		springBtn?.click();
		await vi.waitFor(() => {
			expect(screen.container.querySelector('[data-segment-menu]')).not.toBeNull();
			expect(screen.container.querySelector('[data-spring-gesture]')).not.toBeNull();
		});
		expect(timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.easings?.[0]).toBe(
			'spring'
		);
		expect(commandHistory.undoStack).toHaveLength(1);
		// Drag tension slider but cancel with Escape - should rollback to previous spring value
		const slider = screen.getByRole('slider', { name: 'Tension' }).element();
		const before = timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity
			?.easingConfigs?.[0];
		slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(
			timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.easingConfigs?.[0]
		).toEqual(before);
		// Now commit with change
		slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
		slider.dispatchEvent(new KeyboardEvent('keyup', { key: 'End', bubbles: true }));
		await vi.waitFor(() => {
			expect(
				timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.easingConfigs?.[0]?.spring
					?.tension
			).toBe(1000);
		});
		expect(commandHistory.undoStack).toHaveLength(2);
		commandHistory.undo();
		expect(timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.easings?.[0]).toBe(
			'spring'
		);
		commandHistory.undo();
		await vi.waitFor(() => {
			expect(timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.easings?.[0]).toBe(
				'linear'
			);
			expect(screen.container.querySelector('[data-spring-gesture]')).toBeNull();
		});
	});

	it('moves a selected keyframe with base and fast nudge catalog bindings and one undo', async () => {
		const screen = await renderTimelinePanel({
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Keyframe view' }).click();
		await screen.getByRole('option', { name: 'Graph' }).click();
		const point = screen.container.querySelector<SVGGElement>(
			'g[aria-label="opacity keyframe at frame 0"]'
		);
		const app = screen.container.querySelector<HTMLElement>('[role="application"]');
		expect(point && app).not.toBeNull();
		point?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await vi.waitFor(() => {
			expect(screen.container.textContent).toContain('1 selected');
		});
		app?.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'ArrowRight',
				code: 'ArrowRight',
				bubbles: true
			})
		);
		await vi.waitFor(() => {
			expect(timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.frames?.[0]).toBe(1);
		});
		expect(commandHistory.undoStack).toHaveLength(1);
		app?.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'ArrowRight',
				code: 'ArrowRight',
				shiftKey: true,
				bubbles: true
			})
		);
		await vi.waitFor(() => {
			expect(timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.frames?.[0]).toBe(11);
		});
		expect(commandHistory.undoStack).toHaveLength(2);
		commandHistory.undo();
		expect(timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.frames?.[0]).toBe(1);
	});

	it('honors remapped and unassigned graph bindings', async () => {
		const screen = await renderTimelinePanel({
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Keyframe view' }).click();
		await screen.getByRole('option', { name: 'Graph' }).click();
		const point = screen.container.querySelector<SVGGElement>(
			'g[aria-label="opacity keyframe at frame 0"]'
		);
		const app = screen
			.getByRole('application', {
				name: 'Keyframe value graph for opacity'
			})
			.element();
		point?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		keyboardShortcuts.setBinding('GRAPH_NUDGE_RIGHT', 'alt+8');
		app.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true })
		);
		expect(timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.frames?.[0]).toBe(0);
		point?.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: '8',
				code: 'Digit8',
				altKey: true,
				bubbles: true
			})
		);
		await vi.waitFor(() => {
			expect(timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.frames?.[0]).toBe(1);
		});
		keyboardShortcuts.unbind('GRAPH_NUDGE_RIGHT');
		point?.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: '8',
				code: 'Digit8',
				altKey: true,
				bubbles: true
			})
		);
		expect(timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.frames?.[0]).toBe(1);
	});

	it('cancels an active drag on Escape and at 320px keeps controls without overflow', async () => {
		await page.viewport(320, 700);
		const screen = await renderTimelinePanel({
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Keyframe view' }).click();
		await screen.getByRole('option', { name: 'Graph' }).click();
		const app = screen.container.querySelector<HTMLElement>('[role="application"]');
		const first = screen.container.querySelector<SVGGElement>(
			'g[aria-label="opacity keyframe at frame 0"]'
		);
		const svg = screen.container.querySelector<SVGSVGElement>(
			'svg[aria-label="Editable curves and keyframes"]'
		);
		expect(first && svg && app).not.toBeNull();
		if (!first || !svg || !app) {
			await page.viewport(1280, 800);
			return;
		}
		const hit = first.querySelector('circle');
		const rect = svg.getBoundingClientRect();
		const x =
			rect.left + (Number(hit?.getAttribute('cx')) / svg.viewBox.baseVal.width) * rect.width;
		const y =
			rect.top + (Number(hit?.getAttribute('cy')) / svg.viewBox.baseVal.height) * rect.height;
		pointer(first, 'pointerdown', x, y);
		pointer(svg, 'pointermove', x + rect.width * 0.2, y);
		await vi.waitFor(() => {
			expect(timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.frames?.[0]).toBe(0);
		});
		app.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'Escape',
				code: 'Escape',
				bubbles: true
			})
		);
		await vi.waitFor(() => {
			expect(timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.frames?.[0]).toBe(0);
		});
		expect(commandHistory.undoStack).toHaveLength(0);
		const host = screen.container.querySelector<HTMLElement>('[data-keyframe-value-graph]');
		expect(host).not.toBeNull();
		if (host) {
			await vi.waitFor(() => {
				expect(host.clientWidth).toBeGreaterThan(0);
				expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth + 1);
			});
			const fitBtn = screen.container.querySelector<HTMLButtonElement>(
				'button[aria-label="Fit graph to keyframes"]'
			);
			expect(fitBtn).not.toBeNull();
			fitBtn?.focus();
			expect(document.activeElement).toBe(fitBtn);
			const pill = screen.container.querySelector<HTMLElement>('[data-segment-easing]');
			if (pill) {
				const pillRect = pill.getBoundingClientRect();
				expect(pillRect.left).toBeGreaterThanOrEqual(-1);
				expect(pillRect.right).toBeLessThanOrEqual(host.clientWidth + 1);
				pill.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
				await vi.waitFor(() => {
					const menu = screen.container.querySelector<HTMLElement>('[data-segment-menu]');
					expect(menu).not.toBeNull();
					if (!menu) return;
					expect(menu.scrollWidth).toBeLessThanOrEqual(menu.clientWidth + 1);
					expect(menu.getBoundingClientRect().right).toBeLessThanOrEqual(321);
				});
			}
		}
		await page.viewport(1280, 800);
	});

	it('spring slider pointerup plus change plus lostpointercapture commits once and stays committed', async () => {
		const screen = await renderTimelinePanel({
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Keyframe view' }).click();
		await screen.getByRole('option', { name: 'Graph' }).click();
		const firstPoint = screen.container.querySelector<SVGGElement>(
			'g[aria-label="opacity keyframe at frame 0"]'
		);
		firstPoint?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await vi.waitFor(() => {
			expect(screen.container.textContent).toContain('1 selected');
		});
		const pillGroup = screen.container.querySelector<HTMLElement>('[data-segment-easing="0"]');
		expect(pillGroup).not.toBeNull();
		const pill = pillGroup?.querySelector('rect') ?? pillGroup;
		pill?.dispatchEvent(
			new PointerEvent('pointerdown', {
				bubbles: true,
				button: 0,
				clientX: 0,
				clientY: 0,
				pointerId: 1
			})
		);
		await vi.waitFor(() => {
			expect(screen.container.querySelector('[data-segment-menu]')).not.toBeNull();
		});
		const springBtn = Array.from(screen.container.querySelectorAll('button')).find((b) =>
			b.textContent?.includes('Spring')
		);
		springBtn?.click();
		await vi.waitFor(() => {
			expect(screen.container.querySelector('[data-spring-gesture]')).not.toBeNull();
		});
		commandHistory.clearHistory();
		const slider = screen.getByRole('slider', { name: 'Tension' }).element();
		expect(slider.getAttribute('aria-valuemax')).toBe('1000');
		// Keydown previews; the matching keyup commits the whole keyboard gesture once.
		slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
		await vi.waitFor(() => {
			expect(screen.container.textContent).toContain('1000');
		});
		expect(commandHistory.undoStack).toHaveLength(0);
		// Pointerup should not commit (only change does)
		slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
		expect(commandHistory.undoStack).toHaveLength(0);
		// Keyup commits once.
		slider.dispatchEvent(new KeyboardEvent('keyup', { key: 'End', bubbles: true }));
		await vi.waitFor(() => {
			expect(
				timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.easingConfigs?.[0]?.spring
					?.tension
			).toBe(1000);
		});
		expect(commandHistory.undoStack).toHaveLength(1);
		// Lost capture after commit must be no-op and keep committed value
		slider.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true }));
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(
			timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.easingConfigs?.[0]?.spring
				?.tension
		).toBe(1000);
		// Also pointercancel after commit is no-op
		slider.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
		expect(commandHistory.undoStack).toHaveLength(1);
	});
});
