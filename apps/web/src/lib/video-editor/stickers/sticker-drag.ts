/** Versioned drag payload for Fluent Emoji stickers not yet in the media pool. */

import type { FluentEmojiSticker } from './fluent-emoji';

export const STICKER_DRAG_MIME = 'application/x-openpost-sticker-v1';

/** Minimal transfer surface so drag sources stay testable without DOM fixtures. */
export interface StickerDataTransfer {
	effectAllowed: DataTransfer['effectAllowed'];
	setData(format: string, data: string): void;
	getData(format: string): string;
}

const STICKER_DRAG_VERSION = 1;

export interface StickerDragData {
	version: typeof STICKER_DRAG_VERSION;
	name: string;
	label: string;
}

let activeStickerDrag: StickerDragData | null = null;
let activeSticker: FluentEmojiSticker | null = null;

function isStickerDragData(value: unknown): value is StickerDragData {
	if (!value || typeof value !== 'object') return false;
	// SAFETY: the object guard above makes optional property reads safe; every field is checked below.
	const candidate = value as Partial<StickerDragData>;
	return (
		candidate.version === STICKER_DRAG_VERSION &&
		typeof candidate.name === 'string' &&
		candidate.name.length > 0 &&
		/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate.name) &&
		typeof candidate.label === 'string' &&
		candidate.label.length > 0
	);
}

function parseStickerDragData(raw: string): StickerDragData | null {
	if (!raw) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		return isStickerDragData(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export function writeStickerDragData(
	dataTransfer: StickerDataTransfer,
	sticker: FluentEmojiSticker
): void {
	activeStickerDrag = { version: STICKER_DRAG_VERSION, name: sticker.name, label: sticker.label };
	activeSticker = sticker;
	dataTransfer.effectAllowed = 'copy';
	dataTransfer.setData(STICKER_DRAG_MIME, JSON.stringify(activeStickerDrag));
}

export function getStickerDragData(
	dataTransfer?: StickerDataTransfer | null
): StickerDragData | null {
	const transferred = dataTransfer?.getData(STICKER_DRAG_MIME);
	return parseStickerDragData(transferred ?? '') ?? activeStickerDrag;
}

/** Same-document fast path: the dragged sticker object without a catalog lookup. */
export function getActiveStickerForDrag(name: string): FluentEmojiSticker | null {
	return activeSticker?.name === name ? activeSticker : null;
}

export function clearStickerDragData(): void {
	activeStickerDrag = null;
	activeSticker = null;
}
