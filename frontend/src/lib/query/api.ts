import {
	createOpenPostQueryError,
	type ActivityPublicationBucket,
	type OpenPostQueryAPI,
	type QueryPageResult
} from '@openpost/query-catalog';
import type { components } from '@openpost/api-contract';
import { client } from '$lib/api/client';

type QueryTransport = Pick<typeof client, 'GET'>;
type APIProblem = components['schemas']['ErrorModel'];

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
			const { data, error, response } = await transport.GET('/publications/{id}', {
				params: { path: { id: publicationId } },
				signal
			});
			return requiredData(data, error, response, 'Unable to load publication');
		},
		async listActivityPublications(workspaceId, bucket, page, signal) {
			const query: ActivityPublicationsQuery = {
				workspace_id: workspaceId,
				activity_bucket: bucket,
				limit: page.limit,
				offset: 0
			};
			if (page.cursor) query.cursor = page.cursor;
			const { data, error, response } = await transport.GET('/publications', {
				params: { query },
				signal
			});
			const items = requiredData(data, error, response, 'Unable to load publications');
			return pageResult(items, response);
		},
		async listFailedJobs(workspaceId, page, signal) {
			const query: FailedJobsQuery = {
				workspace_id: workspaceId,
				status: 'failed',
				limit: page.limit,
				offset: 0
			};
			if (page.cursor) query.cursor = page.cursor;
			const { data, error, response } = await transport.GET('/jobs', {
				params: { query },
				signal
			});
			if (error) throw createOpenPostQueryError(response.status, error, 'Unable to load jobs');
			return pageResult(
				(data ?? []).filter((job) => job.status === 'failed'),
				response
			);
		},
		async listAccounts(workspaceId, signal) {
			const { data, error, response } = await transport.GET('/accounts', {
				params: { query: { workspace_id: workspaceId } },
				signal
			});
			if (error) {
				throw createOpenPostQueryError(response.status, error, 'Unable to load social accounts');
			}
			return data ?? [];
		},
		async listSocialSets(workspaceId, signal) {
			const { data, error, response } = await transport.GET('/social-sets', {
				params: { query: { workspace_id: workspaceId } },
				signal
			});
			if (error)
				throw createOpenPostQueryError(response.status, error, 'Unable to load social sets');
			return data ?? [];
		},
		async getCapabilities(signal) {
			const { data, error, response } = await transport.GET('/capabilities', { signal });
			return requiredData(data, error, response, 'Unable to load capabilities');
		}
	};
}

function requiredData<T>(
	data: T | null | undefined,
	error: APIProblem | undefined,
	response: Response,
	fallback: string
): T {
	if (error || data === null || data === undefined) {
		throw createOpenPostQueryError(response.status, error, fallback);
	}
	return data;
}

function pageResult<T>(items: T[], response: Response): QueryPageResult<T> {
	const total = Number(response.headers.get('X-Total-Count') ?? 0);
	return {
		items,
		total: Number.isFinite(total) ? total : 0,
		nextCursor: response.headers.get('X-Next-Cursor') ?? ''
	};
}

export const queryAPI = createOpenPostQueryAPI(client);
