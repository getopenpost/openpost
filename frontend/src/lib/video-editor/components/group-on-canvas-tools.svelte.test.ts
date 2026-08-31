import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem } from '$lib/video-editor/project/types';
import type { GroupTransform } from '$lib/video-editor/preview/group-transform';
import GroupOnCanvasTools from './group-on-canvas-tools.svelte';
import '../../../routes/layout.css';

function imageItem(id: string, x: number, patch: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id,
		trackId: `track-${id}`,
		from: 0,
		durationInFrames: 90,
		label: id,
		type: 'image',
		sourceWidth: 100,
		sourceHeight: 100,
		transform: { x, y: 0, width: 100, height: 100, rotation: 0 },
		...patch
	};
}

async function renderTools({
	items = [imageItem('left', -150), imageItem('right', 150)],
	width = 1000,
	snappingEnabled = false
}: {
	items?: TimelineItem[];
	width?: number;
	snappingEnabled?: boolean;
} = {}) {
	await page.viewport(width, 700);
	const callbacks = {
		ontransformdraft: vi.fn(),
		oncommit: vi.fn((_frame: number, _transforms: ReadonlyMap<string, GroupTransform>) => true),
		onselectitem: vi.fn(),
		ontogglesnapping: vi.fn(),
		onedit: vi.fn()
	};
	const screen = await render(GroupOnCanvasTools, {
		items,
		canvasWidth: 1000,
		canvasHeight: 500,
		currentFrame: 12,
		snappingEnabled,
		snapItems: items,
		...callbacks
	});
	screen.container.dataset.programMonitor = '';
	screen.container.style.position = 'relative';
	screen.container.style.width = `${width}px`;
	screen.container.style.height = `${width / 2}px`;
	return { screen, callbacks };
}

function canvasClientPoint(container: HTMLElement, x: number, y: number) {
	const rect = container.getBoundingClientRect();
	return {
		clientX: rect.left + (x / 1000) * rect.width,
		clientY: rect.top + (y / 500) * rect.height
	};
}

describe('GroupOnCanvasTools', () => {
	it('renders one compact gizmo with all canvas alignment actions', async () => {
		const { screen } = await renderTools();
		await expect
			.element(screen.getByRole('toolbar', { name: 'Align and distribute selected clips' }))
			.toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Left', exact: true })).toBeVisible();
		await expect
			.element(screen.getByRole('button', { name: 'Distribute horizontally', exact: true }))
			.toBeDisabled();
		expect(screen.container.querySelectorAll('[data-group-scale-handle]')).toHaveLength(4);
		expect(screen.container.querySelector('[data-group-rotate-handle]')).not.toBeNull();
	});

	it('keeps toolbar and transform handles usable at phone width', async () => {
		const { screen } = await renderTools({ width: 320 });
		const toolbar = screen
			.getByRole('toolbar', {
				name: 'Align and distribute selected clips'
			})
			.element();
		const left = screen.getByRole('button', { name: 'Left', exact: true }).element();
		const leftBounds = left.getBoundingClientRect();
		expect(leftBounds.width).toBeGreaterThanOrEqual(44);
		expect(leftBounds.height).toBeGreaterThanOrEqual(44);
		expect(toolbar.getBoundingClientRect().width).toBeLessThanOrEqual(320);
		const scaleHandle = screen.container.querySelector<HTMLElement>('[data-group-scale-handle]');
		const rotateHandle = screen.container.querySelector<HTMLElement>('[data-group-rotate-handle]');
		expect(scaleHandle?.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
		expect(rotateHandle?.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
	});

	it('previews and commits one exact map for a pointer translation', async () => {
		const { screen, callbacks } = await renderTools();
		const box = screen.container.querySelector<HTMLButtonElement>('[data-group-transform-box]');
		if (!box) throw new Error('group move surface missing');
		const start = canvasClientPoint(screen.container, 500, 250);
		const end = canvasClientPoint(screen.container, 550, 275);
		box.dispatchEvent(
			new PointerEvent('pointerdown', { bubbles: true, pointerId: 4, button: 0, ...start })
		);
		window.dispatchEvent(
			new PointerEvent('pointermove', { bubbles: true, pointerId: 99, buttons: 1, ...end })
		);
		expect(callbacks.ontransformdraft).not.toHaveBeenCalled();
		window.dispatchEvent(
			new PointerEvent('pointermove', { bubbles: true, pointerId: 4, buttons: 1, ...end })
		);
		window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 4, ...end }));

		expect(callbacks.oncommit).toHaveBeenCalledOnce();
		const [frame, transforms] = callbacks.oncommit.mock.calls[0]!;
		expect(frame).toBe(12);
		expect(transforms.get('left')).toMatchObject({ x: -100, y: 25 });
		expect(transforms.get('right')).toMatchObject({ x: 200, y: 25 });
		expect(callbacks.onedit).toHaveBeenCalledOnce();
		expect(callbacks.ontransformdraft).toHaveBeenLastCalledWith(null);
	});

	it('cancels a drag on Escape without committing stale preview state', async () => {
		const { screen, callbacks } = await renderTools();
		const box = screen.container.querySelector<HTMLButtonElement>('[data-group-transform-box]');
		if (!box) throw new Error('group move surface missing');
		const start = canvasClientPoint(screen.container, 500, 250);
		const end = canvasClientPoint(screen.container, 600, 250);
		box.dispatchEvent(
			new PointerEvent('pointerdown', { bubbles: true, pointerId: 8, button: 0, ...start })
		);
		window.dispatchEvent(
			new PointerEvent('pointermove', { bubbles: true, pointerId: 8, buttons: 1, ...end })
		);
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 8, ...end }));
		expect(callbacks.oncommit).not.toHaveBeenCalled();
		expect(callbacks.ontransformdraft).toHaveBeenLastCalledWith(null);
	});

	it('supports atomic keyboard movement and topmost-item click selection', async () => {
		const overlapping = [imageItem('bottom', 0), imageItem('top', 0)];
		const { screen, callbacks } = await renderTools({ items: overlapping });
		const box = screen.container.querySelector<HTMLButtonElement>('[data-group-transform-box]');
		if (!box) throw new Error('group move surface missing');
		box.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })
		);
		expect(callbacks.oncommit).toHaveBeenCalledOnce();
		expect(callbacks.oncommit.mock.calls[0]![1].get('bottom')?.x).toBe(10);
		expect(callbacks.oncommit.mock.calls[0]![1].get('top')?.x).toBe(10);

		callbacks.oncommit.mockClear();
		const center = canvasClientPoint(screen.container, 500, 250);
		box.dispatchEvent(
			new PointerEvent('pointerdown', { bubbles: true, pointerId: 11, button: 0, ...center })
		);
		window.dispatchEvent(
			new PointerEvent('pointerup', { bubbles: true, pointerId: 11, ...center })
		);
		expect(callbacks.oncommit).not.toHaveBeenCalled();
		expect(callbacks.onselectitem).toHaveBeenCalledWith('top');
	});

	it('fits the action strip inside a 320px monitor', async () => {
		const { screen } = await renderTools({ width: 320 });
		const toolbar = screen.container.querySelector<HTMLElement>('[data-group-alignment-toolbar]');
		if (!toolbar) throw new Error('alignment toolbar missing');
		expect(toolbar.getBoundingClientRect().width).toBeLessThanOrEqual(304.5);
		expect(toolbar.scrollWidth).toBeGreaterThanOrEqual(toolbar.clientWidth);
		await page.screenshot({
			element: screen.container,
			path: '../../../../.svelte-kit/openpost-group-transform-320.png'
		});
	});
});
