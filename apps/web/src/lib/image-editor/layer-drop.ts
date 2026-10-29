import type { ImageEditorLayer } from './types';

export type ImageEditorLayerDropPosition = 'above' | 'below' | 'inside';

export interface ImageEditorLayerDropRow {
	layer: Pick<ImageEditorLayer, 'id' | 'type'>;
	depth: number;
}

/** Resolve the row that should show the drop line for a layer-tree target. */
export function imageEditorLayerDropIndicator(
	rows: readonly ImageEditorLayerDropRow[],
	targetID: string,
	position: ImageEditorLayerDropPosition,
	draggingID: string
): { id: string; position: ImageEditorLayerDropPosition } | null {
	if (!targetID || targetID === draggingID) return null;
	const targetIndex = rows.findIndex((row) => row.layer.id === targetID);
	if (targetIndex < 0) return null;
	let indicatorIndex = targetIndex;
	if (position === 'below' && rows[targetIndex]?.layer.type === 'group') {
		while (rows[indicatorIndex + 1] && rows[indicatorIndex + 1]!.depth > rows[targetIndex]!.depth)
			indicatorIndex += 1;
	}
	return { id: rows[indicatorIndex]!.layer.id, position };
}
