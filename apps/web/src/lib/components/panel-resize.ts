export type PanelResizeEdge = 'left' | 'right' | 'top' | 'bottom';

export function clampPanelResize(value: number, minimum: number, maximum: number): number {
	return Math.round(Math.min(maximum, Math.max(minimum, value)));
}

export function panelSizeFromPointerDelta(
	startSize: number,
	edge: PanelResizeEdge,
	deltaX: number,
	deltaY: number,
	minimum: number,
	maximum: number
): number {
	const delta =
		edge === 'right' ? deltaX : edge === 'left' ? -deltaX : edge === 'bottom' ? deltaY : -deltaY;
	return clampPanelResize(startSize + delta, minimum, maximum);
}

export function panelSizeFromArrowKey(
	value: number,
	edge: PanelResizeEdge,
	key: string,
	minimum: number,
	maximum: number,
	step = 16
): number | null {
	const vertical = edge === 'left' || edge === 'right';
	if (vertical && key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
	if (!vertical && key !== 'ArrowUp' && key !== 'ArrowDown') return null;
	const separatorDelta =
		key === 'ArrowRight' || key === 'ArrowDown'
			? step
			: key === 'ArrowLeft' || key === 'ArrowUp'
				? -step
				: null;
	if (separatorDelta === null) return null;
	const sizeDelta = edge === 'left' || edge === 'top' ? -separatorDelta : separatorDelta;
	return clampPanelResize(value + sizeDelta, minimum, maximum);
}
