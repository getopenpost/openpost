import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import MediaUploadDialog from './media-upload-dialog.svelte';

describe('media upload dialog source switcher', () => {
	it('exposes the source switcher as a named group', async () => {
		const screen = await render(MediaUploadDialog, {
			props: {
				open: true,
				workspaceId: 'workspace-1',
				onUploaded: vi.fn()
			}
		});

		const sourceGroup = screen.getByRole('group', { name: m.media_source() });
		await expect.element(sourceGroup).toBeVisible();
		await expect
			.element(sourceGroup.getByRole('button', { name: m.media_upload_device() }))
			.toBeVisible();
	});
});
