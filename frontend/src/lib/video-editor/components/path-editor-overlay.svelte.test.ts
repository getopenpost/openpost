import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import PathEditorOverlay from './path-editor-overlay.svelte';
import '../../../routes/layout.css';

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

function pathItem(): TimelineItem {
	return {
		id: 'path',
		trackId: track.id,
		from: 0,
		durationInFrames: 90,
		label: 'Pen',
		type: 'shape',
		shapeType: 'path',
		fillEnabled: false,
		strokeEnabled: true,
		strokeWidth: 8,
		strokeColor: '#ffffff',
		pathVertices: [],
		pathClosed: false,
		transform: { width: 400, height: 200, aspectRatioLocked: false }
	};
}

beforeEach(() => {
	commandHistory.clearHistory();
	timelineStore.__resetForTesting();
	timelineStore.setAll({ fps: 30, currentFrame: 0, tracks: [track], items: [pathItem()] });
});

function drawPoint(svg: SVGSVGElement, x: number, y: number, dragX = x, dragY = y): void {
	const pointerId = Math.round(x + y + 1);
	svg.dispatchEvent(
		new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId })
	);
	window.dispatchEvent(
		new PointerEvent('pointermove', {
			bubbles: true,
			clientX: dragX,
			clientY: dragY,
			pointerId
		})
	);
	window.dispatchEvent(
		new PointerEvent('pointerup', {
			bubbles: true,
			clientX: dragX,
			clientY: dragY,
			pointerId
		})
	);
}

