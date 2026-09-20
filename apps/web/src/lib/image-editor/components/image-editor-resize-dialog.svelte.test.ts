import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import { ImageEditorController } from '../editor.svelte';
import { blankImageEditorDocument, defaultTransform } from '../document';
import Fixture from './image-editor-resize-dialog.fixture.svelte';
import '../../../routes/layout.css';

function setup(): ImageEditorController {
	const editor = new ImageEditorController();
	const document = blankImageEditorDocument({
		key: 'test-landscape',
		name: 'Test landscape',
		default_format: 'png',
		profiles: [],
		width_px: 100,
		height_px: 50
	});
	document.pages[0].layers = [
		{
			id: 'image',
			type: 'image',
			name: 'Image',
			visible: true,
			locked: false,
			opacity: 1,
			transform: defaultTransform(20, 10, 10, 5),
			image: {
				media_id: 'test-image',
				source_width: 200,
				source_height: 100,
				fit: 'stretch',
				crop: { x: 0, y: 0, width: 1, height: 1 },
				adjustments: {
					brightness: 0,
					contrast: 0,
					saturation: 0,
					temperature: 0,
					tint: 0,
					vibrance: 0,
					hue: 0,
					exposure: 0,
					highlights: 0,
					shadows: 0,
					blur: 0
				}
			}
		}
	];
	editor.load({
		id: 'design',
		workspace_id: 'workspace',
		created_by_id: 'user',
		revision: 1,
		can_edit: true,
		created_at: '2026-09-20T00:00:00Z',
		updated_at: '2026-09-20T00:00:00Z',
		document
	});
	return editor;
}

it('defaults to fit and commits one undoable aspect-preserving resize', async () => {
	const editor = setup();
	const original = editor.document;
	const screen = await render(Fixture, { editor });

	await expect.element(screen.getByRole('radio', { name: /^Fit/ })).toBeChecked();
	await expect.element(screen.getByRole('radio', { name: /^Fill/ })).toBeInTheDocument();
	await expect.element(screen.getByRole('radio', { name: /^Keep size/ })).toBeInTheDocument();
	await expect.element(screen.getByRole('radio', { name: /^Stretch/ })).toBeInTheDocument();

	const width = screen.getByRole('spinbutton', { name: 'Width' });
	const height = screen.getByRole('spinbutton', { name: 'Height' });
	await userEvent.clear(width);
	await userEvent.type(width, '200');
	await userEvent.clear(height);
	await userEvent.type(height, '200');
	await screen.getByRole('button', { name: 'Resize' }).click();

	expect(editor.document).not.toBe(original);
	expect(original).toMatchObject({ width_px: 100, height_px: 50 });
	expect(editor.document).toMatchObject({ width_px: 200, height_px: 200 });
	expect(editor.activePage?.layers[0].transform).toMatchObject({
		x: 20,
		y: 60,
		width: 40,
		height: 20
	});
	expect(editor.canUndo).toBe(true);

	editor.undo();
	expect(editor.document).toMatchObject({ width_px: 100, height_px: 50 });
	expect(editor.activePage?.layers[0].transform).toMatchObject({
		x: 10,
		y: 5,
		width: 20,
		height: 10
	});
});

it('keeps every resize choice usable at 320px in dark mode', async () => {
	await page.viewport(320, 734);
	document.documentElement.classList.add('dark');
	try {
		const screen = await render(Fixture, { editor: setup() });
		await expect.element(screen.getByRole('dialog')).toBeInTheDocument();
		await expect.element(screen.getByRole('radio', { name: /^Fit/ })).toBeVisible();
		await expect.element(screen.getByRole('radio', { name: /^Fill/ })).toBeVisible();
		await expect.element(screen.getByRole('radio', { name: /^Keep size/ })).toBeVisible();
		await expect.element(screen.getByRole('radio', { name: /^Stretch/ })).toBeVisible();
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
	} finally {
		document.documentElement.classList.remove('dark');
		await page.viewport(1280, 900);
	}
});
