import { type ActivityPublicationBucket, type OpenPostQueryAPI } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { queryGET, queryPageResult } from './transport';

type QueryTransport = Pick<typeof client, 'GET'>;

interface ActivityPublicationsQuery {
	workspace_id: string;
	activity_bucket: ActivityPublicationBucket;
	limit: number;
	offset: number;
	cursor?: string;
}

interface FailedJobsQuery {
	workspace_id: string;
	status: 'failed';
	limit: number;
	offset: number;
	cursor?: string;
}

export function createOpenPostQueryAPI(transport: QueryTransport): OpenPostQueryAPI {
	return {
		async getPublication(_workspaceId, publicationId, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load publication',
				request: (requestSignal) =>
					transport.GET('/publications/{id}', {
						params: { path: { id: publicationId } },
						signal: requestSignal
					})
			});
			return data;
		},
		async listActivityPublications(workspaceId, bucket, page, signal) {
			const query: ActivityPublicationsQuery = {
				workspace_id: workspaceId,
				activity_bucket: bucket,
				limit: page.limit,
				offset: 0
			};
			if (page.cursor) query.cursor = page.cursor;
			const { data, response } = await queryGET({
				signal,
				fallback: 'Unable to load publications',
				request: (requestSignal) =>
					transport.GET('/publications', {
						params: { query },
						signal: requestSignal
					})
			});
			return queryPageResult(data, response);
		},
		async listFailedJobs(workspaceId, page, signal) {
			const query: FailedJobsQuery = {
				workspace_id: workspaceId,
				status: 'failed',
				limit: page.limit,
				offset: 0
			};
			if (page.cursor) query.cursor = page.cursor;
			const { data, response } = await queryGET({
				signal,
				fallback: 'Unable to load jobs',
				request: (requestSignal) =>
					transport.GET('/jobs', {
						params: { query },
						signal: requestSignal
					})
			});
			return queryPageResult(
				data.filter((job) => job.status === 'failed'),
				response
			);
		},
		async listAccounts(workspaceId, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load social accounts',
				request: (requestSignal) =>
					transport.GET('/accounts', {
						params: { query: { workspace_id: workspaceId } },
						signal: requestSignal
					})
			});
			return data;
		},
		async listSocialSets(workspaceId, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load social sets',
				request: (requestSignal) =>
					transport.GET('/social-sets', {
						params: { query: { workspace_id: workspaceId } },
						signal: requestSignal
					})
			});
			return data;
		},
		async getCapabilities(signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load capabilities',
				request: (requestSignal) => transport.GET('/capabilities', { signal: requestSignal })
			});
			return data;
		}
	};
}

export const queryAPI = createOpenPostQueryAPI(client);
