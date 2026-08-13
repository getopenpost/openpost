import { describe, expect, it } from 'vitest';
import { blankImageEditorDocument } from './document';
import { imageEditorRevisionHasChanges, summarizeImageEditorRevision } from './revision-summary';

describe('OpenPost Image Editor revision summaries', () => {
	it('reports directional page, layer, canvas, and guide changes', () => {
		const current = blankImageEditorDocument({
			key: 'instagram-square',
			name: 'Square',
			width_px: 1080,
			height_px: 1080,
			default_format: 'png',
			profiles: []
		});
		current.title = 'Current';
		current.pages[0]!.guides = { horizontal: [100], vertical: [] };
		current.pages[0]!.layers.push({
			id: 'removed-layer',
			type: 'shape',
			name: 'Removed',
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
				fill: '#000000',
				stroke: '#000000',
				stroke_width: 0,
				radius: 0
			}
		});
		const target = structuredClone(current);
		target.title = 'Target';
		target.width_px = 1200;
		target.pages[0]!.guides = { horizontal: [120], vertical: [200] };
		target.pages[0]!.layers = [];
		target.pages.push({
			...structuredClone(target.pages[0]!),
			id: 'added-page',
			name: 'Added',
			guides: undefined,
			layers: []
		});

		expect(summarizeImageEditorRevision(current, target)).toMatchObject({
			titleChanged: true,
			canvasChanged: true,
			pagesAdded: 1,
			pagesRemoved: 0,
			layersRemoved: 1,
			guidePagesChanged: 1
		});
	});

	it('recognizes an identical document', () => {
		const current = blankImageEditorDocument({
			key: 'instagram-square',
			name: 'Square',
			width_px: 1080,
			height_px: 1080,
			default_format: 'png',
			profiles: []
		});
		expect(imageEditorRevisionHasChanges(summarizeImageEditorRevision(current, current))).toBe(
			false
		);
	});

	it('keeps a cover-only revision restorable', () => {
		const current = blankImageEditorDocument({
			key: 'instagram-square',
			name: 'Square',
			width_px: 1080,
			height_px: 1080,
			default_format: 'png',
			profiles: []
		});
		const summary = summarizeImageEditorRevision(current, current, {
			currentCoverPreviewMediaID: 'current-cover',
			targetCoverPreviewMediaID: 'target-cover'
		});
		expect(summary.coverChanged).toBe(true);
		expect(imageEditorRevisionHasChanges(summary)).toBe(true);
	});

	it('keeps page and layer reorder-only revisions restorable', () => {
		const current = blankImageEditorDocument({
			key: 'instagram-square',
			name: 'Square',
			width_px: 1080,
			height_px: 1080,
			default_format: 'png',
			profiles: []
		});
		const firstPage = current.pages[0]!;
		firstPage.layers = [
			{
				id: 'back',
				type: 'shape',
				name: 'Back',
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
					fill: '#000000',
					stroke: '#000000',
					stroke_width: 0,
					radius: 0
				}
			},
			{
				id: 'front',
				type: 'shape',
				name: 'Front',
				visible: true,
				locked: false,
				opacity: 1,
				transform: {
					x: 10,
					y: 10,
					width: 100,
					height: 100,
					rotation: 0,
					flip_x: false,
					flip_y: false
				},
				shape: {
					kind: 'rectangle',
					fill: '#ffffff',
					stroke: '#ffffff',
					stroke_width: 0,
					radius: 0
				}
			}
		];
		current.pages.push({
			...structuredClone(firstPage),
			id: 'second-page',
			name: 'Second page'
		});
		const target = structuredClone(current);
		target.pages.reverse();
		target.pages.find((page) => page.id === firstPage.id)!.layers.reverse();

		const summary = summarizeImageEditorRevision(current, target);
		expect(summary.pagesChanged).toBe(2);
		expect(summary.layersChanged).toBe(2);
		expect(imageEditorRevisionHasChanges(summary)).toBe(true);
	});
});
