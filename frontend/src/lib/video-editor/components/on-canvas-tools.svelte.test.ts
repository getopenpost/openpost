import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem } from '$lib/video-editor/project/types';
import type { CanvasAnimatedValues, Point } from '$lib/video-editor/preview/on-canvas-tools';
import OnCanvasTools from './on-canvas-tools.svelte';
import '../../../routes/layout.css';

function imageItem(patch: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'clip',
		trackId: 'video',
		from: 0,
		durationInFrames: 30,
		label: 'Clip',
		type: 'image',
		sourceWidth: 400,
		sourceHeight: 200,
		transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
		...patch
	};
}

async function renderTools(item: TimelineItem, width = 1000) {
	await page.viewport(width, 700);
	const callbacks = {
		ontransformdraft: vi.fn(),
		oncropdraft: vi.fn(),
		ontextdraft: vi.fn(),
		oncornerpindraft: vi.fn(),
		ontextediting: vi.fn(),
		oncommitvalues: vi.fn((_frame: number, _values: CanvasAnimatedValues) => true),
		oncommitposition: vi.fn((_frame: number, _x: number, _y: number) => true),
		oncreatespatial: vi.fn((_frame: number) => true),
		oncommitspatial: vi.fn(() => true),
		oncommittext: vi.fn((_text: string) => undefined),
		oncommitcornerpin: vi.fn(),
		onseek: vi.fn((_frame: number) => undefined),
		onedit: vi.fn()
	};
	const screen = await render(OnCanvasTools, {
		item,
		canvasWidth: 1000,
		canvasHeight: 500,
		currentFrame: 12,
		...callbacks
	});
	screen.container.style.position = 'relative';
	screen.container.style.containerType = 'size';
	screen.container.style.width = `${width}px`;
	screen.container.style.height = '500px';
	const root = canvasRoot(screen.container);
	root.style.position = 'relative';
	root.style.width = `${width}px`;
	root.style.height = '500px';
	return { screen, callbacks };
}

function canvasRoot(container: HTMLElement): HTMLElement {
	const root = container.querySelector<HTMLElement>('[data-on-canvas-tools]');
	if (!root) throw new Error('canvas root missing');
	return root;
}

function moveSurface(container: HTMLElement): HTMLButtonElement {
	const surface = container.querySelector<HTMLButtonElement>('[aria-label="Move selected clip"]');
	if (!surface) throw new Error('move surface missing');
	return surface;
}

interface BrowserPoint {
	clientX: number;
	clientY: number;
}

function canvasClientPoint(
	root: HTMLElement,
	point: Point,
	canvasWidth = 1000,
	canvasHeight = 500
): BrowserPoint {
	const rect = root.getBoundingClientRect();
	return {
		clientX: rect.left + (point.x / canvasWidth) * rect.width,
		clientY: rect.top + (point.y / canvasHeight) * rect.height
	};
}

function clientCanvasPoint(
	root: HTMLElement,
	point: BrowserPoint,
	canvasWidth = 1000,
	canvasHeight = 500
): Point {
	const rect = root.getBoundingClientRect();
	return {
		x: ((point.clientX - rect.left) / rect.width) * canvasWidth,
		y: ((point.clientY - rect.top) / rect.height) * canvasHeight
	};
}

