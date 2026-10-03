import { afterEach, expect, it, vi } from 'vitest';
import { client } from '$lib/api/client';
import { queryClient } from '$lib/query/client';
import { editorAssistantStatusOptions } from '$lib/query/editor-agent';
import { queryEditorPreferences } from './preferences';

afterEach(() => {
	queryClient.clear();
	vi.restoreAllMocks();
});

it('preserves a preferences permission failure for Query retry and recovery policy', async () => {
	const read = vi.spyOn(client, 'GET').mockResolvedValue({
		error: { detail: 'Workspace access denied' },
		response: new Response(null, { status: 403 })
	});
	await expect(queryEditorPreferences('workspace', 'project', 'video', '*')).rejects.toMatchObject({
		status: 403,
		message: 'Workspace access denied'
	});
	expect(read).toHaveBeenCalledTimes(1);
});

it('shares assistant readiness within a workspace without leaking it into another workspace', async () => {
	const read = vi
		.spyOn(client, 'GET')
		.mockResolvedValueOnce({
			data: { available: true },
			response: new Response(null, { status: 200 })
		})
		.mockResolvedValueOnce({
			data: { available: false, reason: 'No configured model' },
			response: new Response(null, { status: 200 })
		});
	const readStatus = (workspace: string) =>
		queryClient.query(editorAssistantStatusOptions(workspace, 'Assistant unavailable'));
	await expect(readStatus('first')).resolves.toEqual({ available: true });
	await expect(readStatus('first')).resolves.toEqual({ available: true });
	await expect(readStatus('second')).resolves.toEqual({
		available: false,
		reason: 'No configured model'
	});
	expect(read).toHaveBeenCalledTimes(2);
	expect(read).toHaveBeenNthCalledWith(1, '/editor-agent/assistant/status', {
		params: { query: { workspace_id: 'first' } },
		signal: expect.any(AbortSignal)
	});
	expect(read).toHaveBeenNthCalledWith(2, '/editor-agent/assistant/status', {
		params: { query: { workspace_id: 'second' } },
		signal: expect.any(AbortSignal)
	});
});
