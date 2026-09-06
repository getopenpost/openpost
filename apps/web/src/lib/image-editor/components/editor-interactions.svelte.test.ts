import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent, page } from 'vitest/browser';
import { ImageEditorController } from '../editor.svelte';
import { blankImageEditorDocument, blankImageEditorPage, defaultTransform } from '../document';
import type { ImageEditorLayer } from '../types';
import Fixture from './editor-interactions.fixture.svelte';
import '../../../routes/layout.css';
function setup() {
	const editor = new ImageEditorController();
	const doc = blankImageEditorDocument({
		key: 'custom',
		name: 'Test',
		default_format: 'png',
		profiles: [],
		width_px: 1080,
		height_px: 1080
	});
	const layer = (id: string, type: 'shape' | 'group', parent_id?: string): ImageEditorLayer => ({
		id,
		name: id,
		type,
		parent_id,
		visible: true,
		locked: false,
		opacity: 1,
		transform: defaultTransform(100, 100)
	});
	doc.pages = [
		{
			...blankImageEditorPage('First'),
			id: 'first',
			layers: [layer('Other', 'shape'), layer('Child', 'shape', 'Group'), layer('Group', 'group')]
		},
		{ ...blankImageEditorPage('Second'), id: 'second' },
		{ ...blankImageEditorPage('Third'), id: 'third' }
	];
	editor.load({
		id: 'test',
		workspace_id: 'local',
		created_by_id: 'test',
		can_edit: true,
		revision: 1,
		created_at: '2026-09-06',
		updated_at: '2026-09-06',
		document: doc
	});
	editor.pagesExpanded = true;
	return editor;
}
it('navigates the visible tree without changing selection and skips collapsed children', async () => {
	const editor = setup();
	editor.selectLayer('Child');
	editor.selectLayer('Other', 'toggle');
	const screen = await render(Fixture, { editor });
	const group = screen.getByRole('treeitem', { name: /Group/ });
	const child = screen.getByRole('treeitem', { name: /Child/ });
	const other = screen.getByRole('treeitem', { name: /Other/ });
	await userEvent.click(group); // Start at a visible parent, then restore multi-selection.
	editor.selectLayer('Child');
	editor.selectLayer('Other', 'toggle');
	await userEvent.keyboard('{ArrowRight}');
	await expect.element(child).toHaveFocus();
	expect(editor.selectedLayerIDs).toEqual(['Child', 'Other']);
	await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
	await expect.element(group).toHaveAttribute('aria-expanded', 'false');
	await userEvent.keyboard('{ArrowDown}');
	await expect.element(other).toHaveFocus();
	await userEvent.keyboard('{Home}{ArrowRight}{End}');
	await expect.element(other).toHaveFocus();
	expect(editor.selectedLayerIDs).toEqual(['Child', 'Other']);
	expect(screen.container.querySelectorAll('[role="treeitem"][tabindex="0"]')).toHaveLength(1);
});
it('previews page moves without saving, cancels, then commits one undoable move', async () => {
	const editor = setup();
	const changed = vi.fn();
	editor.onChange(changed);
	const screen = await render(Fixture, { editor });
	const first = screen.getByRole('button', { name: /Page 1: First/ });
	await first.click();
	await userEvent.keyboard(' {ArrowRight}');
	await expect.element(screen.getByRole('button', { name: /Page 2: First/ })).toHaveFocus();
	expect(editor.document?.pages.map((p) => p.id)).toEqual(['first', 'second', 'third']);
	expect(changed).not.toHaveBeenCalled();
	await userEvent.keyboard('{Escape}');
	await expect.element(first).toHaveFocus();
	expect(editor.canUndo).toBe(false);
	await userEvent.keyboard(' {ArrowRight}{ArrowRight} ');
	expect(editor.document?.pages.map((p) => p.id)).toEqual(['second', 'third', 'first']);
	expect(changed).toHaveBeenCalledOnce();
	editor.undo();
	expect(editor.document?.pages.map((p) => p.id)).toEqual(['first', 'second', 'third']);
	expect(editor.canUndo).toBe(false);
});
it('announces page moves made with the visible reorder controls', async () => {
	const editor = setup();
	const screen = await render(Fixture, { editor });
	await screen.getByRole('button', { name: /Page 1: First/ }).click();
	await screen.getByRole('button', { name: 'Move page right' }).click();
	await expect.element(screen.getByText('First, position 2 of 3.')).toBeInTheDocument();
	expect(editor.document?.pages.map((page) => page.id)).toEqual(['second', 'first', 'third']);
	const transfer = new DataTransfer();
	screen.container
		.querySelector<HTMLElement>('[data-page-id="first"]')!
		.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
	screen.container
		.querySelector<HTMLElement>('[data-page-id="third"]')!
		.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
	await expect.element(screen.getByText('Placed First at position 3.')).toBeInTheDocument();
	expect(editor.document?.pages.map((page) => page.id)).toEqual(['second', 'third', 'first']);
});
it('keeps page controls and long layer names inside a narrow viewport', async () => {
	await page.viewport(320, 800);
	try {
		const editor = setup();
		await render(Fixture, { editor });
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
	} finally {
		await page.viewport(1280, 900);
	}
});