describe('OnCanvasTools', () => {
	it('keeps the canvas tool strip contained and touch-sized on phones', async () => {
		const { screen } = await renderTools(imageItem(), 320);
		const toolbar = screen.getByRole('toolbar', { name: 'On-canvas editing tools' }).element();
		const transform = screen.getByRole('button', { name: 'Transform' }).element();
		expect(transform.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
		expect(toolbar.getBoundingClientRect().width).toBeLessThanOrEqual(320);
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
	});

	it('opens the direct corner-pin editor for visual clips', async () => {
		const { screen } = await renderTools(imageItem());
		await screen.getByRole('button', { name: 'Corner pin' }).click();
		expect(screen.container.querySelector('[data-corner-pin-editor]')).not.toBeNull();
		await expect.element(screen.getByRole('button', { name: 'Move topLeft corner' })).toBeVisible();
	});

	it('commits a rotated crop drag in clip-local coordinates', async () => {
		const { screen, callbacks } = await renderTools(
			imageItem({ transform: { x: 0, y: 0, width: 100, height: 100, rotation: 90 } })
		);
		await screen.getByRole('button', { name: 'Crop' }).click();
		await page.screenshot({
			element: canvasRoot(screen.container),
			path: '../../../../.svelte-kit/openpost-on-canvas-crop.png'
		});
		const handle = screen.container.querySelector<HTMLButtonElement>(
			'[aria-label="Crop left edge"]'
		);
		if (!handle) throw new Error('left crop handle missing');
		const root = canvasRoot(screen.container);
		const rect = root.getBoundingClientRect();
		const start = {
			bubbles: true,
			clientX: rect.left + rect.width / 2,
			clientY: rect.top + rect.height / 2,
			pointerId: 1
		};
		const endY = start.clientY + (25 / 500) * rect.height;
		handle.dispatchEvent(new PointerEvent('pointerdown', start));
		window.dispatchEvent(new PointerEvent('pointerup', { ...start, pointerId: 99 }));
		expect(callbacks.oncommitvalues).not.toHaveBeenCalled();
		window.dispatchEvent(new PointerEvent('pointermove', { ...start, clientY: endY, buttons: 1 }));
		window.dispatchEvent(new PointerEvent('pointerup', { ...start, clientY: endY }));
		expect(callbacks.oncommitvalues).toHaveBeenCalledWith(12, { cropLeft: 100 });
		expect(callbacks.onedit).toHaveBeenCalledTimes(1);
	});

	it('cancels or atomically commits direct text editing', async () => {
		const item = imageItem({
			type: 'text',
			text: 'Original',
			label: 'Original',
			sourceWidth: undefined,
			sourceHeight: undefined
		});
		const { screen, callbacks } = await renderTools(item);
		moveSurface(screen.container).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		await vi.waitFor(() =>
			expect(screen.container.querySelector('[aria-label^="Edit text on canvas"]')).not.toBeNull()
		);
		await page.screenshot({
			element: canvasRoot(screen.container),
			path: '../../../../.svelte-kit/openpost-on-canvas-text.png'
		});
		const editor = screen.container.querySelector<HTMLDivElement>(
			'[aria-label^="Edit text on canvas"]'
		);
		if (!editor) throw new Error('text editor missing');
		editor.textContent = 'Cancelled';
		editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
		editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(callbacks.oncommittext).not.toHaveBeenCalled();

		await screen.getByRole('button', { name: 'Text' }).click();
		const committedEditor = screen.container.querySelector<HTMLDivElement>(
			'[aria-label^="Edit text on canvas"]'
		);
		if (!committedEditor) throw new Error('text editor did not reopen');
		committedEditor.textContent = 'Committed';
		committedEditor.dispatchEvent(new InputEvent('input', { bubbles: true }));
		committedEditor.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })
		);
		expect(callbacks.oncommittext).toHaveBeenCalledOnce();
		expect(callbacks.oncommittext).toHaveBeenCalledWith('Committed');
		expect(callbacks.onedit).toHaveBeenCalledOnce();
	});

	it('keeps direct canvas moves coupled when position animation exists', async () => {
		const { screen, callbacks } = await renderTools(
			imageItem({ keyframes: { x: { frames: [0, 20], values: [-100, 100] } } })
		);
		const root = canvasRoot(screen.container);
		const rect = root.getBoundingClientRect();
		const surface = moveSurface(screen.container);
		const start = {
			bubbles: true,
			clientX: rect.left + rect.width / 2,
			clientY: rect.top + rect.height / 2,
			pointerId: 3
		};
		surface.dispatchEvent(new PointerEvent('pointerdown', start));
		window.dispatchEvent(
			new PointerEvent('pointerup', {
				...start,
				clientX: start.clientX + (20 / 1000) * rect.width,
				clientY: start.clientY + (10 / 500) * rect.height
			})
		);
		expect(callbacks.oncommitposition).toHaveBeenCalledWith(12, 20, 10);
		expect(callbacks.oncommitvalues).not.toHaveBeenCalled();
	});

	it('shows and commits screen-stable canvas snap guides during a move', async () => {
		const { screen, callbacks } = await renderTools(
			imageItem({ transform: { x: -100, y: 0, width: 100, height: 100, rotation: 0 } })
		);
		const root = canvasRoot(screen.container);
		const start = canvasClientPoint(root, { x: 400, y: 250 });
		const pointer = { bubbles: true, pointerId: 30, ...start };
		moveSurface(screen.container).dispatchEvent(new PointerEvent('pointerdown', pointer));
		window.dispatchEvent(
			new PointerEvent('pointermove', {
				...pointer,
				clientX: start.clientX + 96,
				buttons: 1
			})
		);
		await vi.waitFor(() =>
			expect(screen.container.querySelector('[data-canvas-snap-guide="vertical"]')).not.toBeNull()
		);
		await page.screenshot({
			element: root,
			path: '../../../../.svelte-kit/openpost-on-canvas-snap.png'
		});
		await expect.element(screen.getByText('50%', { exact: true }).first()).toBeVisible();
		expect(callbacks.ontransformdraft).toHaveBeenLastCalledWith(
			expect.objectContaining({ x: 0, y: 0 })
		);

		window.dispatchEvent(
			new PointerEvent('pointerup', {
				...pointer,
				clientX: start.clientX + 96
			})
		);
		expect(callbacks.oncommitvalues).toHaveBeenCalledWith(12, { x: 0, y: 0 });
		await vi.waitFor(() =>
			expect(screen.container.querySelector('[data-canvas-snap-guide]')).toBeNull()
		);

		const freePointer = { ...pointer, pointerId: 31 };
		moveSurface(screen.container).dispatchEvent(new PointerEvent('pointerdown', freePointer));
		window.dispatchEvent(
			new PointerEvent('pointermove', {
				...freePointer,
				clientX: start.clientX + 96,
				buttons: 1,
				altKey: true
			})
		);
		expect(callbacks.ontransformdraft).toHaveBeenLastCalledWith(
			expect.objectContaining({ x: -4, y: 0 })
		);
		expect(screen.container.querySelector('[data-canvas-snap-guide]')).toBeNull();
		window.dispatchEvent(new PointerEvent('pointercancel', freePointer));
	});

	it('exposes and keyboard-operates the full transform gizmo', async () => {
		const { screen, callbacks } = await renderTools(imageItem());
		expect(canvasRoot(screen.container).getBoundingClientRect().width).toBe(1000);
		await page.screenshot({
			path: '../../../../.svelte-kit/openpost-on-canvas-transform.png'
		});
		const expectedHandles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'rotate'];
		expect(
			[...screen.container.querySelectorAll<HTMLElement>('[data-transform-handle]')].map(
				(handle) => handle.dataset.transformHandle
			)
		).toEqual(expectedHandles);
		const root = canvasRoot(screen.container);
		const center = canvasClientPoint(root, { x: 500, y: 250 });
		const click = { bubbles: true, pointerId: 20, ...center };
		moveSurface(screen.container).dispatchEvent(new PointerEvent('pointerdown', click));
		window.dispatchEvent(new PointerEvent('pointerup', click));
		expect(callbacks.oncommitvalues).not.toHaveBeenCalled();
		expect(callbacks.onedit).not.toHaveBeenCalled();

		const southeast = screen.container.querySelector<HTMLButtonElement>(
			'[data-transform-handle="se"]'
		);
		if (!southeast) throw new Error('southeast transform handle missing');
		southeast.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })
		);
		expect(callbacks.oncommitvalues).toHaveBeenLastCalledWith(12, {
			width: 120,
			height: 100
		});

		const rotate = screen.container.querySelector<HTMLButtonElement>(
			'[data-transform-handle="rotate"]'
		);
		if (!rotate) throw new Error('rotation handle missing');
		rotate.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })
		);
		expect(callbacks.oncommitvalues).toHaveBeenLastCalledWith(12, { rotation: 15 });
		expect(callbacks.onedit).toHaveBeenCalledTimes(2);
	});

	it('resizes from the center or opposite corner with one atomic commit', async () => {
		const { screen, callbacks } = await renderTools(imageItem());
		const root = canvasRoot(screen.container);
		const handle = screen.container.querySelector<HTMLButtonElement>(
			'[data-transform-handle="se"]'
		);
		if (!handle) throw new Error('southeast transform handle missing');
		const handleRect = handle.getBoundingClientRect();
		const startClient = {
			clientX: handleRect.left + handleRect.width / 2,
			clientY: handleRect.top + handleRect.height / 2
		};
		const startCanvas = clientCanvasPoint(root, startClient);
		const endClient = canvasClientPoint(root, {
			x: startCanvas.x + 25,
			y: startCanvas.y + 25
		});
		const pointer = { bubbles: true, pointerId: 21, ...startClient };
		handle.dispatchEvent(new PointerEvent('pointerdown', pointer));
		window.dispatchEvent(
			new PointerEvent('pointerup', { ...pointer, ...endClient, ctrlKey: true })
		);

		const values = callbacks.oncommitvalues.mock.calls.at(-1)?.[1];
		expect(values?.width).toBeCloseTo(125, 5);
		expect(values?.height).toBeCloseTo(125, 5);
		expect(values?.x).toBeCloseTo(12.5, 5);
		expect(values?.y).toBeCloseTo(12.5, 5);
		expect(callbacks.oncommitvalues).toHaveBeenCalledOnce();
		expect(callbacks.onedit).toHaveBeenCalledOnce();
	});

	it('snaps pointer rotation unless Option requests a free angle', async () => {
		const { screen, callbacks } = await renderTools(imageItem());
		const root = canvasRoot(screen.container);
		const rotate = screen.container.querySelector<HTMLButtonElement>(
			'[data-transform-handle="rotate"]'
		);
		if (!rotate) throw new Error('rotation handle missing');
		const handleRect = rotate.getBoundingClientRect();
		const startClient = {
			clientX: handleRect.left + handleRect.width / 2,
			clientY: handleRect.top + handleRect.height / 2
		};
		const startCanvas = clientCanvasPoint(root, startClient);
		const startAngle = Math.atan2(startCanvas.y - 250, startCanvas.x - 500);
		const freeAngle = startAngle + (37 * Math.PI) / 180;
		const endClient = canvasClientPoint(root, {
			x: 500 + Math.cos(freeAngle) * 100,
			y: 250 + Math.sin(freeAngle) * 100
		});
		const pointer = { bubbles: true, pointerId: 22, ...startClient };
		rotate.dispatchEvent(new PointerEvent('pointerdown', pointer));
		window.dispatchEvent(new PointerEvent('pointerup', { ...pointer, ...endClient }));
		expect(callbacks.oncommitvalues).toHaveBeenLastCalledWith(12, { rotation: 30 });

		rotate.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, pointerId: 23 }));
		window.dispatchEvent(
			new PointerEvent('pointerup', {
				...pointer,
				...endClient,
				pointerId: 23,
				altKey: true
			})
		);
		const values = callbacks.oncommitvalues.mock.calls.at(-1)?.[1];
		expect(values?.rotation).toBeCloseTo(37, 5);
		expect(callbacks.onedit).toHaveBeenCalledTimes(2);
	});

	it('edits both axes of a motion keyframe with one path gesture', async () => {
		const { screen, callbacks } = await renderTools(
			imageItem({
				keyframes: {
					x: { frames: [0, 20], values: [-100, 100] },
					y: { frames: [0, 20], values: [0, 100] }
				}
			})
		);
		await screen.getByRole('button', { name: 'Motion' }).click();
		await page.screenshot({
			element: canvasRoot(screen.container),
			path: '../../../../.svelte-kit/openpost-on-canvas-motion.png'
		});
		const point = screen.container.querySelector<SVGCircleElement>(
			'[aria-label="Position keyframe at frame 0"]'
		);
		if (!point) throw new Error('motion keyframe missing');
		const root = canvasRoot(screen.container);
		const rect = root.getBoundingClientRect();
		const start = {
			bubbles: true,
			clientX: rect.left + (400 / 1000) * rect.width,
			clientY: rect.top + (250 / 500) * rect.height,
			pointerId: 2
		};
		const endX = start.clientX + (20 / 1000) * rect.width;
		const endY = start.clientY + (30 / 500) * rect.height;
		point.dispatchEvent(new PointerEvent('pointerdown', start));
		window.dispatchEvent(
			new PointerEvent('pointermove', {
				...start,
				clientX: endX,
				clientY: endY,
				buttons: 1
			})
		);
		window.dispatchEvent(new PointerEvent('pointerup', { ...start, clientX: endX, clientY: endY }));
		expect(callbacks.onseek).toHaveBeenCalledWith(0);
		expect(callbacks.oncommitposition).toHaveBeenCalledWith(0, -80, 30);
		expect(callbacks.onedit).toHaveBeenCalledOnce();
	});

	it('edits continuous spatial handles on the visible motion curve', async () => {
		const { screen, callbacks } = await renderTools(
			imageItem({
				vectorKeyframes: {
					position: [
						{
							id: 'position-a',
							frame: 0,
							value: { x: -100, y: 0 },
							easing: 'linear',
							spatial: {
								inTangent: { x: -50, y: 0 },
								outTangent: { x: 50, y: 0 },
								continuous: true
							}
						},
						{
							id: 'position-b',
							frame: 20,
							value: { x: 100, y: 100 },
							easing: 'linear'
						}
					]
				}
			})
		);
		await screen.getByRole('button', { name: 'Motion' }).click();
		const keyframe = screen.container.querySelector<SVGCircleElement>(
			'[aria-label="Position keyframe at frame 0"]'
		);
		if (!keyframe) throw new Error('motion keyframe missing');
		keyframe.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		await vi.waitFor(() =>
			expect(
				screen.container.querySelector('[aria-label="Outgoing position curve handle at frame 0"]')
			).not.toBeNull()
		);
		await page.screenshot({
			element: canvasRoot(screen.container),
			path: '../../../../.svelte-kit/openpost-on-canvas-spatial.png'
		});
		const handle = screen.container.querySelector<SVGCircleElement>(
			'[aria-label="Outgoing position curve handle at frame 0"]'
		);
		if (!handle) throw new Error('outgoing spatial handle missing');
		const root = canvasRoot(screen.container);
		const rect = root.getBoundingClientRect();
		const start = {
			bubbles: true,
			clientX: rect.left + (450 / 1000) * rect.width,
			clientY: rect.top + (250 / 500) * rect.height,
			pointerId: 7
		};
		const endX = rect.left + (470 / 1000) * rect.width;
		const endY = rect.top + (280 / 500) * rect.height;
		handle.dispatchEvent(new PointerEvent('pointerdown', start));
		window.dispatchEvent(
			new PointerEvent('pointermove', {
				...start,
				clientX: endX,
				clientY: endY,
				buttons: 1
			})
		);
		window.dispatchEvent(new PointerEvent('pointerup', { ...start, clientX: endX, clientY: endY }));
		expect(callbacks.oncommitspatial).toHaveBeenCalledWith(0, {
			inTangent: { x: -70, y: -30 },
			outTangent: { x: 70, y: 30 },
			continuous: true
		});
		expect(callbacks.oncreatespatial).not.toHaveBeenCalled();
		expect(callbacks.onedit).toHaveBeenCalledOnce();
	});

	it('supports precise keyboard anchor nudging', async () => {
		const { screen, callbacks } = await renderTools(imageItem());
		await screen.getByRole('button', { name: 'Anchor' }).click();
		const anchor = screen.container.querySelector<HTMLButtonElement>(
			'[aria-label="Move anchor point"]'
		);
		if (!anchor) throw new Error('anchor handle missing');
		anchor.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })
		);
		expect(callbacks.oncommitvalues).toHaveBeenCalledWith(12, {
			x: 0,
			y: 0,
			anchorX: 60,
			anchorY: 50
		});
	});
});
