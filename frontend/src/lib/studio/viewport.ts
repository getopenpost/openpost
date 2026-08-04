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
