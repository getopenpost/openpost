import { expect, it } from 'vitest';
import { imageEditorLayerDropIndicator, type ImageEditorLayerDropRow } from './layer-drop';

const rows: ImageEditorLayerDropRow[] = [
	{ layer: { id: 'front', type: 'shape' }, depth: 0 },
	{ layer: { id: 'group', type: 'group' }, depth: 0 },
	{ layer: { id: 'child', type: 'shape' }, depth: 1 }
];

it('draws a below-group drop line under the last visible descendant', () => {
	expect(imageEditorLayerDropIndicator(rows, 'group', 'below', 'front')).toEqual({
		id: 'child',
		position: 'below'
	});
});

it('keeps above-group and inside-group indicators on the group row', () => {
	expect(imageEditorLayerDropIndicator(rows, 'group', 'above', 'front')).toEqual({
		id: 'group',
		position: 'above'
	});
	expect(imageEditorLayerDropIndicator(rows, 'group', 'inside', 'front')).toEqual({
		id: 'group',
		position: 'inside'
	});
});

it('keeps a below-group indicator on a collapsed group row', () => {
	expect(imageEditorLayerDropIndicator(rows.slice(0, 2), 'group', 'below', 'front')).toEqual({
		id: 'group',
		position: 'below'
	});
});
