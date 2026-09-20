import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { ImageEditorController } from '../editor.svelte';
import { blankImageEditorDocument, defaultImageAdjustments, defaultTransform } from '../document';
import type { ImageEditorLayer } from '../types';
import Fixture from './properties-panel.fixture.svelte';
import '../../../routes/layout.css';

function setup(layers: ImageEditorLayer[]): ImageEditorController {
	const editor = new ImageEditorController();
	const document = blankImageEditorDocument({
		key: 'custom',
		name: 'Test',
		default_format: 'png',
		profiles: [],
		width_px: 1080,
		height_px: 1080
	});
	document.pages[0].layers = layers;
	editor.load({
		id: 'test',
		workspace_id: 'local',
		created_by_id: 'test',
		can_edit: true,
		revision: 1,
		created_at: '2026-09-20',
		updated_at: '2026-09-20',
		document
	});
	return editor;
}

function shape(id: string, x: number): ImageEditorLayer {
	return {
		id,
		name: id,
		type: 'shape',
		visible: true,
		locked: false,
		opacity: 1,
		transform: defaultTransform(100, 100, x, 0),
		shape: {
			kind: 'rectangle',
			fill: '#ffffff',
			stroke: '#000000',
			stroke_width: 0,
			radius: 0
		}
	};
}

function imageLayer(): ImageEditorLayer {
	return {
		id: 'image',
		name: 'Photo',
		type: 'image',
		visible: true,
		locked: false,
		opacity: 1,
		transform: defaultTransform(400, 300),
		image: {
			media_id: 'media',
			source_width: 400,
			source_height: 300,
			fit: 'cover',
			crop: { x: 0, y: 0, width: 1, height: 1 },
			adjustments: defaultImageAdjustments()
		}
	};
}

it('opens Transform and exposes alignment for a multi-layer selection', async () => {
	const editor = setup([shape('One', 0), shape('Two', 200)]);
	editor.selectLayer('One');
	editor.selectLayer('Two', 'toggle');
	const screen = await render(Fixture, { editor });

	await expect
		.element(screen.getByRole('button', { name: 'Transform' }))
		.toHaveAttribute('aria-expanded', 'true');
	await expect.element(screen.getByRole('button', { name: 'Left' })).toBeVisible();
	await expect.element(screen.getByRole('button', { name: 'Right' })).toBeVisible();
});

it('targets selected images first and keeps advanced color tools behind a disclosure', async () => {
	const editor = setup([imageLayer()]);
	editor.selectLayer('image');
	const screen = await render(Fixture, { editor, colorWorkspace: true });

	await expect
		.element(screen.getByRole('button', { name: 'Layers' }))
		.toHaveAttribute('aria-pressed', 'true');
	await expect
		.element(screen.getByRole('button', { name: 'Advanced' }))
		.toHaveAttribute('aria-expanded', 'false');
	await expect.element(screen.getByText('Tone')).toBeVisible();
	await expect.element(screen.getByLabelText('Scopes', { exact: true })).not.toBeVisible();
});
