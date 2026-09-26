import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import { uploadMediaFile } from '$lib/media-upload-client';
import MediaAcquisitionPanel from './media-acquisition-panel.svelte';

// Standalone component tests must not hit the network; stub the upload client.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$lib/media-upload-client', () => ({ uploadMediaFile: vi.fn() }));
const uploadMock = vi.mocked(uploadMediaFile);

describe('media acquisition panel upload success badge', () => {
	it('exposes the upload-complete badge as a labeled image', async () => {
		uploadMock.mockResolvedValue(
			// SAFETY: only the resolved identity matters; queue status rendering reads nothing else.
			{ id: 'media-1' } as ReturnType<typeof uploadMediaFile> extends Promise<infer T> ? T : never
		);
		const file = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' });
		const screen = await render(MediaAcquisitionPanel, {
			props: {
				mode: 'device',
				workspaceId: 'workspace-1',
				initialFiles: [file],
				onUploaded: vi.fn()
			}
		});

		await screen.getByRole('button', { name: m.media_upload_one_file_action() }).click();
		const badge = screen.getByRole('img', { name: m.media_upload_complete() });
		await expect.element(badge).toBeVisible();
	});
});
