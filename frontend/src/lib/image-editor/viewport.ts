export interface ZoomAnchor {
	panX: number;
	panY: number;
	zoom: number;
	nextZoom: number;
	anchorX: number;
	anchorY: number;
	nextAnchorX?: number;
	nextAnchorY?: number;
}

export function panForZoomAnchor({
	panX,
	panY,
	zoom,
	nextZoom,
	anchorX,
	anchorY,
	nextAnchorX = anchorX,
	nextAnchorY = anchorY
}: ZoomAnchor): { panX: number; panY: number } {
	const ratio = nextZoom / Math.max(zoom, 0.01);
	return {
		panX: nextAnchorX - (anchorX - panX) * ratio,
		panY: nextAnchorY - (anchorY - panY) * ratio
	};
}

export function imageEditorDocumentPoint(
	client: { x: number; y: number },
	bounds: { left: number; top: number; width: number; height: number },
	documentSize: { width: number; height: number },
	outside: 'reject' | 'clamp' | 'allow' = 'reject'
): { x: number; y: number } | null {
	const x = ((client.x - bounds.left) / Math.max(1, bounds.width)) * documentSize.width;
	const y = ((client.y - bounds.top) / Math.max(1, bounds.height)) * documentSize.height;
	if (
		outside === 'reject' &&
		(x < 0 || y < 0 || x > documentSize.width || y > documentSize.height)
	) {
		return null;
	}
	if (outside === 'allow') return { x, y };
	return {
		x: Math.max(0, Math.min(documentSize.width, x)),
		y: Math.max(0, Math.min(documentSize.height, y))
	};
}
