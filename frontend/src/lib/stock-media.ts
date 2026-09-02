import { client } from '$lib/api/client';
import type { components } from '$lib/api/types';
import { stockProvidersQueryOptions, stockSearchQueryOptions } from '@openpost/query-catalog';
import { mediaQueryAPI } from '$lib/query/media';
import { queryClient } from '$lib/query/client';

export type StockProvider = components['schemas']['StockProviderResponse'];
export type StockSearchPage = components['schemas']['SearchPage'];
export type StockAsset = components['schemas']['Asset'];
export type ResolvedStockAsset = components['schemas']['ResolvedAsset'];

export interface StockMediaProvenance {
	provider: string;
	external_id: string;
	source_url: string;
	creator_name: string;
	creator_url: string;
	license_name: string;
	license_url: string;
	attribution_text: string;
}

export const MAX_STOCK_PHOTO_BYTES = 100 * 1024 * 1024;
export const MAX_STOCK_VIDEO_BYTES = 512 * 1024 * 1024;

export class StockMediaDownloadError extends Error {
	constructor(readonly code: 'download-failed' | 'photo-too-large' | 'video-too-large') {
		super(code);
		this.name = 'StockMediaDownloadError';
	}
}

type StockProviderID = 'pexels' | 'unsplash' | 'pixabay';

export interface StockMediaSearchInput {
	provider: string;
	query: string;
	kind: 'photo' | 'video';
	orientation?: 'landscape' | 'portrait' | 'square';
	size?: 'small' | 'medium' | 'large';
	color?: string;
	locale?: string;
	order?: 'relevant' | 'latest' | 'popular';
	contentFilter?: 'low' | 'high';
	collections?: string;
	category?: string;
	mediaSubtype?: 'all' | 'photo' | 'illustration' | 'vector';
	editorsChoice?: boolean;
	minWidth?: number;
	minHeight?: number;
	page?: number;
	perPage?: number;
}

export async function listStockProviders(): Promise<StockProvider[]> {
	const data = await queryClient.query(stockProvidersQueryOptions(mediaQueryAPI));
	return data.providers ?? [];
}

export async function searchStockMedia(input: StockMediaSearchInput): Promise<StockSearchPage> {
	return queryClient.query(
		stockSearchQueryOptions(mediaQueryAPI, {
			provider: parseStockProviderID(input.provider),
			query: input.query,
			kind: input.kind,
			orientation: input.orientation,
			size: input.size,
			color: input.color,
			locale: input.locale,
			order: input.order,
			contentFilter: input.contentFilter,
			collections: input.collections,
			category: input.category,
			mediaSubtype: input.mediaSubtype,
			editorsChoice: input.editorsChoice,
			minWidth: input.minWidth,
			minHeight: input.minHeight,
			page: input.page,
			perPage: input.perPage
		})
	);
}

export async function resolveStockAsset(
	provider: string,
	externalID: string
): Promise<ResolvedStockAsset> {
	const { data, error } = await client.POST('/stock-media/selections', {
		body: {
			provider: parseStockProviderID(provider),
			external_id: externalID
		}
	});
	if (error || !data) throw new Error(error?.detail ?? 'That stock item is no longer available.');
	return data;
}

function stockFileExtension(mimeType: string): string {
	if (mimeType === 'image/png') return 'png';
	if (mimeType === 'image/webp') return 'webp';
	if (mimeType === 'image/gif') return 'gif';
	if (mimeType === 'video/webm') return 'webm';
	if (mimeType.startsWith('video/')) return 'mp4';
	return 'jpg';
}

async function readBlobWithinLimit(response: Response, maximumBytes: number): Promise<Blob> {
	const declaredSize = Number(response.headers.get('content-length') ?? 0);
	if (Number.isFinite(declaredSize) && declaredSize > maximumBytes) {
		throw new RangeError('too-large');
	}
	if (!response.body) {
		const blob = await response.blob();
		if (blob.size > maximumBytes) throw new RangeError('too-large');
		return blob;
	}
	const reader = response.body.getReader();
	const chunks: ArrayBuffer[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			total += value.byteLength;
			if (total > maximumBytes) throw new RangeError('too-large');
			const copy = new Uint8Array(value.byteLength);
			copy.set(value);
			chunks.push(copy.buffer);
		}
	} catch (error) {
		await reader.cancel().catch(() => undefined);
		throw error;
	}
	return new Blob(chunks, { type: response.headers.get('content-type') ?? '' });
}

export async function downloadStockAsset(
	asset: StockAsset,
	resolved: ResolvedStockAsset,
	fetcher: typeof fetch = fetch
): Promise<File> {
	const isVideo = resolved.mime_type.startsWith('video/');
	const maximumBytes = isVideo ? MAX_STOCK_VIDEO_BYTES : MAX_STOCK_PHOTO_BYTES;
	try {
		const response = await fetcher(resolved.download_url, {
			mode: 'cors',
			credentials: 'omit',
			referrerPolicy: 'no-referrer'
		});
		if (!response.ok) throw new StockMediaDownloadError('download-failed');
		const blob = await readBlobWithinLimit(response, maximumBytes);
		return new File(
			[blob],
			`${asset.provider}-${asset.external_id.replaceAll(':', '-')}.${stockFileExtension(resolved.mime_type)}`,
			{ type: resolved.mime_type, lastModified: Date.now() }
		);
	} catch (error) {
		if (error instanceof StockMediaDownloadError) throw error;
		if (error instanceof RangeError) {
			throw new StockMediaDownloadError(isVideo ? 'video-too-large' : 'photo-too-large');
		}
		throw new StockMediaDownloadError('download-failed');
	}
}

function parseStockProviderID(provider: string): StockProviderID {
	if (provider === 'pexels' || provider === 'unsplash' || provider === 'pixabay') return provider;
	throw new Error('Unsupported stock media provider.');
}
