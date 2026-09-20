import { describe, expect, it } from 'vitest';
import { ImageEditorController } from './editor.svelte';
import { defaultTransform } from './document';
import { defaultEditorColorGradeAdjustments } from '$lib/editor-color-grade/model';
import { prepareRasterOperation, rasterRenderDocument } from './raster-operations';
import type { ImageEditorDocument, ImageEditorLayer } from './types';

function layer(id: string, parent_id?: string): ImageEditorLayer {
	return {
		id,
		name: id,
		type: 'shape',
		parent_id,
		visible: true,
		locked: false,
		opacity: 1,
		transform: defaultTransform(20, 20),
		shape: { kind: 'rectangle', fill: '#ff0000', stroke: '#000000', stroke_width: 0, radius: 0 }
	};
}
function fixture(layers = [layer('back'), layer('middle'), layer('front')]): ImageEditorController {
	const document: ImageEditorDocument = {
		schema_version: 1,
		title: 'Raster',
		preset_key: 'custom',
		width_px: 100,
		height_px: 100,
		brand_kit_revision: 0,
		export_defaults: { format: 'jpeg', quality: 0.5, matte_color: '#ffffff' },
		pages: [{ id: 'page', name: 'Page', background_color: '#ffffff', layers }]
	};
	const editor = new ImageEditorController();
	editor.load({
		id: 'design',
		workspace_id: '',
		created_by_id: '',
		revision: 1,
		can_edit: true,
		created_at: '',
		updated_at: '',
		document
	});
	return editor;
}
describe('explicit raster operations', () => {
	it('merges adjacent siblings at their original insertion point with one reversible edit', () => {
		const editor = fixture();
		const original = editor.document;
		const plan = prepareRasterOperation(editor.document!, 'page', ['front'], 'merge_down')!;
		expect(plan.sourceIDs).toEqual(['middle', 'front']);
		expect(editor.commitRasterOperation(plan, 'media', 'Merge down')).toBe(true);
		expect(editor.activePage!.layers.map((item) => item.id)).toEqual([
			'back',
			editor.selectedLayerIDs[0]
		]);
		expect(editor.activePage!.layers[1].image?.media_id).toBe('media');
		expect(original!.pages[0].layers).toHaveLength(3);
		editor.undo();
		expect(editor.document).toEqual(original);
		expect(editor.canUndo).toBe(false);
		editor.redo();
		expect(editor.activePage!.layers).toHaveLength(2);
	});
	it('preserves a nested selection parent and leaves its other siblings editable', () => {
		const group = { ...layer('group'), type: 'group' as const, shape: undefined };
		const editor = fixture([group, layer('a', 'group'), layer('b', 'group'), layer('c', 'group')]);
		const plan = prepareRasterOperation(editor.document!, 'page', ['a', 'b'], 'merge_selected')!;
		expect(editor.commitRasterOperation(plan, 'media', 'Merge selected')).toBe(true);
		expect(editor.activePage!.layers.map((item) => item.name)).toEqual(['group', 'b', 'c']);
		expect(editor.activePage!.layers[1].parent_id).toBe('group');
	});
	it('refuses non-adjacent, locked, hidden, and backdrop-dependent selections', () => {
		const editor = fixture();
		expect(
			prepareRasterOperation(editor.document!, 'page', ['back', 'front'], 'merge_selected')
		).toBeNull();
		for (const patch of [
			{ locked: true },
			{ visible: false },
			{ effects: { blend_mode: 'multiply' as const } }
		]) {
			const editor = fixture([layer('back'), { ...layer('front'), ...patch }]);
			expect(prepareRasterOperation(editor.document!, 'page', ['front'], 'merge_down')).toBeNull();
		}
	});
	it('refuses locked descendants and stale completions after editing or changing documents', () => {
		const editor = fixture();
		const plan = prepareRasterOperation(editor.document!, 'page', ['front'], 'rasterize')!;
		editor.updateLayer('back', { name: 'Changed' });
		expect(editor.commitRasterOperation(plan, 'media', 'Rasterize')).toBe(false);
		expect(editor.activePage!.layers).toHaveLength(3);
		const group = { ...layer('group'), type: 'group' as const, shape: undefined };
		const nested = fixture([group, { ...layer('child', 'group'), locked: true }]);
		expect(prepareRasterOperation(nested.document!, 'page', ['group'], 'rasterize')).toBeNull();
	});
	it('keeps page grading outside a layer bake but includes it exactly once when flattening', () => {
		const editor = fixture();
		const grade = { ...defaultEditorColorGradeAdjustments(), exposure: 0.4 };
		editor.document!.pages[0].color_grade = grade;
		editor.document!.pages[0].color_grade_version = 1;
		const layerPlan = prepareRasterOperation(editor.document!, 'page', ['front'], 'rasterize')!;
		expect(rasterRenderDocument(layerPlan).pages[0].color_grade).toBeUndefined();
		expect(rasterRenderDocument(layerPlan).export_defaults.format).toBe('png');
		expect(rasterRenderDocument(layerPlan).pages[0].background?.type).toBe('transparent');
		const flat = prepareRasterOperation(editor.document!, 'page', [], 'flatten_page')!;
		expect(rasterRenderDocument(flat).pages[0].color_grade).toEqual(grade);
		expect(rasterRenderDocument(flat).pages[0].background_color).toBe('#ffffff');
		expect(editor.commitRasterOperation(flat, 'flat-media', 'Flatten page')).toBe(true);
		expect(editor.activePage!.background?.type).toBe('transparent');
		expect(editor.activePage!.color_grade).toBeUndefined();
		expect(editor.activePage!.layers).toHaveLength(1);
	});
});
