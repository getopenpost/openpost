/** Versioned drag payload for stock assets not yet in the media pool. */

import type { StockAsset } from '$lib/stock-media';

export const STOCK_DRAG_MIME = 'application/x-openpost-stock-v1';

/** Minimal transfer surface so drag sources stay testable without DOM fixtures. */
export interface StockDataTransfer {
	effectAllowed: DataTransfer['effectAllowed'];
	setData(format: string, data: string): void;
	getData(format: string): string;
}

const STOCK_DRAG_VERSION = 1;

export type StockDragKind = 'photo' | 'video';

export interface StockDragData {
	version: typeof STOCK_DRAG_VERSION;
	provider: string;
	externalId: string;
	label: string;
	kind: StockDragKind;
	durationSeconds?: number;
	width?: number;
	height?: number;
	author?: string;
	authorUrl?: string;
	license?: string;
	licenseUrl?: string;
}

let activeStockDrag: StockDragData | null = null;
let activeStockAsset: StockAsset | null = null;

function isStockDragData(value: unknown): value is StockDragData {
	if (!value || typeof value !== 'object') return false;
	// SAFETY: the object guard above makes optional property reads safe; every field is checked below.
	const candidate = value as Partial<StockDragData>;
	if (
		candidate.version !== STOCK_DRAG_VERSION ||
		typeof candidate.provider !== 'string' ||
		candidate.provider.length === 0 ||
		typeof candidate.externalId !== 'string' ||
		candidate.externalId.length === 0 ||
		typeof candidate.label !== 'string' ||
		candidate.label.length === 0 ||
		(candidate.kind !== 'photo' && candidate.kind !== 'video')
	) {
		return false;
	}
	return (
		(candidate.durationSeconds === undefined ||
			(typeof candidate.durationSeconds === 'number' &&
				Number.isFinite(candidate.durationSeconds) &&
				candidate.durationSeconds > 0)) &&
		(candidate.width === undefined ||
			(typeof candidate.width === 'number' && candidate.width > 0)) &&
		(candidate.height === undefined ||
			(typeof candidate.height === 'number' && candidate.height > 0)) &&
		(candidate.author === undefined || typeof candidate.author === 'string') &&
		(candidate.authorUrl === undefined || typeof candidate.authorUrl === 'string') &&
		(candidate.license === undefined || typeof candidate.license === 'string') &&
		(candidate.licenseUrl === undefined || typeof candidate.licenseUrl === 'string')
	);
}

function stockKind(asset: StockAsset): StockDragKind {
	return asset.kind === 'video' ? 'video' : 'photo';
}

function parseStockDragData(raw: string): StockDragData | null {
	if (!raw) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		return isStockDragData(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export function writeStockDragData(dataTransfer: StockDataTransfer, asset: StockAsset): void {
	activeStockDrag = {
		version: STOCK_DRAG_VERSION,
		provider: asset.provider,
		externalId: asset.external_id,
		label: asset.title || asset.kind,
		kind: stockKind(asset),
		durationSeconds: asset.duration_seconds ?? undefined,
		width: asset.width,
		height: asset.height,
		author: asset.creator_name,
		authorUrl: asset.creator_url,
		license: asset.license_name,
		licenseUrl: asset.license_url
	};
	activeStockAsset = asset;
	dataTransfer.effectAllowed = 'copy';
	dataTransfer.setData(STOCK_DRAG_MIME, JSON.stringify(activeStockDrag));
}

export function getStockDragData(dataTransfer?: StockDataTransfer | null): StockDragData | null {
	const transferred = dataTransfer?.getData(STOCK_DRAG_MIME);
	return parseStockDragData(transferred ?? '') ?? activeStockDrag;
}

/** Same-document fast path: the dragged asset without a follow-up search. */
export function getActiveStockAsset(provider: string, externalId: string): StockAsset | null {
	return activeStockAsset?.provider === provider && activeStockAsset.external_id === externalId
		? activeStockAsset
		: null;
}

export function clearStockDragData(): void {
	activeStockDrag = null;
	activeStockAsset = null;
}
