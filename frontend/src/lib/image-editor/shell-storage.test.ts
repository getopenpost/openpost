import { describe, expect, it } from 'vitest';
import {
	parseImageEditorClipboardLayers,
	parseImageEditorExportResumeLedger,
	parseImageEditorLayoutPreferences,
	parseImageEditorRecentColors,
	parseImageEditorTabMessage,
	parseImageEditorToolPreferences,
	parseImageEditorViewPreferences
} from './shell-storage';
import type { ImageEditorDocument, ImageEditorPage } from './types';

function documentFixture(): ImageEditorDocument {
	const page: ImageEditorPage = {
		id: 'page-1',
		name: 'Page 1',
		background_color: '#ffffff',
		layers: []
	};
	return {
		schema_version: 1,
		title: 'Clipboard fixture',
		preset_key: 'square',
		width_px: 1080,
		height_px: 1080,
		brand_kit_revision: 0,
		export_defaults: { format: 'png', quality: 0.9, matte_color: '#ffffff' },
		pages: [page]
	};
}

describe('image editor shell storage boundaries', () => {
	it('normalizes tool preferences without coercing invalid values', () => {
		expect(
			parseImageEditorToolPreferences(
				JSON.stringify({
					selectionMode: 'add',
					magicSelectTolerance: 42,
					magicSelectContiguous: true,
					pencilSize: '18',
					gradientType: 'diamond'
				})
			)
		).toMatchObject({
			selectionMode: 'add',
			magicSelectTolerance: 42,
			magicSelectContiguous: true,
			pencilSize: undefined,
			gradientType: 'diamond'
		});
	});

	it('parses layout and view values through their owned contracts', () => {
		expect(parseImageEditorLayoutPreferences('{"assets":320,"layers":"200","pages":184}')).toEqual({
			assets: 320,
			inspector: undefined,
			layers: undefined,
			pages: 184
		});
		expect(
			parseImageEditorViewPreferences('{"snapping":false,"gridSize":25,"grid":"true"}')
		).toEqual({
			snapping: false,
			rulers: undefined,
			guides: undefined,
			grid: undefined,
			snapToGrid: undefined,
			gridSize: 25
		});
	});

	it('drops malformed recent colors and export entries', () => {
		expect(parseImageEditorRecentColors('["#fff",12,"#000"]')).toEqual(['#fff', '#000']);
		expect(
			parseImageEditorExportResumeLedger(
				'{"page-1":{"mediaID":"media-1","fingerprint":"abc"},"page-2":{"mediaID":2}}'
			)
		).toEqual({ 'page-1': { mediaID: 'media-1', fingerprint: 'abc' } });
	});

	it('normalizes cross-tab messages', () => {
		expect(
			parseImageEditorTabMessage({
				tabID: 'tab-1',
				type: 'saved',
				revision: 8
			})
		).toEqual({
			tabID: 'tab-1',
			type: 'saved',
			revision: 8
		});
		expect(parseImageEditorTabMessage({ type: 'deleted', revision: '8' })).toEqual({
			tabID: undefined,
			type: undefined,
			revision: undefined
		});
	});

	it('accepts only clipboard layers that satisfy the image document contract', () => {
		const document = documentFixture();
		const layer = {
			id: 'layer-1',
			type: 'shape',
			name: 'Rectangle',
			visible: true,
			locked: false,
			opacity: 1,
			transform: {
				x: 0,
				y: 0,
				width: 100,
				height: 100,
				rotation: 0,
				flip_x: false,
				flip_y: false
			},
			shape: {
				kind: 'rectangle',
				fill: '#ffffff',
				stroke: '#000000',
				stroke_width: 0,
				radius: 0
			}
		};
		expect(
			parseImageEditorClipboardLayers(
				JSON.stringify({ version: 1, layers: [layer] }),
				document,
				document.pages[0]
			)
		).toHaveLength(1);
		expect(
			parseImageEditorClipboardLayers(
				JSON.stringify({ version: 1, layers: [{ id: 'broken' }] }),
				document,
				document.pages[0]
			)
		).toEqual([]);
	});
});
