import type {
	MediaQueryAPI,
	MediaMetadataItem,
	MediaMetadataResult,
	NormalizedMediaListFilters,
	NormalizedMemeTemplateFilters,
	NormalizedStockMediaSearch
} from '@openpost/query-catalog';
import { mediaMetadataQueryOptions, mediaStorageQueryOptions } from '@openpost/query-catalog';
import { applyAPIRequestHeaders, client } from '$lib/api/client';
import { m } from '$lib/paraglide/messages';
import { queryClient } from './client';
import { queryGET } from './transport';

type QueryTransport = Pick<typeof client, 'GET'>;
type RawFetch = typeof globalThis.fetch;
type MediaMetadataJSONValue =
	| string
	| number
	| boolean
	| null
	| MediaMetadataJSONValue[]
	| { [key: string]: MediaMetadataJSONValue };

export function createMediaQueryAPI(
	transport: QueryTransport,
	rawFetch: RawFetch = globalThis.fetch
): MediaQueryAPI {
	return {
		async listMedia(workspaceId, filters, signal) {
			const { data } = await queryGET({
				signal,
				fallback: m.media_load_failed(),
				request: async (requestSignal) => {
					const result = await transport.GET('/media', {
						params: { query: mediaListQuery(workspaceId, filters) },
						signal: requestSignal
					});
					return {
						...result,
						data: result.error ? undefined : (result.data ?? { media: [], total: 0 })
					};
				}
			});
			return data;
		},
		async getMediaMetadata(workspaceId, mediaIds, signal) {
			const params = new URLSearchParams({
				workspace_id: workspaceId,
				media_ids: mediaIds.join(',')
			});
			const { data } = await queryGET({
				signal,
				fallback: m.media_load_failed(),
				request: async (requestSignal) => {
					const response = await rawFetch(`/api/v1/media/metadata?${params.toString()}`, {
						credentials: 'include',
						headers: applyAPIRequestHeaders(new Headers()),
						signal: requestSignal
					});
					if (!response.ok) {
						return { response, error: await response.json().catch(() => undefined) };
					}
					// SAFETY: JSON responses contain only the recursive value types represented here;
					// parseMediaMetadataResponse validates each field before returning catalog data.
					const payload = (await response.json()) as MediaMetadataJSONValue;
					return { response, data: parseMediaMetadataResponse(payload) };
				}
			});
			return data;
		},
		async getMediaStorage(workspaceId, signal) {
			const { data } = await queryGET({
				signal,
				fallback: m.media_hub_load_failed(),
				request: (requestSignal) =>
					transport.GET('/media/storage', {
						params: { query: { workspace_id: workspaceId } },
						signal: requestSignal
					})
			});
			return data;
		},
		async listMediaTags(workspaceId, signal) {
			const { data } = await queryGET({
				signal,
				fallback: m.media_hub_load_failed(),
				request: (requestSignal) =>
					transport.GET('/media/tags', {
						params: { query: { workspace_id: workspaceId } },
						signal: requestSignal
					})
			});
			return data;
		},
		async getMediaUsage(_workspaceId, mediaId, signal) {
			const { data } = await queryGET({
				signal,
				fallback: m.media_usage_load_failed(),
				request: (requestSignal) =>
					transport.GET('/media/{id}/usage', {
						params: { path: { id: mediaId } },
						signal: requestSignal
					})
			});
			return data;
		},
		async listMemeTemplates(workspaceId, filters, signal) {
			const { data } = await queryGET({
				signal,
				fallback: m.meme_generator_templates_failed(),
				request: (requestSignal) =>
					transport.GET('/memes/templates', {
						params: {
							query: {
								workspace_id: workspaceId,
								q: optional(filters.query),
								limit: filters.limit
							}
						},
						signal: requestSignal
					})
			});
			return data;
		},
		async listStockProviders(signal) {
			const { data } = await queryGET({
				signal,
				fallback: m.stock_media_unavailable(),
				request: (requestSignal) =>
					transport.GET('/stock-media/providers', { signal: requestSignal })
			});
			return data;
		},
		async searchStockMedia(filters, signal) {
			const { data } = await queryGET({
				signal,
				fallback: m.stock_media_search_failed(),
				request: (requestSignal) =>
					transport.GET('/stock-media/search', {
						params: { query: stockSearchQuery(filters) },
						signal: requestSignal
					})
			});
			return data;
		}
	};
}

function mediaListQuery(workspaceId: string, filters: NormalizedMediaListFilters) {
	return {
		workspace_id: workspaceId,
		lifecycle: filters.lifecycle,
		filter: optional(filters.filter),
		sort: optional(filters.sort),
		search: optional(filters.search),
		type: optional(filters.type),
		source: optional(filters.source),
		asset_kind: optional(filters.assetKind),
		aspect: optional(filters.aspect),
		tag_id: optional(filters.tagId),
		tag_ids: filters.tagIds.length > 0 ? filters.tagIds.join(',') : undefined,
		untagged: filters.untagged || undefined,
		min_width: positive(filters.minWidth),
		min_height: positive(filters.minHeight),
		max_width: positive(filters.maxWidth),
		max_height: positive(filters.maxHeight),
		date_from: optional(filters.dateFrom),
		date_to: optional(filters.dateTo),
		limit: filters.limit,
		offset: filters.offset
	};
}

