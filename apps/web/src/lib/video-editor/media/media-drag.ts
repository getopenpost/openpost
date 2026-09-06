/** Versioned internal payload for dragging project media into the timeline. */

export const VIDEO_EDITOR_MEDIA_DRAG_MIME = 'application/x-openpost-video-editor-media+json';

const MEDIA_DRAG_VERSION = 1;

export type MediaDragSource = 'media' | 'composition';

export interface MediaDragData {
	version: typeof MEDIA_DRAG_VERSION;
	source: MediaDragSource;
	id: string;
	label: string;
}

let activeMediaDrag: MediaDragData | null = null;

function isMediaDragData(value: unknown): value is MediaDragData {
	if (!value || typeof value !== 'object') return false;
	// SAFETY: the object guard above makes optional property reads safe; every field is checked below.
	const candidate = value as Partial<MediaDragData>;
	return (
		candidate.version === MEDIA_DRAG_VERSION &&
		(candidate.source === 'media' || candidate.source === 'composition') &&
		typeof candidate.id === 'string' &&
		candidate.id.length > 0 &&
		typeof candidate.label === 'string' &&
		candidate.label.length > 0
	);
}

export function mediaDragData(source: MediaDragSource, id: string, label: string): MediaDragData {
	return { version: MEDIA_DRAG_VERSION, source, id, label };
}

export function serializeMediaDragData(payload: MediaDragData): string {
	return JSON.stringify(payload);
}

export function parseMediaDragData(raw: string): MediaDragData | null {
	if (!raw) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		return isMediaDragData(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export function setActiveMediaDrag(payload: MediaDragData): void {
	activeMediaDrag = payload;
}

export function clearActiveMediaDrag(): void {
	activeMediaDrag = null;
}

export function getMediaDragData(dataTransfer?: DataTransfer | null): MediaDragData | null {
	const transferred = dataTransfer?.getData(VIDEO_EDITOR_MEDIA_DRAG_MIME);
	return parseMediaDragData(transferred ?? '') ?? activeMediaDrag;
}

export function writeMediaDragData(dataTransfer: DataTransfer, payload: MediaDragData): void {
	setActiveMediaDrag(payload);
	dataTransfer.effectAllowed = 'copy';
	dataTransfer.setData(VIDEO_EDITOR_MEDIA_DRAG_MIME, serializeMediaDragData(payload));
}
