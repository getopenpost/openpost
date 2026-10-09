import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent, page } from 'vitest/browser';
import { ImageEditorController } from '../editor.svelte';
import { blankImageEditorDocument, blankImageEditorPage, defaultTransform } from '../document';
import type { ImageEditorLayer } from '../types';
import Fixture from './editor-interactions.fixture.svelte';
import {
	createGuestImageEditorDesignFromDocument,
	saveGuestImageEditorDesign,
	loadGuestImageEditorDesign,
	deleteGuestImageEditorDesign,
	listGuestImageEditorMedia
} from '../local-persistence';
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
	await userEvent.keyboard('{Home}');
	await expect.element(group).toHaveFocus();
	await userEvent.keyboard('{ArrowRight}');
	await expect.element(group).toHaveAttribute('aria-expanded', 'true');
	await userEvent.keyboard('{End}');
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
it('announces page moves made from the phone actions menu', async () => {
	await page.viewport(320, 800);
	try {
		const editor = setup();
		const screen = await render(Fixture, { editor });
		await screen.getByRole('button', { name: /Page 1: First/ }).click();
		await screen.getByRole('button', { name: 'More actions' }).click();
		await screen.getByRole('menuitem', { name: 'Move page right' }).click();
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
	} finally {
		await page.viewport(1280, 900);
	}
});
it('keeps a selected layer name readable beside its actions in a narrow viewport', async () => {
	await page.viewport(320, 800);
	try {
		const editor = setup();
		editor.updateLayer('Other', { name: 'Launch cover headline' });
		editor.selectLayer('Other');
		const screen = await render(Fixture, { editor });
		const name = screen.getByText('Launch cover headline', { exact: true }).element();
		expect(name.getBoundingClientRect().width).toBeGreaterThanOrEqual(100);
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
	} finally {
		await page.viewport(1280, 900);
	}
});

it('cancels a layer rename without changing the document or history', async () => {
	const editor = setup();
	const screen = await render(Fixture, { editor });
	const row = screen.getByRole('treeitem', { name: /Other/ });
	await row.click();
	await userEvent.keyboard('{F2}');
	await screen.getByRole('textbox', { name: 'Layer name' }).fill('Discard this');
	await userEvent.keyboard('{Escape}');
	expect(editor.activePage?.layers.find((layer) => layer.id === 'Other')?.name).toBe('Other');
	expect(editor.canUndo).toBe(false);
	await expect.element(row).toHaveFocus();
});

it.each(['layer', 'page'])(
	'leaves focus on the clicked control after committing a %s rename on blur',
	async (kind) => {
		const editor = setup();
		const screen = await render(Fixture, { editor });
		if (kind === 'layer') {
			await screen.getByRole('treeitem', { name: /Other/ }).click();
			await userEvent.keyboard('{F2}');
		} else {
			await screen.getByRole('button', { name: 'Rename page' }).click();
		}
		await screen
			.getByRole('textbox', { name: kind === 'layer' ? 'Layer name' : 'Page name' })
			.fill('Cover headline');
		const add = screen.getByRole('button', { name: 'Add layer', exact: true });
		await add.click();
		await expect.element(add).toHaveFocus();
		expect(
			kind === 'layer'
				? editor.activePage?.layers.find((layer) => layer.id === 'Other')?.name
				: editor.activePage?.name
		).toBe('Cover headline');
	}
);

it('uses the compact status row until pages are expanded into the ordered strip', async () => {
	const editor = setup();
	editor.pagesExpanded = false;
	const screen = await render(Fixture, { editor });
	await expect.element(screen.getByTestId('page-status-row')).toBeInTheDocument();
	await expect
		.element(screen.getByRole('status', { name: 'Page 1: First' }))
		.toHaveTextContent('1/3');
	expect(screen.container.querySelector('[data-page-id="first"]')).toBeNull();
	await screen.getByRole('button', { name: 'Expand pages' }).click();
	await expect.element(screen.getByRole('button', { name: /Page 1: First/ })).toBeInTheDocument();
	expect(screen.container.querySelector('[data-testid="page-status-row"]')).toBeNull();
});

it('exposes the current page and renames it inline', async () => {
	const editor = setup();
	const screen = await render(Fixture, { editor });
	const first = screen.getByRole('button', { name: /Page 1: First/ });
	const second = screen.getByRole('button', { name: /Page 2: Second/ });

	await expect.element(first).toHaveAttribute('aria-current', 'page');
	await expect.element(second).not.toHaveAttribute('aria-current');
	await screen.getByRole('button', { name: 'Rename page' }).click();
	const name = screen.getByRole('textbox', { name: 'Page name' });
	await name.fill('Launch cover');
	await userEvent.keyboard('{Enter}');

	await expect.element(screen.getByRole('button', { name: /Page 1: Launch cover/ })).toBeVisible();
	expect(editor.activePage?.name).toBe('Launch cover');
	editor.undo();
	expect(editor.activePage?.name).toBe('First');
});

