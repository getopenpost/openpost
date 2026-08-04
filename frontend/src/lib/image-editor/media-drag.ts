export const IMAGE_EDITOR_MEDIA_DRAG_TYPE = 'application/x-openpost-image-editor-media';

export interface ImageEditorMediaDragPayload {
	id: string;
	name?: string;
	width?: number;
	height?: number;
}

export function writeImageEditorMediaDrag(
	dataTransfer: DataTransfer,
	payload: ImageEditorMediaDragPayload
): void {
	dataTransfer.effectAllowed = 'copy';
	dataTransfer.setData(IMAGE_EDITOR_MEDIA_DRAG_TYPE, JSON.stringify(payload));
	dataTransfer.setData('text/plain', payload.name || 'OpenPost media');
}

export function readImageEditorMediaDrag(
	dataTransfer: DataTransfer | null
): ImageEditorMediaDragPayload | null {
	if (!dataTransfer) return null;
	const encoded = dataTransfer.getData(IMAGE_EDITOR_MEDIA_DRAG_TYPE);
	if (!encoded) return null;
	try {
		const payload = JSON.parse(encoded) as Partial<ImageEditorMediaDragPayload>;
		if (typeof payload.id !== 'string' || !payload.id.trim()) return null;
		return {
			id: payload.id,
			...(typeof payload.name === 'string' ? { name: payload.name } : {}),
			...(typeof payload.width === 'number' && payload.width > 0 ? { width: payload.width } : {}),
			...(typeof payload.height === 'number' && payload.height > 0
				? { height: payload.height }
				: {})
		};
	} catch {
		return null;
	}
}

export function containsImageEditorMediaDrag(dataTransfer: DataTransfer | null): boolean {
	return Boolean(dataTransfer && [...dataTransfer.types].includes(IMAGE_EDITOR_MEDIA_DRAG_TYPE));
}
