import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import { ImageEditorController } from '../editor.svelte';
import { blankImageEditorDocument, defaultTransform } from '../document';
import { rectanglePixelMask } from '../selection';
import Fixture from './image-editor-canvas.fixture.svelte';
import '../../../routes/layout.css';

function floatingSelection() {
	const editor = new ImageEditorController();
	const document = blankImageEditorDocument({
		key: 'custom',
		name: 'Test',
		default_format: 'png',
		profiles: [],
		width_px: 400,
		height_px: 300
	});
	document.pages[0].layers = [
		{
			id: 'paint',
			name: 'Paint',
			type: 'paint',
			visible: true,
			locked: false,
			opacity: 1,
			transform: defaultTransform(100, 80, 100, 80),
			paint: {
				kind: 'fill',
				color: '#f97316',
				size: 1,
				opacity: 1,
				source_width: 100,
				source_height: 80,
				points: [],
				spans: Array.from({ length: 80 }, (_, y) => ({ x: 0, y, width: 100 }))
			}
		}
	];
	editor.load({
		id: 'design',
		workspace_id: 'local',
		created_by_id: 'test',
		revision: 1,
		can_edit: true,
		created_at: '2026-10-02',
		updated_at: '2026-10-02',
		document
	});
	editor.selectLayer('paint');
	editor.activeTool = 'marquee';
	editor.applyPixelSelection(
		rectanglePixelMask(400, 300, { x: 100, y: 80, width: 100, height: 80 }),
		['paint'],
		'replace'
	);
	expect(
		editor.beginFloatingPixelSelection('cut', [
			{ id: 'paint', width: 100, height: 80, data: new Uint8Array(8000).fill(1) }
		])
	).toBe(true);
	return editor;
}

it.each([
	{ zoom: 1, panX: 0, panY: 0 },
	{ zoom: 0.5, panX: 35, panY: -20 }
])(
	'anchors floating SE resize at NW in page coordinates with $zoom zoom',
	async ({ zoom, panX, panY }) => {
		await page.viewport(1280, 900);
		const editor = floatingSelection();
		const original = JSON.stringify(editor.document);
		const screen = await render(Fixture, { editor });
		await expect.element(screen.getByTestId('image-editor-selection-surface')).toBeVisible();
		// Wait for the real renderer to own the canvas before driving the visible handle.
		await expect.poll(() => screen.container.querySelector('.upper-canvas')).not.toBeNull();
		editor.zoom = zoom;
		editor.panX = panX;
		editor.panY = panY;
		const handle = screen.getByRole('button', {
			name: 'Resize selected pixels from se',
			exact: true
		});
		await expect.element(handle).toBeVisible();
		const surface = screen.getByTestId('image-editor-selection-surface');
		await expect
			.poll(() => surface.element().getBoundingClientRect().width)
			.toBeCloseTo(400 * zoom, 1);
		const from = handle.element().getBoundingClientRect();
		const stage = surface.element().getBoundingClientRect();
		const target = {
			x: from.x + from.width / 2 - stage.x + 30 * zoom,
			y: from.y + from.height / 2 - stage.y + 20 * zoom
		};
		await userEvent.dragAndDrop(handle, surface, { targetPosition: target });
		const bounds = editor.floatingPixelSelectionBounds!;
		expect(bounds.x).toBeCloseTo(100, 0);
		expect(bounds.y).toBeCloseTo(80, 0);
		expect(bounds.width).toBeCloseTo(130, 0);
		expect(bounds.height).toBeCloseTo(100, 0);
		const floating = editor.activePage!.layers.find((layer) =>
			editor.floatingPixelSelection!.layerIDs.includes(layer.id)
		)!;
		expect(floating.transform.x).toBeCloseTo(100, 1);
		expect(floating.transform.y).toBeCloseTo(80, 1);
		expect(floating.transform.width).toBeCloseTo(130, 1);
		expect(floating.transform.height).toBeCloseTo(100, 1);
		const canvas = screen.container.querySelector<HTMLCanvasElement>('canvas.lower-canvas')!;
		const rasterScale = canvas.width / 400;
		await expect
			.poll(() => {
				const pixels = canvas
					.getContext('2d')!
					.getImageData(0, 0, canvas.width, canvas.height).data;
				let left = canvas.width,
					top = canvas.height,
					right = -1,
					bottom = -1;
				for (let y = 0; y < canvas.height; y++)
					for (let x = 0; x < canvas.width; x++) {
						const index = (y * canvas.width + x) * 4;
						if (
							pixels[index] < 240 ||
							pixels[index + 1] < 60 ||
							pixels[index + 1] > 200 ||
							pixels[index + 2] > 150 ||
							pixels[index + 3] < 200
						)
							continue;
						left = Math.min(left, x);
						top = Math.min(top, y);
						right = Math.max(right, x);
						bottom = Math.max(bottom, y);
					}
				return Math.max(
					Math.abs(left - 100 * rasterScale),
					Math.abs(top - 80 * rasterScale),
					Math.abs(right - left + 1 - 130 * rasterScale),
					Math.abs(bottom - top + 1 - 100 * rasterScale)
				);
			})
			.toBeLessThanOrEqual(2);
		// Sample the solid interior, leaving the canvas selection outline outside the probe.
		await expect
			.poll(() => {
				const painted = canvas
					.getContext('2d')!
					.getImageData(0, 0, canvas.width, canvas.height).data;
				const minimum = [255, 255, 255],
					maximum = [0, 0, 0];
				for (let y = Math.ceil(90 * rasterScale); y < Math.floor(170 * rasterScale); y++)
					for (let x = Math.ceil(110 * rasterScale); x < Math.floor(220 * rasterScale); x++) {
						const index = (y * canvas.width + x) * 4;
						for (let channel = 0; channel < 3; channel++) {
							minimum[channel] = Math.min(minimum[channel], painted[index + channel]);
							maximum[channel] = Math.max(maximum[channel], painted[index + channel]);
						}
					}
				return Math.max(...maximum.map((value, channel) => value - minimum[channel]));
			})
			.toBeLessThanOrEqual(2);
		expect(editor.commitFloatingPixelSelection()).toBe(true);
		const committed = JSON.stringify(editor.document);
		editor.undo();
		expect(editor.activePage?.layers).toHaveLength(1);
		editor.redo();
		expect(JSON.stringify(editor.document)).toBe(committed);
		expect(committed).not.toBe(original);
	}
);

