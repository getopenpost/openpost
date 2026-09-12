import { createOpenPostQueryError, type QueryPageResult } from '@openpost/query-catalog';
import {
	captureQueryAuthorizationIdentity,
	settleQueryUnauthorized
} from './authorization-boundary';

export interface QueryTransportResponse<T, E = unknown> {
	data?: T | null;
	error?: E;
	response: Response;
}

export interface QueryGETOptions<T> {
	signal: AbortSignal;
	fallback: string;
	request: (signal: AbortSignal) => Promise<QueryTransportResponse<T>>;
}

export async function queryTransportRequest<T, E>(
	signal: AbortSignal,
	request: (signal: AbortSignal) => Promise<QueryTransportResponse<T, E>>
): Promise<QueryTransportResponse<T, E>> {
	const authorizationIdentity = captureQueryAuthorizationIdentity();
	const result = await request(signal);
	if (result.response?.status === 401) settleQueryUnauthorized(authorizationIdentity);
	return result;
}

export async function queryGET<T>({
	signal,
	fallback,
	request
}: QueryGETOptions<T>): Promise<{ data: T; response: Response }> {
	const { data, error, response } = await queryTransportRequest(signal, request);
	if (error || data === null || data === undefined) {
		throw createOpenPostQueryError(response.status, error, fallback);
	}
	return { data, response };
}

export function queryPageResult<T>(items: T[], response: Response): QueryPageResult<T> {
	const total = Number(response.headers.get('X-Total-Count') ?? 0);
	return {
		items,
		total: Number.isFinite(total) ? total : 0,
		nextCursor: response.headers.get('X-Next-Cursor') ?? ''
	};
}
