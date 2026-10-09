import { expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
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
	const x = screen.getByLabelText('X', { exact: true });
	const width = screen.getByLabelText('W', { exact: true });
	await expect.element(x).toHaveValue(0);
	await expect.element(screen.getByLabelText('Y', { exact: true })).toHaveValue(0);
	await expect.element(width).toHaveValue(300);
	await expect.element(screen.getByLabelText('H', { exact: true })).toHaveValue(100);

	await x.fill('50');
	await expect.element(x).toHaveValue(50);
	expect(editor.activePage?.layers.find((layer) => layer.id === 'One')?.transform.x).toBe(50);
	expect(editor.activePage?.layers.find((layer) => layer.id === 'Two')?.transform.x).toBe(250);

	await width.fill('600');
	await expect.element(width).toHaveValue(600);
	expect(editor.activePage?.layers.find((layer) => layer.id === 'One')?.transform).toMatchObject({
		x: 50,
		width: 200,
		height: 200
	});
	expect(editor.activePage?.layers.find((layer) => layer.id === 'Two')?.transform).toMatchObject({
		x: 450,
		width: 200,
		height: 200
	});
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
	await screen.getByRole('button', { name: 'Advanced' }).click();
	for (const channel of ['Master', 'Red', 'Green', 'Blue']) {
		const button = screen.getByRole('button', { name: channel, exact: true });
		await expect.element(button).toBeVisible();
		const bounds = button.element().getBoundingClientRect();
		expect(bounds.width).toBeGreaterThanOrEqual(44);
		expect(bounds.height).toBeGreaterThanOrEqual(44);
	}
});

it.each(['layer', 'group'])(
	'disables %s-locked text editing and restores editing after unlock and Undo',
	async (lockOwner) => {
		const authored = setup([]);
		authored.addText();
		const text = structuredClone(authored.selectedLayers[0]);
		text.locked = lockOwner === 'layer';
		text.text!.text = 'Original 東京';
		const group: ImageEditorLayer = {
			...shape('Group', 0),
			type: 'group',
			shape: undefined,
			locked: true
		};
		if (lockOwner === 'group') text.parent_id = group.id;
		const lockID = lockOwner === 'group' ? group.id : text.id;
		const editor = setup(lockOwner === 'group' ? [group, text] : [text]);
		editor.selectLayer(text.id);
		const screen = await render(Fixture, { editor });
		const input = screen.getByLabelText('Text', { exact: true });
		await expect.element(input).toBeDisabled();
		await expect.element(input).toHaveValue('Original 東京');
		await expect.element(screen.getByLabelText('Size', { exact: true })).toBeDisabled();
		expect(editor.canUndo).toBe(false);

		editor.updateLayer(lockID, { locked: false });
		await expect.element(input).toBeEnabled();
		await input.fill('Edited مرحبا');
		await input.click();
		await userEvent.tab();
		await expect.element(input).not.toHaveFocus();
		expect(editor.selectedLayers[0].text?.text).toBe('Edited مرحبا');
		editor.undo();
		await expect.element(input).toHaveValue('Original 東京');
		editor.redo();
		await expect.element(input).toHaveValue('Edited مرحبا');
		editor.updateLayer(lockID, { locked: true });
		const cold = setup(JSON.parse(JSON.stringify(editor.activePage!.layers)));
		cold.selectLayer(text.id);
		expect(cold.selectedLayers[0].text?.text).toBe('Edited مرحبا');
		expect(cold.isLayerLocked(text.id)).toBe(true);
		await expect.element(input).toBeDisabled();
	}
);

it('disables locked shape radius and preserves accepted edits through Undo and reload', async () => {
	const rounded = shape('Rounded', 0);
	rounded.locked = true;
	rounded.shape!.kind = 'rounded_rectangle';
	rounded.shape!.radius = 32;
	const editor = setup([rounded]);
	editor.selectLayer(rounded.id);
	const screen = await render(Fixture, { editor });
	const radius = screen.getByLabelText('Corner radius', { exact: true });
	await expect.element(radius).toBeDisabled();
	await expect.element(radius).toHaveValue(32);
	expect(editor.canUndo).toBe(false);

	editor.updateLayer(rounded.id, { locked: false });
	await expect.element(radius).toBeEnabled();
	await radius.fill('80');
	expect(editor.selectedLayers[0].shape?.radius).toBe(80);
	editor.undo();
	await expect.element(radius).toHaveValue(32);
	editor.redo();
	await expect.element(radius).toHaveValue(80);
	editor.updateLayer(rounded.id, { locked: true });
	const cold = setup(JSON.parse(JSON.stringify(editor.activePage!.layers)));
	cold.selectLayer(rounded.id);
	expect(cold.selectedLayers[0]).toMatchObject({ locked: true, shape: { radius: 80 } });
	await expect.element(radius).toBeDisabled();
});
