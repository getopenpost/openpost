import type { components } from '@openpost/api-contract';
import {
	createOpenPostQueryError,
	repurposeQueryKeys,
	repurposeSuggestionsQueryOptions,
	runWithCallerAbort,
	type RepurposeSuggestions
} from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { m } from '$lib/paraglide/messages';
import { queryClient } from './client';
import { queryGET } from './transport';
import { captureQueryMutationSession, settleQueryMutationSession } from './authorization-boundary';

export type RepurposeRequest = components['schemas']['SuggestionRequest'];
export type RepurposeCandidate = components['schemas']['ClipCandidate'];
export type { RepurposeSuggestions };

function seed(workspaceId: string, actorId: string, result: RepurposeSuggestions) {
	queryClient.setQueryData(repurposeQueryKeys.detail(workspaceId, actorId, result.id), result);
	return result;
}

export async function requestRepurposeSuggestions(
	request: RepurposeRequest,
	actorId: string,
	requestId: string
) {
	const session = captureQueryMutationSession();
	const { data, error, response } = await client.POST('/repurpose-suggestions', {
		params: { header: { 'Idempotency-Key': requestId } },
		body: request
	});
	if (!settleQueryMutationSession(session, response))
		throw new DOMException('The signed-in account changed.', 'AbortError');
	if (error || !data) throw createOpenPostQueryError(response.status, error, m.repurpose_failed());
	return seed(request.workspace_id, actorId, data);
}

export async function readRepurposeSuggestions(
	workspaceId: string,
	actorId: string,
	id: string,
	signal: AbortSignal
) {
	const options = repurposeSuggestionsQueryOptions(
		{
			async getSuggestions(id, signal) {
				const { data } = await queryGET({
					signal,
					fallback: m.repurpose_failed(),
					request: (signal) =>
						client.GET('/repurpose-suggestions/{id}', {
							params: { path: { id } },
							signal
						})
				});
				return data;
			}
		},
		workspaceId,
		actorId,
		id
	);
	return runWithCallerAbort(signal, () => queryClient.fetchQuery({ ...options, staleTime: 0 }));
}

export async function changeRepurposeSuggestions(
	workspaceId: string,
	actorId: string,
	result: RepurposeSuggestions,
	action: 'cancel' | 'retry'
) {
	const session = captureQueryMutationSession();
	const { data, error, response } = await client.POST(
		action === 'cancel'
			? '/repurpose-suggestions/{id}/cancel'
			: '/repurpose-suggestions/{id}/retry',
		{
			params: { path: { id: result.id } },
			body: { revision: result.revision }
		}
	);
	if (!settleQueryMutationSession(session, response))
		throw new DOMException('The signed-in account changed.', 'AbortError');
	if (error || !data) throw createOpenPostQueryError(response.status, error, m.repurpose_failed());
	return seed(workspaceId, actorId, data);
}
