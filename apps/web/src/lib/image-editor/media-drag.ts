export const IMAGE_EDITOR_MEDIA_DRAG_TYPE = 'application/x-openpost-image-editor-media';

export interface ImageEditorMediaDragPayload {
	id: string;
	name?: string;
	width?: number;
	height?: number;
}

export interface ImageEditorDataTransfer {
	effectAllowed: DataTransfer['effectAllowed'];
	types: readonly string[];
	files: Iterable<File>;
	setData(type: string, value: string): void;
	getData(type: string): string;
}

export function writeImageEditorMediaDrag(
	dataTransfer: ImageEditorDataTransfer,
	payload: ImageEditorMediaDragPayload
): void {
	dataTransfer.effectAllowed = 'copy';
	dataTransfer.setData(IMAGE_EDITOR_MEDIA_DRAG_TYPE, JSON.stringify(payload));
	dataTransfer.setData('text/plain', payload.name || 'OpenPost media');
}

interface RawImageEditorMediaDragPayload {
	id?: unknown;
	name?: unknown;
	width?: unknown;
	height?: unknown;
}

function parseImageEditorMediaDragPayload(
	raw: RawImageEditorMediaDragPayload
): ImageEditorMediaDragPayload | null {
	if (typeof raw.id !== 'string' || !raw.id.trim()) return null;
	const payload: ImageEditorMediaDragPayload = { id: raw.id };
	if (typeof raw.name === 'string') payload.name = raw.name;
	if (typeof raw.width === 'number' && raw.width > 0) payload.width = raw.width;
	if (typeof raw.height === 'number' && raw.height > 0) payload.height = raw.height;
	return payload;
}

export function readImageEditorMediaDrag(
	dataTransfer: ImageEditorDataTransfer | null
): ImageEditorMediaDragPayload | null {
	if (!dataTransfer) return null;
	const encoded = dataTransfer.getData(IMAGE_EDITOR_MEDIA_DRAG_TYPE);
	if (!encoded) return null;
	try {
		const parsed: unknown = JSON.parse(encoded);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
		return parseImageEditorMediaDragPayload(parsed);
	} catch {
		return null;
	}
}

export function containsImageEditorMediaDrag(
	dataTransfer: ImageEditorDataTransfer | null
): boolean {
	return Boolean(dataTransfer && [...dataTransfer.types].includes(IMAGE_EDITOR_MEDIA_DRAG_TYPE));
}

export function containsExternalImageDrag(dataTransfer: ImageEditorDataTransfer | null): boolean {
	return Boolean(
		dataTransfer &&
		!containsImageEditorMediaDrag(dataTransfer) &&
		([...dataTransfer.types].includes('Files') || externalFiles(dataTransfer).length > 0)
	);
}

export function externalFiles(dataTransfer: ImageEditorDataTransfer | null): File[] {
	if (!dataTransfer) return [];
	return [...dataTransfer.files];
}

export function externalImageFiles(dataTransfer: ImageEditorDataTransfer | null): File[] {
	return externalFiles(dataTransfer).filter(isImageEditorImageFile);
}

export function isImageEditorImageFile(file: Pick<File, 'name' | 'type'>): boolean {
	if (file.type.startsWith('image/')) return true;
	return /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(file.name);
}