it('anchors the opposite corner when resizing rotated pixels and Escape cancels the whole pending cut', async () => {
	const editor = floatingSelection();
	const screen = await render(Fixture, { editor });
	await expect.poll(() => screen.container.querySelector('.upper-canvas')).not.toBeNull();
	const rotate = screen.getByRole('button', { name: 'Rotate selected pixels', exact: true });
	await rotate.click();
	await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
	const original = { ...editor.floatingPixelSelectionBounds! };
	const nw = screen.getByRole('button', { name: 'Resize selected pixels from nw', exact: true });
	const se = screen.getByRole('button', { name: 'Resize selected pixels from se', exact: true });
	const surface = screen.getByTestId('image-editor-selection-surface');
	const from = nw.element().getBoundingClientRect();
	const anchor = se.element().getBoundingClientRect();
	const stage = surface.element().getBoundingClientRect();
	await userEvent.dragAndDrop(nw, surface, {
		targetPosition: {
			x: from.x + from.width / 2 - stage.x - 20,
			y: from.y + from.height / 2 - stage.y - 10
		}
	});
	const resized = editor.floatingPixelSelectionBounds!;
	// Raster mask bounds can quantize by one page pixel after rotation.
	expect(Math.abs(resized.x + resized.width - original.x - original.width)).toBeLessThanOrEqual(1);
	expect(Math.abs(resized.y + resized.height - original.y - original.height)).toBeLessThanOrEqual(
		1
	);
	expect(Math.abs(resized.x - original.x + 20)).toBeLessThanOrEqual(1);
	expect(Math.abs(resized.y - original.y + 10)).toBeLessThanOrEqual(1);
	const settledAnchor = se.element().getBoundingClientRect();
	expect(Math.abs(settledAnchor.x - anchor.x)).toBeLessThanOrEqual(1);
	expect(Math.abs(settledAnchor.y - anchor.y)).toBeLessThanOrEqual(1);
	await userEvent.keyboard('{Escape}');
	expect(editor.floatingPixelSelection).toBeNull();
	expect(editor.activePage?.layers).toHaveLength(1);
	expect(editor.activePage?.layers[0]).toMatchObject({
		id: 'paint',
		transform: { x: 100, y: 80, width: 100, height: 80, rotation: 0 }
	});
	expect(editor.activePage?.layers[0].paint?.spans).toEqual(
		Array.from({ length: 80 }, (_, y) => ({ x: 0, y, width: 100 }))
	);
	expect(editor.canUndo).toBe(false);
});