function stockSearchQuery(filters: NormalizedStockMediaSearch) {
	return {
		provider: filters.provider,
		query: filters.query,
		kind: filters.kind,
		orientation: optional(filters.orientation),
		size: optional(filters.size),
		color: optional(filters.color),
		locale: optional(filters.locale),
		order: optional(filters.order),
		content_filter: optional(filters.contentFilter),
		collections: optional(filters.collections),
		category: optional(filters.category),
		media_subtype: optional(filters.mediaSubtype),
		editors_choice: filters.editorsChoice || undefined,
		min_width: positive(filters.minWidth),
		min_height: positive(filters.minHeight),
		page: filters.page,
		per_page: filters.perPage
	};
}

function optional<T extends string>(value: T | ''): T | undefined {
	return value || undefined;
}

function positive(value: number): number | undefined {
	return value > 0 ? value : undefined;
}

export const mediaQueryAPI = createMediaQueryAPI(client);

export function queryMediaStorage(workspaceId: string, signal?: AbortSignal) {
	const options = mediaStorageQueryOptions(mediaQueryAPI, workspaceId);
	return runQueryWithCallerCancellation(signal, options.queryKey, () => queryClient.query(options));
}

export async function queryMediaMetadata(
	workspaceId: string,
	mediaIds: readonly string[],
	options: { force?: boolean; signal?: AbortSignal } = {}
) {
	const queryOptions = mediaMetadataQueryOptions(mediaQueryAPI, workspaceId, mediaIds);
	if (options.force) {
		await queryClient.cancelQueries({ queryKey: queryOptions.queryKey, exact: true });
		await queryClient.invalidateQueries({
			queryKey: queryOptions.queryKey,
			exact: true,
			refetchType: 'none'
		});
	}
	return runQueryWithCallerCancellation(options.signal, queryOptions.queryKey, () =>
		queryClient.query(queryOptions)
	);
}

function parseMediaMetadataResponse(value: MediaMetadataJSONValue): MediaMetadataResult {
	const media = valueFields(value).get('media');
	if (!Array.isArray(media)) return { media: [] };
	const parsed: MediaMetadataItem[] = [];
	for (const value of media) {
		const fields = valueFields(value);
		const id = stringValue(fields.get('id'));
		if (!id) continue;
		parsed.push(mediaMetadataItem(fields, id));
	}
	return { media: parsed };
}

type ParsedMediaMetadataItem = {
	-readonly [Key in keyof MediaMetadataItem]: MediaMetadataItem[Key];
};

function mediaMetadataItem(
	fields: Map<string, MediaMetadataJSONValue>,
	id: string
): MediaMetadataItem {
	const item: ParsedMediaMetadataItem = { id };
	const mimeType = stringValue(fields.get('mime_type'));
	const altText = stringValue(fields.get('alt_text'));
	const size = numberValue(fields.get('size'));
	const processingStatus = stringValue(fields.get('processing_status'));
	const processingProgress = numberValue(fields.get('processing_progress'));
	const posterThumbnailURL = stringValue(fields.get('poster_thumbnail_url'));
	const analysisStatus = stringValue(fields.get('analysis_status'));
	const analysisError = stringValue(fields.get('analysis_error'));
	if (mimeType !== undefined) item.mime_type = mimeType;
	if (altText !== undefined) item.alt_text = altText;
	if (size !== undefined) item.size = size;
	if (processingStatus !== undefined) item.processing_status = processingStatus;
	if (processingProgress !== undefined) item.processing_progress = processingProgress;
	if (posterThumbnailURL !== undefined) item.poster_thumbnail_url = posterThumbnailURL;
	if (analysisStatus !== undefined) item.analysis_status = analysisStatus;
	if (analysisError !== undefined) item.analysis_error = analysisError;
	return item;
}

function valueFields(
	value: MediaMetadataJSONValue | undefined
): Map<string, MediaMetadataJSONValue> {
	if (value === null || Array.isArray(value) || !(value instanceof Object)) return new Map();
	return new Map(Object.entries(value));
}

function stringValue(value: MediaMetadataJSONValue | undefined): string | undefined {
	return String(value) === value ? String(value) : undefined;
}

function numberValue(value: MediaMetadataJSONValue | undefined): number | undefined {
	return Number.isFinite(value) ? Number(value) : undefined;
}

function runQueryWithCallerCancellation<Result>(
	signal: AbortSignal | undefined,
	queryKey: readonly unknown[],
	run: () => Promise<Result>
): Promise<Result> {
	if (!signal) return run();
	if (signal.aborted) return Promise.reject(abortReason(signal));
	const cancel = () => void queryClient.cancelQueries({ queryKey, exact: true });
	signal.addEventListener('abort', cancel, { once: true });
	return run().finally(() => signal.removeEventListener('abort', cancel));
}

function abortReason(signal: AbortSignal): Error {
	return signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
}
