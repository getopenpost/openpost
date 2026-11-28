import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScreenshotDocument } from '@openpost/query-catalog';

const post = vi.hoisted(() => vi.fn());
vi.mock('$lib/api/client', () => ({ client: { POST: post } }));
vi.mock('$lib/stores/workspace.svelte', () => ({
	workspaceCtx: { currentWorkspace: { id: 'ws' } }
}));
vi.mock('$lib/query/client', () => ({
	queryClient: { setQueryData: vi.fn(), invalidateQueries: vi.fn() }
}));
vi.mock('$lib/query/screenshot-templates', () => ({ inScreenshotWorkspace: vi.fn() }));
vi.mock('$lib/query/authorization-boundary', () => ({
	captureQueryMutationSession: () => ({}),
	settleQueryMutationSession: () => true
}));

import { renderPostVisual, renderOptionMedia, savePostVisual } from './visuals';

const doc = {
	schema_version: 1,
	template_id: 'messages',
	title: 'T'
} as unknown as ScreenshotDocument;

beforeEach(() => post.mockReset());

describe('post visuals', () => {
	it('renders template previews on the server at scale 2', async () => {
		post.mockResolvedValue({
			data: { mime_type: 'image/jpeg', data_base64: 'QQ==', width: 200, height: 100, scale: 2 },
			response: { ok: true, status: 200 }
		});
		const visual = await renderPostVisual('ws', doc);
		expect(post).toHaveBeenCalledWith(
			'/screenshot-templates/previews',
			expect.objectContaining({
				body: { workspace_id: 'ws', document: doc, scale: 2, format: 'jpeg' }
			})
		);
		expect(visual.url).toBe('data:image/jpeg;base64,QQ==');
		expect(visual.aspectRatio).toBe(2);
	});

	it('saves through the server export without a client upload', async () => {
		post.mockImplementation(async (path: string) =>
			path === '/screenshot-templates/designs'
				? { data: { id: 'd1', revision: 3, document: doc }, response: { ok: true, status: 200 } }
				: { data: { media: { id: 'm1' } }, response: { ok: true, status: 200 } }
		);
		const media = await savePostVisual('ws', { document: doc }, '');
		expect(media.id).toBe('m1');
		expect(post).toHaveBeenLastCalledWith(
			'/screenshot-templates/designs/{id}/exports',
			expect.objectContaining({ params: { path: { id: 'd1' } }, body: { revision: 3 } })
		);
	});

	it('saves each distinct document once', async () => {
		post.mockImplementation(async (path: string) =>
			path === '/screenshot-templates/designs'
				? { data: { id: 'd1', revision: 1, document: doc }, response: { ok: true, status: 200 } }
				: { data: { media: { id: 'm1' } }, response: { ok: true, status: 200 } }
		);
		const destination = (account_id: string) => ({ account_id, media: { document: doc } });
		const rendered = await renderOptionMedia('ws', {
			destinations: [destination('a'), destination('b')]
		} as never);
		expect(rendered.map((r) => r.media_id)).toEqual(['m1', 'm1']);
		expect(post.mock.calls.filter(([p]) => p.endsWith('/exports'))).toHaveLength(1);
	});
});
