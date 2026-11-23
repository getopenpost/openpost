/** Versioned drag payload for LottieFiles animations not yet in the media pool. */

import type { LottieFilesAnimation } from './lottiefiles-api';

export const LOTTIE_DRAG_MIME = 'application/x-openpost-lottie-v1';

/** Minimal transfer surface so drag sources stay testable without DOM fixtures. */
export interface LottieDataTransfer {
	effectAllowed: DataTransfer['effectAllowed'];
	setData(format: string, data: string): void;
	getData(format: string): string;
}

const LOTTIE_DRAG_VERSION = 1;

export interface LottieDragData {
	version: typeof LOTTIE_DRAG_VERSION;
	id: string;
	label: string;
	url: string;
}

let activeLottieDrag: LottieDragData | null = null;
let activeLottieAnimation: LottieFilesAnimation | null = null;

function isLottieDragData(value: unknown): value is LottieDragData {
	if (!value || typeof value !== 'object') return false;
	// SAFETY: the object guard above makes optional property reads safe; every field is checked below.
	const candidate = value as Partial<LottieDragData>;
	return (
		candidate.version === LOTTIE_DRAG_VERSION &&
		typeof candidate.id === 'string' &&
		candidate.id.length > 0 &&
		typeof candidate.label === 'string' &&
		candidate.label.length > 0 &&
		typeof candidate.url === 'string' &&
		candidate.url.startsWith('https://')
	);
}

function parseLottieDragData(raw: string): LottieDragData | null {
	if (!raw) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		return isLottieDragData(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export function writeLottieDragData(
	dataTransfer: LottieDataTransfer,
	animation: LottieFilesAnimation
): void {
	activeLottieDrag = {
		version: LOTTIE_DRAG_VERSION,
		id: animation.id,
		label: animation.name,
		url: animation.lottieUrl
	};
	activeLottieAnimation = animation;
	dataTransfer.effectAllowed = 'copy';
	dataTransfer.setData(LOTTIE_DRAG_MIME, JSON.stringify(activeLottieDrag));
}

export function getLottieDragData(dataTransfer?: LottieDataTransfer | null): LottieDragData | null {
	const transferred = dataTransfer?.getData(LOTTIE_DRAG_MIME);
	return parseLottieDragData(transferred ?? '') ?? activeLottieDrag;
}

/** Same-document fast path: the dragged animation with full attribution metadata. */
export function getActiveLottieAnimation(id: string): LottieFilesAnimation | null {
	return activeLottieAnimation?.id === id ? activeLottieAnimation : null;
}

export function clearLottieDragData(): void {
	activeLottieDrag = null;
	activeLottieAnimation = null;
}
