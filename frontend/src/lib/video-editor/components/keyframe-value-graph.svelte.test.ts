import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { transitionsStore } from '$lib/video-editor/timeline/actions/transitions-store.svelte';
import { keyframeSelectionStore } from '$lib/video-editor/timeline/stores/keyframe-selection-store.svelte';
import TimelinePanel from './timeline-panel.svelte';
import { colorStringToKeyframeValue } from '$lib/video-editor/timeline/color-keyframes';

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

beforeEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	keyframeSelectionStore.clear();
	transitionsStore.clear();
	timelineStore.setAll({ tracks: [videoTrack], items: [structuredClone(animatedItem)], fps: 30 });
});

describe('KeyframeValueGraph', () => {
	it('exposes coupled scale as percentage X and Y graph rows', async () => {
		const scaled: TimelineItem = {
			...animatedItem,
			transform: { width: 400, height: 200 },
			keyframes: {},
			vectorKeyframes: {
				scale: [
					{ id: 'scale-a', frame: 0, value: { x: 100, y: 100 }, easing: 'linear' },
					{ id: 'scale-b', frame: 30, value: { x: 200, y: 50 }, easing: 'linear' }
				]
			}
		};
		timelineStore.setAll({ tracks: [videoTrack], items: [scaled], fps: 30 });
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: scaled.id,
			selectedItemIds: [scaled.id]
		});
		await screen.getByRole('button', { name: 'Scale X', exact: true }).click();
		await screen.getByRole('button', { name: 'Toggle keyframe value graph' }).click();
		await expect
			.element(screen.getByRole('application', { name: 'Keyframe value graph for Scale X' }))
			.toBeVisible();
		expect(screen.container.textContent).toContain('%');
	});

	it('renders sampled curves, a playhead, and accessible keyframe controls', async () => {
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Toggle keyframe value graph' }).click();

		const graph = screen.getByRole('application', {
			name: 'Keyframe value graph for opacity'
		});
		await expect.element(graph).toBeVisible();
		expect(screen.container.querySelectorAll('[data-keyframe-curve]')).toHaveLength(2);
		expect(screen.container.querySelectorAll('g[aria-label*="opacity keyframe"]')).toHaveLength(3);
		expect(screen.container.querySelector('[aria-label="Graph playhead"]')).not.toBeNull();
	});

	it('moves a keyframe in frame and value as one undoable graph gesture', async () => {
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, {
			onedit,
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Toggle keyframe value graph' }).click();
		const first = screen.container.querySelector<SVGGElement>(
			'g[aria-label="opacity keyframe at frame 0"]'
		);
		const svg = screen.container.querySelector<SVGSVGElement>(
			'svg[aria-label="Editable curves and keyframes"]'
		);
		expect(first).not.toBeNull();
		expect(svg).not.toBeNull();
		if (!first || !svg) return;
		const hit = first.querySelector('circle');
		const rect = svg.getBoundingClientRect();
		const viewWidth = Number(svg.viewBox.baseVal.width);
		const viewHeight = Number(svg.viewBox.baseVal.height);
		const x = rect.left + (Number(hit?.getAttribute('cx')) / viewWidth) * rect.width;
		const y = rect.top + (Number(hit?.getAttribute('cy')) / viewHeight) * rect.height;

		pointer(first, 'pointerdown', x, y);
		pointer(svg, 'pointermove', x + rect.width * 0.17, y - rect.height * 0.1);
		pointer(svg, 'pointerup', x + rect.width * 0.17, y - rect.height * 0.1);

		await vi.waitFor(() => {
			const track = timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity;
			expect(track?.frames[0]).toBeGreaterThanOrEqual(9);
			expect(track?.frames[0]).toBeLessThanOrEqual(11);
			expect(track?.values[0]).toBeGreaterThan(0);
		});
		expect(commandHistory.getLastCommandType()).toBe('UPDATE_KEYFRAMES');
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();
	});

	it('duplicates instead of moving when Alt is held at drag start', async () => {
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Toggle keyframe value graph' }).click();
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
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Toggle keyframe value graph' }).click();
		const first = screen.container.querySelector<SVGGElement>(
			'g[aria-label="opacity keyframe at frame 0"]'
		);
		const svg = screen.container.querySelector<SVGSVGElement>(
			'svg[aria-label="Editable curves and keyframes"]'
		);
		expect(first).not.toBeNull();
		expect(svg).not.toBeNull();
		if (!first || !svg) return;
		const hit = first.querySelector('circle');
		const rect = svg.getBoundingClientRect();
		const x =
			rect.left + (Number(hit?.getAttribute('cx')) / svg.viewBox.baseVal.width) * rect.width;
		const y =
			rect.top + (Number(hit?.getAttribute('cy')) / svg.viewBox.baseVal.height) * rect.height;

		pointer(first, 'pointerdown', x, y);
		pointer(svg, 'pointermove', x + rect.width * 0.17, y, { altKey: true });
		pointer(svg, 'pointerup', x + rect.width * 0.17, y, { altKey: true });

		await vi.waitFor(() => {
			expect(timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.frames[0]).toBe(5);
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
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Toggle keyframe value graph' }).click();
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
		const screen = await render(TimelinePanel, {
			onedit,
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Toggle keyframe value graph' }).click();
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

	it('marquee-selects every graph diamond it overlaps', async () => {
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Toggle keyframe value graph' }).click();
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
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByText('ASCII: Text Color', { exact: true }).click();
		await screen.getByRole('button', { name: 'Toggle keyframe value graph' }).click();
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
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Toggle keyframe value graph' }).click();
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
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Toggle keyframe value graph' }).click();
		expect(screen.container.textContent).toContain('Snap off');
		const first = screen.container.querySelector<SVGGElement>(
			'g[aria-label="opacity keyframe at frame 0"]'
		);
		const svg = screen.container.querySelector<SVGSVGElement>(
			'svg[aria-label="Editable curves and keyframes"]'
		);
		expect(first && svg).not.toBeNull();
		if (!first || !svg) return;
		const hit = first.querySelector('circle');
		const rect = svg.getBoundingClientRect();
		const x =
			rect.left + (Number(hit?.getAttribute('cx')) / svg.viewBox.baseVal.width) * rect.width;
		const y =
			rect.top + (Number(hit?.getAttribute('cy')) / svg.viewBox.baseVal.height) * rect.height;
		pointer(first, 'pointerdown', x, y);
		pointer(svg, 'pointermove', x + rect.width * 0.48, y);
		expect(screen.container.querySelector('[data-snap-guide="frame"]')).toBeNull();
		pointer(svg, 'pointerup', x + rect.width * 0.48, y);
		await vi.waitFor(() => {
			expect(timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.frames?.[0]).not.toBe(
				30
			);
		});
		// Re-enable and verify Ctrl bypass when snap is enabled
		timelineStore._setSnapEnabled(true);
		commandHistory.clearHistory();
		timelineStore.setAll({ tracks: [videoTrack], items: [structuredClone(animatedItem)], fps: 30 });
		await screen
			.getByRole('button', { name: 'Toggle keyframe value graph' })
			.click()
			.catch(() => {});
		const first2 = screen.container.querySelector<SVGGElement>(
			'g[aria-label="opacity keyframe at frame 0"]'
		);
		const svg2 = screen.container.querySelector<SVGSVGElement>(
			'svg[aria-label="Editable curves and keyframes"]'
		);
		if (!first2 || !svg2) return;
		const hit2 = first2.querySelector('circle');
		const rect2 = svg2.getBoundingClientRect();
		const x2 =
			rect2.left + (Number(hit2?.getAttribute('cx')) / svg2.viewBox.baseVal.width) * rect2.width;
		const y2 =
			rect2.top + (Number(hit2?.getAttribute('cy')) / svg2.viewBox.baseVal.height) * rect2.height;
		pointer(first2, 'pointerdown', x2, y2);
		svg2.dispatchEvent(
			new PointerEvent('pointermove', {
				bubbles: true,
				clientX: x2 + rect2.width * 0.48,
				clientY: y2,
				ctrlKey: true,
				pointerId: 13
			})
		);
		expect(screen.container.querySelector('[data-snap-guide="frame"]')).toBeNull();
		svg2.dispatchEvent(
			new PointerEvent('pointerup', {
				bubbles: true,
				clientX: x2 + rect2.width * 0.48,
				clientY: y2,
				ctrlKey: true,
				pointerId: 13
			})
		);
	});

	it('keeps the segment menu open for spring edits, commits one undo on release, and cancels on Escape', async () => {
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Toggle keyframe value graph' }).click();
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
		(pill as HTMLElement)?.dispatchEvent(
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
		const slider = screen.container.querySelector<HTMLInputElement>('input[type="range"]');
		expect(slider).not.toBeNull();
		const before = timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity
			?.easingConfigs?.[0];
		slider!.value = '300';
		slider!.dispatchEvent(new Event('input', { bubbles: true }));
		slider!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(
			timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.easingConfigs?.[0]
		).toEqual(before);
		// Now commit with change
		slider!.value = '300';
		slider!.dispatchEvent(new Event('input', { bubbles: true }));
		slider!.dispatchEvent(new Event('change', { bubbles: true }));
		await vi.waitFor(() => {
			expect(
				timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.easingConfigs?.[0]?.spring
					?.tension
			).toBe(300);
		});
		expect(commandHistory.undoStack).toHaveLength(2);
		commandHistory.undo();
		expect(timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.easings?.[0]).toBe(
			'spring'
		);
	});

	it('moves a selected keyframe with base and fast nudge catalog bindings and one undo', async () => {
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Toggle keyframe value graph' }).click();
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
			new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true })
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

	it('cancels an active drag on Escape and at 320px keeps controls without overflow', async () => {
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Toggle keyframe value graph' }).click();
		const app = screen.container.querySelector<HTMLElement>('[role="application"]');
		const first = screen.container.querySelector<SVGGElement>(
			'g[aria-label="opacity keyframe at frame 0"]'
		);
		const svg = screen.container.querySelector<SVGSVGElement>(
			'svg[aria-label="Editable curves and keyframes"]'
		);
		expect(first && svg && app).not.toBeNull();
		if (!first || !svg || !app) return;
		const hit = first.querySelector('circle');
		const rect = svg.getBoundingClientRect();
		const x =
			rect.left + (Number(hit?.getAttribute('cx')) / svg.viewBox.baseVal.width) * rect.width;
		const y =
			rect.top + (Number(hit?.getAttribute('cy')) / svg.viewBox.baseVal.height) * rect.height;
		pointer(first, 'pointerdown', x, y);
		pointer(svg, 'pointermove', x + rect.width * 0.2, y);
		// Drag is active - previewValues set, no snap expected for small move, but Escape should cancel
		await vi.waitFor(() => {
			// Preview is active (frame would have moved if committed) - check that store not yet committed
			expect(timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.frames?.[0]).toBe(0);
		});
		app.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })
		);
		await vi.waitFor(() => {
			expect(timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.frames?.[0]).toBe(0);
		});
		expect(commandHistory.undoStack).toHaveLength(0);
		// 320px narrow layout - no horizontal overflow
		const host = screen.container.querySelector<HTMLElement>('[data-keyframe-value-graph]');
		expect(host).not.toBeNull();
		if (host) {
			Object.defineProperty(host, 'getBoundingClientRect', {
				value: () =>
					({ width: 320, height: 300, left: 0, top: 0, right: 320, bottom: 300 }) as DOMRect
			});
			host.style.width = '320px';
			await vi.waitFor(() => {
				expect(host.scrollWidth).toBeLessThanOrEqual(320);
			});
		}
	});

	it('spring slider pointerup plus change plus lostpointercapture commits once and stays committed', async () => {
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: animatedItem.id,
			selectedItemIds: [animatedItem.id]
		});
		await screen.getByRole('button', { name: 'Toggle keyframe value graph' }).click();
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
		(pill as HTMLElement)?.dispatchEvent(
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
		const slider = screen.container.querySelector<HTMLInputElement>('input[type="range"]');
		expect(slider).not.toBeNull();
		// Live preview only: input should not create history
		slider!.value = '300';
		slider!.dispatchEvent(new Event('input', { bubbles: true }));
		await vi.waitFor(() => {
			expect(screen.container.textContent).toContain('300');
		});
		expect(commandHistory.undoStack).toHaveLength(0);
		// Pointerup should not commit (only change does)
		slider!.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
		expect(commandHistory.undoStack).toHaveLength(0);
		// Change commits once
		slider!.dispatchEvent(new Event('change', { bubbles: true }));
		await vi.waitFor(() => {
			expect(
				timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.easingConfigs?.[0]?.spring
					?.tension
			).toBe(300);
		});
		expect(commandHistory.undoStack).toHaveLength(1);
		// Lost capture after commit must be no-op and keep committed value
		slider!.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true }));
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(
			timelineStore.itemById.get(animatedItem.id)?.keyframes?.opacity?.easingConfigs?.[0]?.spring
				?.tension
		).toBe(300);
		// Also pointercancel after commit is no-op
		slider!.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
		expect(commandHistory.undoStack).toHaveLength(1);
	});
});
