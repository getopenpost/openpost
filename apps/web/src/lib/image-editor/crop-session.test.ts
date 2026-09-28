import { describe, expect, it } from 'vitest';

import { ImageEditorCropSession, resolveCropSnapAxes } from './crop-session.svelte.ts';
import { blankImageEditorDocument } from './document';
import { ImageEditorController } from './editor.svelte';
import { snapImageEditorPoint, type ImageEditorPointSnap } from './fabric-adapter';
import type { SelectionPoint } from './selection';

describe('resolveCropSnapAxes', () => {
	it('snaps both axes for moves and corner handles', () => {
		for (const rotatedSide of [false, true]) {
			expect(resolveCropSnapAxes('move', rotatedSide)).toBe('both');
			for (const handle of ['ne', 'nw', 'se', 'sw'] as const) {
				expect(resolveCropSnapAxes(handle, rotatedSide)).toBe('both');
			}
		}
	});

	it('snaps edges along their own axis, swapped past a quarter turn', () => {
		expect(resolveCropSnapAxes('e', false)).toBe('x');
		expect(resolveCropSnapAxes('w', false)).toBe('x');
		expect(resolveCropSnapAxes('n', false)).toBe('y');
		expect(resolveCropSnapAxes('s', false)).toBe('y');
		expect(resolveCropSnapAxes('e', true)).toBe('y');
		expect(resolveCropSnapAxes('w', true)).toBe('y');
		expect(resolveCropSnapAxes('n', true)).toBe('x');
		expect(resolveCropSnapAxes('s', true)).toBe('x');
	});
});

describe('crop aspect snapping', () => {
	it.each([
		{ guidesX: [754], guidesY: [746], drag: -250, size: 754, guideX: 754 },
		{ guidesX: [1004], guidesY: [], drag: 0, size: 1000, guideX: null }
	])(
		'shows only reachable guides for a fixed-ratio crop: $guidesX',
		({ guidesX, guidesY, drag, size, guideX }) => {
			const editor = new ImageEditorController();
			editor.document = blankImageEditorDocument({
				key: 'custom',
				name: 'Crop',
				width_px: 2000,
				height_px: 2000,
				default_format: 'png',
				profiles: []
			});
			editor.activePageID = editor.document.pages[0].id;
			editor.canEdit = true;
			editor.addImage({ id: 'image', width: 1000, height: 1000 });
			editor.updateSelectedTransform('x', 0);
			editor.updateSelectedTransform('y', 0);
			editor.activeTool = 'crop';
			editor.snappingEnabled = true;
			let displayed: Pick<ImageEditorPointSnap, 'guideX' | 'guideY'> = {
				guideX: null,
				guideY: null
			};
			const adapter = {
				snapDocumentPoint(point: SelectionPoint, options: { axes?: 'both' | 'x' | 'y' }) {
					const result = snapImageEditorPoint(point, guidesX, guidesY, 10, options.axes);
					displayed = result;
					return result;
				},
				clearSnappingGuides() {
					displayed = { guideX: null, guideY: null };
				},
				previewImageLayer() {}
			};
			const session = new ImageEditorCropSession({
				editor,
				adapter: () => adapter,
				documentPoint: (event) => ({ x: event.clientX, y: event.clientY }),
				capturePointer: () => {},
				announce: () => {}
			});
			// SAFETY: start/move read only these pointer fields. The capture adapter
			// is a no-op, so no DOM event target or native pointer capture is needed.
			const pointer = (position: number) =>
				({
					pointerId: 1,
					button: 0,
					clientX: position,
					clientY: position,
					preventDefault() {},
					stopPropagation() {}
				}) as PointerEvent;
			session.setAspect('1');
			session.start(pointer(0), 'se');
			session.move(pointer(drag));
			expect(session.preview?.transform.width).toBeCloseTo(size);
			expect(session.preview?.transform.height).toBeCloseTo(size);
			expect(displayed.guideX).toBe(guideX);
			expect(displayed.guideY).toBeNull();
		}
	);
});
