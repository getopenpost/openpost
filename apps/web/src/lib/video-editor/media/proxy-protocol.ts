export const PROXY_MAX_HEIGHT = 540;
export const PROXY_BITRATE = 1_000_000;

export interface ProxyDimensions {
	width: number;
	height: number;
}

export interface ProxyRequest {
	file: Blob;
	maxHeight?: number;
}

export type ProxyWorkerResponse =
	| { type: 'progress'; progress: number }
	| { type: 'complete'; blob: Blob }
	| { type: 'error'; message: string };

/**
 * Pure sizing math: cap height at `maxHeight`, preserve aspect ratio, and
 * keep even dimensions (a codec requirement for VP9).
 */
export function proxyDimensions(
	width: number,
	height: number,
	maxHeight: number = PROXY_MAX_HEIGHT
): ProxyDimensions {
	if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
	const scale = Math.min(1, maxHeight / height);
	let nextWidth = Math.max(2, Math.round(width * scale));
	let nextHeight = Math.max(2, Math.round(height * scale));
	nextWidth -= nextWidth % 2;
	nextHeight -= nextHeight % 2;
	return { width: nextWidth, height: nextHeight };
}
