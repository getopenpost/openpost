import type { PromptQueryAPI } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { m } from '$lib/paraglide/messages';
import { queryGET } from './transport';

type QueryTransport = Pick<typeof client, 'GET'>;

export function createPromptQueryAPI(transport: QueryTransport): PromptQueryAPI {
	return {
		async listPrompts(workspaceId, category, signal) {
			const { data } = await queryGET({
				signal,
				fallback: m.prompts_load_failed(),
				request: async (requestSignal) => {
					const result = await transport.GET('/prompts', {
						params: {
							query: {
								workspace_id: workspaceId,
								category: category || undefined
							}
						},
						signal: requestSignal
					});
					return { ...result, data: result.error ? undefined : (result.data ?? []) };
				}
			});
			return data;
		},
		async listPromptCategories(signal) {
			const { data } = await queryGET({
				signal,
				fallback: m.prompts_load_failed(),
				request: (requestSignal) => transport.GET('/prompts/categories', { signal: requestSignal })
			});
			return data.categories ?? [];
		}
	};
}

export const promptQueryAPI = createPromptQueryAPI(client);