describe('PathEditorOverlay', () => {
	it('draws curved points and finishes an open path with fitted bounds', async () => {
		const onedit = vi.fn();
		const screen = await render(PathEditorOverlay, {
			item: timelineStore.itemById.get('path')!,
			canvasWidth: 400,
			canvasHeight: 200,
			currentFrame: 0,
			boxStyle: 'left:0;top:0;width:400px;height:200px;transform:none',
			screenScale: 1,
			onedit
		});
		screen.container.style.width = '400px';
		screen.container.style.height = '240px';
		screen.container.style.position = 'relative';
		const svg = screen.container.querySelector('svg');
		expect(svg).not.toBeNull();

		drawPoint(svg!, 40, 50, 80, 25);
		await screen.rerender({ item: timelineStore.itemById.get('path')! });
		drawPoint(svg!, 330, 150);
		await screen.rerender({ item: timelineStore.itemById.get('path')! });
		await screen.getByRole('button', { name: 'Finish open' }).click();

		const item = timelineStore.itemById.get('path');
		expect(item?.pathVertices).toHaveLength(2);
		expect(item?.pathVertices?.[0]?.tangentMode).toBe('continuous');
		expect(item?.pathVertices?.[0]?.outHandle).not.toEqual([0, 0]);
		expect(item?.pathClosed).toBe(false);
		expect(item?.transform?.width).toBeLessThan(400);
		expect(item?.transform?.height).toBeLessThan(200);
		expect(onedit).toHaveBeenCalledTimes(3);
	});

	it('reuses the path editor for masks and only permits a closed result', async () => {
		const mask = { ...pathItem(), isMask: true, maskType: 'clip' as const };
		timelineStore.setAll({ fps: 30, currentFrame: 0, tracks: [track], items: [mask] });
		const screen = await render(PathEditorOverlay, {
			item: timelineStore.itemById.get('path')!,
			canvasWidth: 400,
			canvasHeight: 200,
			currentFrame: 0,
			boxStyle: 'left:0;top:0;width:400px;height:200px;transform:none',
			screenScale: 1,
			onedit: vi.fn()
		});
		screen.container.style.width = '400px';
		screen.container.style.height = '240px';
		screen.container.style.position = 'relative';
		const currentSvg = () => {
			const svg = screen.container.querySelector<SVGSVGElement>('svg');
			if (!svg) throw new Error('mask path editor did not render');
			return svg;
		};

		drawPoint(currentSvg(), 40, 40);
		await screen.rerender({ item: timelineStore.itemById.get('path')! });
		drawPoint(currentSvg(), 340, 40);
		await screen.rerender({ item: timelineStore.itemById.get('path')! });
		drawPoint(currentSvg(), 200, 160);
		await screen.rerender({ item: timelineStore.itemById.get('path')! });

		expect(timelineStore.itemById.get('path')?.pathVertices).toHaveLength(3);
		expect(screen.getByRole('button', { name: 'Finish open' }).query()).toBeNull();
		screen.container
			.querySelector<HTMLElement>('[data-path-editor]')
			?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(timelineStore.itemById.get('path')?.pathClosed).toBe(true);
	});

	it('keys selected or all vertices and locks topology until path keys are cleared', async () => {
		const animated: TimelineItem = {
			...pathItem(),
			pathVertices: [
				{
					position: [0.15, 0.25],
					inHandle: [0, 0],
					outHandle: [0.15, 0],
					tangentMode: 'continuous'
				},
				{
					position: [0.85, 0.75],
					inHandle: [-0.15, 0],
					outHandle: [0, 0],
					tangentMode: 'continuous'
				}
			]
		};
		timelineStore.setAll({ fps: 30, currentFrame: 15, tracks: [track], items: [animated] });
		const screen = await render(PathEditorOverlay, {
			item: timelineStore.itemById.get('path')!,
			canvasWidth: 400,
			canvasHeight: 200,
			currentFrame: 15,
			boxStyle: 'left:0;top:0;width:400px;height:200px;transform:none',
			screenScale: 1,
			onedit: vi.fn()
		});
		screen.container.style.width = '400px';
		screen.container.style.height = '320px';
		screen.container.style.position = 'relative';

		await screen.getByRole('button', { name: 'Path point 1' }).click();
		await screen.getByRole('button', { name: 'Key selected' }).click();
		await screen.rerender({ item: timelineStore.itemById.get('path')! });
		expect(Object.keys(timelineStore.itemById.get('path')?.keyframes ?? {})).toHaveLength(6);
		await expect
			.element(screen.getByText(/Path points, order, and closure stay locked/))
			.toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Add point' })).toBeDisabled();
		await expect.element(screen.getByRole('button', { name: 'Delete point' })).toBeDisabled();
		await page.screenshot({
			element: screen.container,
			path: '../../../../.svelte-kit/openpost-path-vertex-animation.png'
		});
		const basePosition = timelineStore.itemById.get('path')?.pathVertices?.[0]?.position[0];
		const firstPoint = screen.getByRole('button', { name: 'Path point 1' }).query();
		firstPoint?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		expect(
			timelineStore.itemById.get('path')?.keyframes?.['pathVertex:0:positionX']?.values[0]
		).toBeGreaterThan(0.15);
		expect(timelineStore.itemById.get('path')?.pathVertices?.[0]?.position[0]).toBe(basePosition);

		await screen.getByRole('button', { name: 'Key all' }).click();
		expect(Object.keys(timelineStore.itemById.get('path')?.keyframes ?? {})).toHaveLength(12);
		await screen.rerender({ item: timelineStore.itemById.get('path')! });
		await screen.getByRole('button', { name: 'Clear path keys' }).click();
		expect(timelineStore.itemById.get('path')?.keyframes).toBeUndefined();
	});

	it('opens point actions by pointer or keyboard and preserves a selected point group', async () => {
		const editable: TimelineItem = {
			...pathItem(),
			pathVertices: [
				{ position: [0.1, 0.1], inHandle: [0, 0], outHandle: [0, 0], tangentMode: 'corner' },
				{ position: [0.9, 0.1], inHandle: [0, 0], outHandle: [0, 0], tangentMode: 'corner' },
				{ position: [0.9, 0.9], inHandle: [0, 0], outHandle: [0, 0], tangentMode: 'corner' },
				{ position: [0.1, 0.9], inHandle: [0, 0], outHandle: [0, 0], tangentMode: 'corner' }
			],
			pathClosed: false
		};
		timelineStore.setAll({ fps: 30, currentFrame: 0, tracks: [track], items: [editable] });
		const screen = await render(PathEditorOverlay, {
			item: timelineStore.itemById.get('path')!,
			canvasWidth: 400,
			canvasHeight: 200,
			currentFrame: 0,
			boxStyle: 'left:0;top:0;width:400px;height:200px;transform:none',
			screenScale: 1,
			onedit: vi.fn()
		});
		screen.container.style.width = '400px';
		screen.container.style.height = '300px';
		screen.container.style.position = 'relative';

		const point2 = screen.getByRole('button', { name: 'Path point 2' }).element();
		point2.dispatchEvent(
			new MouseEvent('contextmenu', {
				bubbles: true,
				cancelable: true,
				clientX: 360,
				clientY: 20
			})
		);
		await expect.element(screen.getByRole('menuitem', { name: 'Convert to curve' })).toBeVisible();
		await page.screenshot({
			element: screen.container,
			path: '../../../../.svelte-kit/openpost-path-point-context-menu.png'
		});
		await screen.getByRole('menuitem', { name: 'Convert to curve' }).click();
		expect(timelineStore.itemById.get('path')?.pathVertices?.[1]?.tangentMode).toBe('continuous');
		commandHistory.undo();
		expect(timelineStore.itemById.get('path')?.pathVertices?.[1]?.tangentMode).toBe('corner');

		await screen.rerender({ item: timelineStore.itemById.get('path')! });
		const refreshedPoint2 = screen.getByRole('button', { name: 'Path point 2' }).element();
		refreshedPoint2.focus();
		await userEvent.keyboard('{Shift>}{F10}{/Shift}');
		await expect.element(screen.getByRole('menuitem', { name: 'Delete point' })).toBeVisible();
		await userEvent.keyboard('{Escape}');

		await userEvent.click(screen.getByRole('button', { name: 'Path point 3' }).element(), {
			modifiers: ['Shift']
		});
		await expect
			.element(screen.getByRole('button', { name: 'Path point 2' }))
			.toHaveAttribute('aria-pressed', 'true');
		await expect
			.element(screen.getByRole('button', { name: 'Path point 3' }))
			.toHaveAttribute('aria-pressed', 'true');
		refreshedPoint2.dispatchEvent(
			new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 360, clientY: 20 })
		);
		await screen.getByRole('menuitem', { name: 'Delete point' }).click();
		expect(timelineStore.itemById.get('path')?.pathVertices).toHaveLength(2);
		commandHistory.undo();
		expect(timelineStore.itemById.get('path')?.pathVertices).toHaveLength(4);

		await screen.rerender({ item: timelineStore.itemById.get('path')! });
		const restoredPoint2 = screen.getByRole('button', { name: 'Path point 2' }).element();
		restoredPoint2.dispatchEvent(
			new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 360, clientY: 20 })
		);
		await screen.getByRole('menuitem', { name: 'Key selected' }).click();
		await screen.rerender({ item: timelineStore.itemById.get('path')! });
		screen
			.getByRole('button', { name: 'Path point 2' })
			.element()
			.dispatchEvent(
				new MouseEvent('contextmenu', {
					bubbles: true,
					cancelable: true,
					clientX: 360,
					clientY: 20
				})
			);
		await expect.element(screen.getByRole('menuitem', { name: 'Add point' })).toBeDisabled();
		await expect.element(screen.getByRole('menuitem', { name: 'Delete point' })).toBeDisabled();
	});

	it('reverses a path or makes the selected closed-path point first from its context menu', async () => {
		const editable: TimelineItem = {
			...pathItem(),
			pathVertices: [
				{
					position: [0.1, 0.1],
					inHandle: [-0.05, 0],
					outHandle: [0.1, 0.05],
					tangentMode: 'continuous'
				},
				{ position: [0.9, 0.1], inHandle: [0, 0], outHandle: [0, 0], tangentMode: 'corner' },
				{ position: [0.5, 0.9], inHandle: [0, 0], outHandle: [0, 0], tangentMode: 'corner' }
			],
			pathClosed: true
		};
		timelineStore.setAll({ fps: 30, currentFrame: 0, tracks: [track], items: [editable] });
		const onedit = vi.fn();
		const screen = await render(PathEditorOverlay, {
			item: timelineStore.itemById.get('path')!,
			canvasWidth: 400,
			canvasHeight: 200,
			currentFrame: 0,
			boxStyle: 'left:0;top:0;width:400px;height:200px;transform:none',
			screenScale: 1,
			onedit
		});
		screen.container.style.width = '400px';
		screen.container.style.height = '300px';
		screen.container.style.position = 'relative';

		screen
			.getByRole('button', { name: 'Path point 2' })
			.element()
			.dispatchEvent(
				new MouseEvent('contextmenu', {
					bubbles: true,
					cancelable: true,
					clientX: 360,
					clientY: 20
				})
			);
		await screen.getByRole('menuitem', { name: 'Set as first point' }).click();
		expect(
			timelineStore.itemById.get('path')?.pathVertices?.map((vertex) => vertex.position)
		).toEqual([
			[0.9, 0.1],
			[0.5, 0.9],
			[0.1, 0.1]
		]);
		commandHistory.undo();

		await screen.rerender({ item: timelineStore.itemById.get('path')! });
		screen
			.getByRole('button', { name: 'Path point 1' })
			.element()
			.dispatchEvent(
				new MouseEvent('contextmenu', {
					bubbles: true,
					cancelable: true,
					clientX: 40,
					clientY: 20
				})
			);
		await screen.getByRole('menuitem', { name: 'Reverse path' }).last().click();
		const reversed = timelineStore.itemById.get('path')?.pathVertices;
		expect(reversed?.map((vertex) => vertex.position)).toEqual([
			[0.5, 0.9],
			[0.9, 0.1],
			[0.1, 0.1]
		]);
		expect(reversed?.[2]?.outHandle).toEqual([-0.05, 0]);
		expect(onedit).toHaveBeenCalledTimes(2);
	});
});