it('reorders from the rendered thumbnail without importing it and commits one history entry', async () => {
	await page.viewport(320, 800);
	const editor = setup();
	const local = await createGuestImageEditorDesignFromDocument(editor.document!);
	try {
		editor.load(local);
		const imported = vi.fn();
		const changed = vi.fn();
		editor.onChange(changed);
		const screen = await render(Fixture, { editor, onExternalFiles: imported });
		const first = screen.getByRole('button', { name: /Page 1: First/ });
		const third = screen.getByRole('button', { name: /Page 3: Third/ });
		await expect.poll(() => third.element().querySelector('img')).not.toBeNull();
		const source = third.element();
		let dragOwner: EventTarget | null = null;
		source.addEventListener(
			'dragstart',
			(event) => {
				dragOwner = event.target;
			},
			{ once: true }
		);
		await userEvent.dragAndDrop(source.querySelector('img')!, first);
		await expect.element(screen.getByRole('button', { name: /Page 1: Third/ })).toHaveFocus();
		await Promise.all(
			screen.container
				.getAnimations({ subtree: true })
				.map((animation) => animation.finished.catch(() => undefined))
		);
		const bounds = source.getBoundingClientRect();
		const stripBounds = source.parentElement!.getBoundingClientRect();
		expect(bounds.left).toBeGreaterThanOrEqual(stripBounds.left);
		expect(bounds.right).toBeLessThanOrEqual(stripBounds.right);
		expect(dragOwner).toBe(source);
		expect(editor.document?.pages.map((p) => p.id)).toEqual(['third', 'first', 'second']);
		expect(editor.activePageID).toBe('first');
		expect(imported).not.toHaveBeenCalled();
		expect(changed).toHaveBeenCalledOnce();
		expect(editor.document?.pages.map((p) => p.layers.length)).toEqual([0, 3, 0]);
		editor.undo();
		expect(editor.document?.pages.map((p) => p.id)).toEqual(['first', 'second', 'third']);
		expect(editor.canUndo).toBe(false);
		editor.redo();
		expect(editor.document?.pages.map((p) => p.id)).toEqual(['third', 'first', 'second']);
		expect(editor.activePageID).toBe('first');
		await saveGuestImageEditorDesign(local.id, editor.document!);
		const reopened = await loadGuestImageEditorDesign(local.id);
		const cold = new ImageEditorController();
		cold.load(reopened);
		expect(cold.document?.pages.map((p) => [p.id, p.layers.length])).toEqual([
			['third', 0],
			['first', 3],
			['second', 0]
		]);
		expect(await listGuestImageEditorMedia(local.id)).toEqual([]);
	} finally {
		await deleteGuestImageEditorDesign(local.id);
		await page.viewport(1280, 900);
	}
});

it('keeps label and thumbnail outside drops inert and label reorders preserve active identity', async () => {
	const editor = setup();
	const imported = vi.fn();
	const changed = vi.fn();
	editor.onChange(changed);
	const screen = await render(Fixture, { editor, onExternalFiles: imported });
	const third = screen.getByRole('button', { name: /Page 3: Third/ });
	await expect.poll(() => third.element().querySelector('img')).not.toBeNull();
	for (const origin of [third.element().querySelector('img')!, third.element().lastElementChild!]) {
		await userEvent.dragAndDrop(origin, screen.container, { targetPosition: { x: 10, y: 10 } });
		expect(editor.document?.pages.map((p) => p.id)).toEqual(['first', 'second', 'third']);
		expect(editor.activePageID).toBe('first');
		expect(editor.canUndo).toBe(false);
		expect(changed).not.toHaveBeenCalled();
		expect(imported).not.toHaveBeenCalled();
	}
	await userEvent.dragAndDrop(
		third.element().lastElementChild!,
		screen.getByRole('button', { name: /Page 1: First/ })
	);
	expect(editor.document?.pages.map((p) => p.id)).toEqual(['third', 'first', 'second']);
	expect(editor.activePageID).toBe('first');
	expect(changed).toHaveBeenCalledOnce();
	editor.undo();
	expect(editor.canUndo).toBe(false);
});

