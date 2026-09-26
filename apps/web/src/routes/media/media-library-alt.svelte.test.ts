import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { QueryClientProvider } from '@tanstack/svelte-query';
import { client } from '$lib/api/client';
import { queryClient } from '$lib/query/client';
import { workspaceCtx } from '$lib/stores/workspace.svelte';
import MediaPage from './+page.svelte';

// Component tests do not populate the SvelteKit page store, so provide its public readable contract.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$app/stores', async () => {
	const { readable } = await import('svelte/store');
	return { page: readable({ url: new URL('http://localhost/media') }) };
});

// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$app/navigation', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$app/navigation')>();
	return { ...actual, goto: vi.fn() };
});

afterEach(() => {
	queryClient.clear();
	vi.restoreAllMocks();
});

it('names video poster thumbnails with their alt text like image thumbnails', async () => {
	queryClient.clear();
	const workspace = {
		id: 'workspace-a',
		name: 'Workspace',
		avatar_url: '',
		color: '',
		can_edit: true,
		role: 'admin' as const,
		created_at: '',
		organization_id: '',
		organization_name: '',
		sso_authenticated: true,
		sso_identity_linked: true,
		sso_required: false
	};
	// Set both so loadWorkspaces skips initialize(), which would overwrite the fixture.
	workspaceCtx.workspaces = [workspace];
	workspaceCtx.currentWorkspace = workspace;
	const videoItem = {
		id: 'media-video-1',
		workspace_id: 'workspace-a',
		mime_type: 'video/mp4',
		url: '/media/media-video-1/file.mp4',
		thumbnail_url: '/media/media-video-1/poster.jpg',
		poster_thumbnail_url: null,
		original_filename: 'launch-teaser.mp4',
		alt_text: 'Launch teaser poster',
		size: 1024,
		created_at: new Date().toISOString(),
		processing_status: 'ready',
		analysis_status: 'ready',
		tags: []
	};
	const imageItem = {
		id: 'media-image-1',
		workspace_id: 'workspace-a',
		mime_type: 'image/png',
		url: '/media/media-image-1/file.png',
		thumbnail_url: '/media/media-image-1/thumb.png',
		poster_thumbnail_url: null,
		original_filename: 'launch-hero.png',
		alt_text: 'Launch hero art',
		size: 512,
		created_at: new Date().toISOString(),
		processing_status: 'ready',
		analysis_status: 'ready',
		tags: []
	};
	vi.spyOn(client, 'GET').mockImplementation(async (path) => {
		if (path === '/media') {
			return { data: { media: [videoItem, imageItem], total: 2 } } as never;
		}
		// SAFETY: All other reads in this thumbnail fixture return empty shapes.
		return { data: [] } as never;
	});
	const screen = await render(
		MediaPage,
		{},
		{ wrapper: QueryClientProvider, wrapperProps: { client: queryClient } }
	);
	await expect.element(screen.getByRole('img', { name: 'Launch hero art' })).toBeVisible();
	await expect.element(screen.getByRole('img', { name: 'Launch teaser poster' })).toBeVisible();
});

it('exposes the video processing bar as a named progressbar with its current value', async () => {
	queryClient.clear();
	const workspace = {
		id: 'workspace-a',
		name: 'Workspace',
		avatar_url: '',
		color: '',
		can_edit: true,
		role: 'admin' as const,
		created_at: '',
		organization_id: '',
		organization_name: '',
		sso_authenticated: true,
		sso_identity_linked: true,
		sso_required: false
	};
	// Set both so loadWorkspaces skips initialize(), which would overwrite the fixture.
	workspaceCtx.workspaces = [workspace];
	workspaceCtx.currentWorkspace = workspace;
	const processingItem = {
		id: 'media-video-processing',
		workspace_id: 'workspace-a',
		mime_type: 'video/mp4',
		url: '/media/media-video-processing/file.mp4',
		thumbnail_url: '/media/media-video-processing/poster.jpg',
		poster_thumbnail_url: null,
		original_filename: 'upload-clip.mp4',
		alt_text: '',
		size: 2048,
		created_at: new Date().toISOString(),
		processing_status: 'processing',
		processing_progress: 42,
		analysis_status: 'pending',
		tags: []
	};
	vi.spyOn(client, 'GET').mockImplementation(async (path) => {
		if (path === '/media') {
			return { data: { media: [processingItem], total: 1 } } as never;
		}
		// SAFETY: All other reads in this processing-bar fixture return empty shapes.
		return { data: [] } as never;
	});
	const screen = await render(
		MediaPage,
		{},
		{ wrapper: QueryClientProvider, wrapperProps: { client: queryClient } }
	);
	const bar = screen.getByRole('progressbar', { name: 'upload-clip.mp4' });
	// NOTE: visibility is not asserted here. In the vitest browser harness the Tailwind
	// v4 --spacing token is undefined, so the h-1.5 track computes to 0px and Playwright
	// reports it hidden; in production builds the token resolves and the bar is visible.
	await expect.element(bar).toHaveAttribute('aria-valuemin', '0');
	await expect.element(bar).toHaveAttribute('aria-valuemax', '100');
	await expect.element(bar).toHaveAttribute('aria-valuenow', '42');
});
