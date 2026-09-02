import type { VoiceProfileQueryAPI } from '@openpost/query-catalog';
import { runWithCallerAbort, voiceProfilesQueryOptions } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { queryClient } from './client';
import { queryGET } from './transport';

type QueryTransport = Pick<typeof client, 'GET'>;

export function createVoiceProfileQueryAPI(transport: QueryTransport): VoiceProfileQueryAPI {
	return {
		async listVoiceProfiles(workspaceId, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Could not load Voice Profiles.',
				request: async (requestSignal) => {
					const result = await transport.GET('/voice-profiles', {
						params: { query: { workspace_id: workspaceId } },
						signal: requestSignal
					});
					return {
						...result,
						data: result.error ? undefined : (result.data ?? [])
					};
				}
			});
			return data;
		}
	};
}

export const voiceProfileQueryAPI = createVoiceProfileQueryAPI(client);

export function queryVoiceProfiles(workspaceId: string, signal?: AbortSignal) {
	const options = voiceProfilesQueryOptions(voiceProfileQueryAPI, workspaceId);
	return runWithCallerAbort(signal, () => queryClient.query(options));
}
