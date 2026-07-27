export const STUDIO_MEDIA_DRAG_TYPE = 'application/x-openpost-studio-media';

export interface StudioMediaDragPayload {
	id: string;
	name?: string;
	width?: number;
	height?: number;
}

export function writeStudioMediaDrag(
	dataTransfer: DataTransfer,
	payload: StudioMediaDragPayload
): void {
	dataTransfer.effectAllowed = 'copy';
	dataTransfer.setData(STUDIO_MEDIA_DRAG_TYPE, JSON.stringify(payload));
	dataTransfer.setData('text/plain', payload.name || 'OpenPost media');
}

export function readStudioMediaDrag(
	dataTransfer: DataTransfer | null
): StudioMediaDragPayload | null {
	if (!dataTransfer) return null;
	const encoded = dataTransfer.getData(STUDIO_MEDIA_DRAG_TYPE);
	if (!encoded) return null;
	try {
		const payload = JSON.parse(encoded) as Partial<StudioMediaDragPayload>;
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

export function containsStudioMediaDrag(dataTransfer: DataTransfer | null): boolean {
	return Boolean(dataTransfer && [...dataTransfer.types].includes(STUDIO_MEDIA_DRAG_TYPE));
}
