import { describe, expect, it, vi } from 'vitest';
import { createAppBootstrapQueryAPI } from './bootstrap';

describe('application bootstrap query API', () => {
	it('forwards the preferred Workspace and cancellation', async () => {
		const bootstrap = { authenticated: false, workspaces: [] };
		const GET = vi.fn().mockResolvedValue({
			data: bootstrap,
			response: new Response(null, { status: 200 })
		});
		const api = createAppBootstrapQueryAPI({ GET } as never);
		const signal = new AbortController().signal;

		await expect(api.getAppBootstrap('workspace-1', signal)).resolves.toBe(bootstrap);
		expect(GET).toHaveBeenCalledWith('/app/bootstrap', {
			params: { query: { preferred_workspace_id: 'workspace-1' } },
			signal
		});
	});
});
