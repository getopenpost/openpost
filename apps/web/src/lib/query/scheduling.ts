import type {
	NormalizedPublicationFilters,
	NormalizedPublicationHistoryPage,
	NormalizedPublishingOptionsInput,
	SchedulingQueryAPI,
	SchedulingPublication
} from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { m } from '$lib/paraglide/messages';
import { queryGET } from './transport';

type QueryTransport = Pick<typeof client, 'GET'>;

export function createSchedulingQueryAPI(transport: QueryTransport): SchedulingQueryAPI {
	return {
		async listPublications(workspaceId, filters, signal) {
			const publications: SchedulingPublication[] = [];
			let offset = 0;
			while (true) {
				const { data, response } = await queryGET({
					signal,
					fallback: m.day_posts_load_failed(),
					request: async (requestSignal) => {
						const result = await transport.GET('/publications', {
							params: { query: publicationQuery(workspaceId, filters, offset) },
							signal: requestSignal
						});
						return { ...result, data: result.error ? undefined : (result.data ?? []) };
					}
				});
				publications.push(...data);
				if (!filters.allPages) break;
				if (response.headers.get('X-Has-More') !== 'true') break;
				const nextOffset = Number(response.headers.get('X-Next-Offset') ?? offset + filters.limit);
				if (!Number.isFinite(nextOffset) || nextOffset <= offset) break;
				offset = nextOffset;
				signal.throwIfAborted();
			}
			return publications;
		},
		async listPublicationEvents(_workspaceId, publicationId, page, signal) {
			const { data, response } = await queryGET({
				signal,
				fallback: m.activity_failed_load(),
				request: async (requestSignal) => {
					const result = await transport.GET('/publications/{id}/events', {
						params: {
							path: { id: publicationId },
							query: { limit: page.limit, cursor: page.cursor || undefined }
						},
						signal: requestSignal
					});
					return { ...result, data: result.error ? undefined : (result.data ?? []) };
				}
			});
			return { items: data, nextCursor: response.headers.get('X-Next-Cursor') ?? '' };
		},
		async listPostingSchedules(workspaceId, signal) {
			const { data } = await queryGET({
				signal,
				fallback: m.settings_schedule_load_failed(),
				request: async (requestSignal) => {
					const result = await transport.GET('/posting-schedules', {
						params: { query: { workspace_id: workspaceId } },
						signal: requestSignal
					});
					return { ...result, data: result.error ? undefined : (result.data ?? []) };
				}
			});
			return data;
		},
		async getRepostAutomation(workspaceId, signal) {
			const { data } = await queryGET({
				signal,
				fallback: m.repost_load_failed(),
				request: (requestSignal) =>
					transport.GET('/repost-automation', {
						params: { query: { workspace_id: workspaceId } },
						signal: requestSignal
					})
			});
			return data;
		},
		async getPublishingOptions(_workspaceId, input, signal) {
			const { data } = await queryGET({
				signal,
				fallback: m.compose_load_provider_options_failed(),
				request: (requestSignal) =>
					transport.GET('/accounts/{account_id}/publishing-options/{source}', {
						params: {
							path: { account_id: input.accountId, source: input.source },
							query: publishingOptionsQuery(input)
						},
						signal: requestSignal
					})
			});
			return data;
		}
	};
}

function publicationQuery(
	workspaceId: string,
	filters: NormalizedPublicationFilters,
	offset: number
) {
	return {
		workspace_id: workspaceId,
		status: filters.status || undefined,
		content_profile: filters.contentProfile || undefined,
		platform: filters.platform || undefined,
		search: filters.search || undefined,
		created_from: filters.createdFrom || undefined,
		created_before: filters.createdBefore || undefined,
		calendar_from: filters.calendarFrom || undefined,
		calendar_before: filters.calendarBefore || undefined,
		limit: filters.limit,
		offset
	};
}

function publishingOptionsQuery(input: NormalizedPublishingOptionsInput) {
	return {
		region: input.region,
		locale: input.locale,
		limit: input.limit,
		search: input.search,
		cursor: input.cursor,
		context: input.context
	};
}

export const schedulingQueryAPI = createSchedulingQueryAPI(client);
