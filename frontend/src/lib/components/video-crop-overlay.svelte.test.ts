import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import VideoCropOverlay from './video-crop-overlay.svelte';

describe('VideoCropOverlay', () => {
	it('keeps the editor move handle outside the selected theme pack', async () => {
		const screen = await render(VideoCropOverlay, {
			sourceWidth: 1920,
			sourceHeight: 1080,
			crop: { x: 160, y: 90, width: 1280, height: 720 },
			label: 'Move crop',
			onChange: vi.fn()
		});

		const handle = screen.getByRole('button', { name: 'Move crop' });
		await expect.element(handle).toBeVisible();
		const icon = handle.element().querySelector('[data-protected-icon="editor-move"]');
		expect(icon).not.toBeNull();
		expect(icon?.getAttribute('data-theme-icon')).toBeNull();
		expect(icon?.getAttribute('data-icon-pack')).toBeNull();
	});
});