it('gives an owned page drag precedence over an image file attached by the browser', async () => {
	const editor = setup();
	const imported = vi.fn();
	const screen = await render(Fixture, { editor, onExternalFiles: imported });
	const preview = document.createElement('canvas');
	preview.width = preview.height = 2;
	const image = await new Promise<Blob>((resolve) => preview.toBlob((blob) => resolve(blob!)));
	const transfer = new DataTransfer();
	transfer.items.add(new File([image], 'thumbnail.png', { type: 'image/png' }));
	screen
		.getByRole('button', { name: /Page 3: Third/ })
		.element()
		.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
	screen
		.getByRole('button', { name: /Page 1: First/ })
		.element()
		.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
	expect(editor.document?.pages.map((p) => p.id)).toEqual(['third', 'first', 'second']);
	expect(editor.activePageID).toBe('first');
	expect(imported).not.toHaveBeenCalled();
	editor.undo();
	expect(editor.canUndo).toBe(false);
	const external = new DataTransfer();
	const file = new File([image], 'external.png', { type: 'image/png' });
	external.items.add(file);
	screen
		.getByRole('button', { name: /Page 2: Second/ })
		.element()
		.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: external }));
	expect(imported).toHaveBeenCalledExactlyOnceWith([file], { x: 540, y: 540 }, 'second');
	expect(editor.activePageID).toBe('second');
});

it('keeps a locked ancestor child selectable while rejecting keyboard and pointer reorder, then unlocks and persists recovery', async () => {
	const editor = setup();
	editor.moveLayerToGroup('Other', 'Group');
	editor.updateLayer('Group', { locked: true });
	const stored = await createGuestImageEditorDesignFromDocument(editor.document!);
	try {
		editor.load(stored);
		const changed = vi.fn();
		editor.onChange(changed);
		const screen = await render(Fixture, { editor });
		const child = screen.getByRole('treeitem', { name: /^Child,/ });
		await child.click();
		const baseline = JSON.stringify(editor.document);
		await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
		expect(JSON.stringify(editor.document)).toBe(baseline);
		await userEvent.dragAndDrop(child, screen.getByRole('treeitem', { name: /^Other,/ }));
		expect(JSON.stringify(editor.document)).toBe(baseline);
		expect(editor.selectedLayerIDs).toEqual(['Child']);
		expect(changed).not.toHaveBeenCalled();
		await expect.element(screen.getByRole('button', { name: 'Reorder Child' })).toBeDisabled();
		await expect.element(screen.getByRole('button', { name: 'Move Child up' })).toBeDisabled();
		await expect.element(screen.getByRole('button', { name: 'Move Child down' })).toBeDisabled();
		await screen.getByRole('button', { name: 'Unlock Group', exact: true }).click();
		await child.click();
		await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
		expect(editor.activePage?.layers.map((layer) => layer.id)).toEqual(['Child', 'Other', 'Group']);
		expect(editor.undoLabel).toBe('Reorder layer');
		editor.undo();
		expect(editor.activePage?.layers.map((layer) => layer.id)).toEqual(['Other', 'Child', 'Group']);
		editor.redo();
		expect(editor.selectedLayerIDs).toEqual(['Child']);
		await saveGuestImageEditorDesign(stored.id, editor.document!);
		const reopened = new ImageEditorController();
		reopened.load(await loadGuestImageEditorDesign(stored.id));
		expect(
			reopened.activePage?.layers.map((layer) => [layer.id, layer.parent_id, layer.locked])
		).toEqual([
			['Child', 'Group', false],
			['Other', 'Group', false],
			['Group', undefined, false]
		]);
		expect(await listGuestImageEditorMedia(stored.id)).toEqual([]);
	} finally {
		await deleteGuestImageEditorDesign(stored.id);
	}
});

it('moves across visible siblings in one step without counting a group child as a sibling', async () => {
	const editor = setup();
	const screen = await render(Fixture, { editor });
	await screen.getByRole('treeitem', { name: /Other/ }).click();
	await screen.getByRole('button', { name: 'Move Other up' }).click();
	const visibleOrder = () =>
		[...screen.container.querySelectorAll<HTMLElement>('[role="treeitem"]')].map(
			(row) => row.dataset.imageEditorLayerId
		);
	await expect.poll(visibleOrder).toEqual(['Other', 'Group', 'Child']);
	editor.undo();
	await expect.poll(visibleOrder).toEqual(['Group', 'Child', 'Other']);
	expect(editor.canUndo).toBe(false);
	await screen.getByRole('treeitem', { name: /Group, group/ }).click();
	await screen.getByRole('button', { name: 'Move Group down' }).click();
	await expect.poll(visibleOrder).toEqual(['Other', 'Group', 'Child']);
	editor.ungroupSelected();
	await expect.poll(visibleOrder).toEqual(['Other', 'Child']);
	editor.undo();
	await expect.poll(visibleOrder).toEqual(['Other', 'Group', 'Child']);
	editor.undo();
	await screen.getByRole('treeitem', { name: /Child/ }).click();
	await screen.getByRole('button', { name: 'Move Child down' }).click();
	expect(editor.canUndo).toBe(false);
	await expect.poll(visibleOrder).toEqual(['Group', 'Child', 'Other']);
});

