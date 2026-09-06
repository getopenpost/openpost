import { describe, expect, it } from 'vitest';
import { imageEditorDocumentPoint, panForZoomAnchor } from './viewport';

describe('OpenPost Image Editor viewport zoom', () => {
	it('keeps the canvas point beneath the cursor fixed while zooming', () => {
		const next = panForZoomAnchor({
			panX: 20,
			panY: -10,
			zoom: 1,
			nextZoom: 2,
			anchorX: 150,
			anchorY: -80
		});

		expect(next).toEqual({ panX: -110, panY: 60 });
		expect((150 - next.panX) / 2).toBe((150 - 20) / 1);
		expect((-80 - next.panY) / 2).toBe((-80 - -10) / 1);
	});

	it('combines pinch movement with zoom around the starting midpoint', () => {
		const next = panForZoomAnchor({
			panX: 12,
			panY: 8,
			zoom: 0.5,
			nextZoom: 0.75,
			anchorX: 40,
			anchorY: 20,
			nextAnchorX: 55,
			nextAnchorY: 14
		});

		expect(next).toEqual({ panX: 13, panY: -4 });
		expect((55 - next.panX) / 0.75).toBe((40 - 12) / 0.5);
		expect((14 - next.panY) / 0.75).toBe((20 - 8) / 0.5);
	});

	it('maps the same CSS point at 200% browser zoom and high-DPI backing resolution', () => {
		const point = imageEditorDocumentPoint(
			{ x: 370, y: 280 },
			{ left: 100, top: 10, width: 540, height: 540 },
			{ width: 2160, height: 2160 }
		);
		expect(point).toEqual({ x: 1080, y: 1080 });
		expect(
			imageEditorDocumentPoint(
				{ x: 50, y: 600 },
				{ left: 100, top: 10, width: 540, height: 540 },
				{ width: 2160, height: 2160 },
				'clamp'
			)
		).toEqual({ x: 0, y: 2160 });
	});
});
