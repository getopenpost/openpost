import type {
	MediaQueryAPI,
	NormalizedMediaListFilters,
	NormalizedMemeTemplateFilters,
	NormalizedStockMediaSearch
} from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { m } from '$lib/paraglide/messages';
import { queryGET } from './transport';

type QueryTransport = Pick<typeof client, 'GET'>;

export function createMediaQueryAPI(transport: QueryTransport): MediaQueryAPI {
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