it('groups layers below an unselected foreground layer without raising them above it', async () => {
	const editor = setup();
	editor.addText('Foreground');
	const foregroundID = editor.selectedLayerIDs[0];
	editor.selectLayer('Other');
	editor.selectLayer('Group', 'toggle');
	const screen = await render(Fixture, { editor });
	editor.groupSelected();
	await expect
		.poll(
			() =>
				screen.container.querySelector<HTMLElement>('[role="treeitem"]')?.dataset.imageEditorLayerId
		)
		.toBe(foregroundID);
	const groupID = editor.selectedLayerIDs[0];
	expect(editor.activePage?.layers.find((layer) => layer.id === 'Group')?.parent_id).toBe(groupID);
	editor.ungroupSelected();
	await expect
		.poll(() =>
			[...screen.container.querySelectorAll<HTMLElement>('[role="treeitem"]')].map(
				(row) => row.dataset.imageEditorLayerId
			)
		)
		.toEqual([foregroundID, 'Group', 'Child', 'Other']);
});

it('groups across parents at the frontmost selected ancestor stacking position', async () => {
	const editor = setup();
	editor.addText('Top child');
	const topID = editor.selectedLayerIDs[0];
	editor.moveLayerToGroup(topID, 'Group');
	editor.selectLayer('Other');
	editor.selectLayer(topID, 'toggle');
	const screen = await render(Fixture, { editor });
	editor.groupSelected();
	const groupID = editor.selectedLayerIDs[0];
	await expect
		.poll(() =>
			[...screen.container.querySelectorAll<HTMLElement>('[role="treeitem"]')].map(
				(row) => row.dataset.imageEditorLayerId
			)
		)
		.toEqual([groupID, topID, 'Other', 'Group', 'Child']);
	expect(editor.activePage?.layers.find((layer) => layer.id === 'Group')?.transform).toMatchObject({
		x: 0,
		y: 0,
		width: 100,
		height: 100
	});
});

it('ungroups selected nested groups into the surviving ancestor and preserves it on reopen', async () => {
	const editor = setup();
	editor.mutate('Prepare nested groups', (document) => {
		const layers = document.pages[0].layers;
		const group = layers.find((layer) => layer.id === 'Group')!;
		group.parent_id = 'Outer';
		layers.find((layer) => layer.id === 'Child')!.transform.x = 120;
		layers.find((layer) => layer.id === 'Other')!.parent_id = 'Outer';
		layers.push({ ...group, id: 'Outer', name: 'Outer', parent_id: 'Grandparent' });
		layers.push({ ...group, id: 'Grandparent', name: 'Grandparent', parent_id: undefined });
	});
	const stored = await createGuestImageEditorDesignFromDocument(editor.document!);
	try {
		editor.load(stored);
		editor.selectLayer('Outer');
		editor.selectLayer('Group', 'toggle');
		const screen = await render(Fixture, { editor });
		editor.ungroupSelected();
		const order = () =>
			[...screen.container.querySelectorAll<HTMLElement>('[role="treeitem"]')].map(
				(row) => row.dataset.imageEditorLayerId
			);
		await expect.poll(order).toEqual(['Grandparent', 'Child', 'Other']);
		expect(editor.activePage?.layers.find((layer) => layer.id === 'Child')?.parent_id).toBe(
			'Grandparent'
		);
		expect(new Set(editor.selectedLayerIDs)).toEqual(new Set(['Child', 'Other']));
		expect(
			editor.activePage?.layers.find((layer) => layer.id === 'Grandparent')?.transform
		).toMatchObject({ x: 0, y: 0, width: 220, height: 100 });
		await saveGuestImageEditorDesign(stored.id, editor.document!);
		editor.load(await loadGuestImageEditorDesign(stored.id));
		await expect.poll(order).toEqual(['Grandparent', 'Child', 'Other']);
		expect(editor.activePage?.layers.find((layer) => layer.id === 'Child')?.parent_id).toBe(
			'Grandparent'
		);
	} finally {
		await deleteGuestImageEditorDesign(stored.id);
	}
});
