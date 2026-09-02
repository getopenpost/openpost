import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { resolveBuiltInTheme } from '$lib/themes';
import ThemePreview, { THEME_PREVIEW_SCENES } from './theme-preview.svelte';
import '../../../routes/layout.css';

describe('ThemePreview', () => {
	it.each(THEME_PREVIEW_SCENES)('renders the %s product scene', async (scene) => {
		const label = `Workshop ${scene} preview`;
		const screen = render(ThemePreview, {
			theme: resolveBuiltInTheme('workshop', 'light'),
			scene,
			label
		});

		await expect.element(screen.getByTitle(label)).toBeVisible();
		await expect.element(screen.getByTestId('theme-preview')).toHaveAttribute('aria-busy', 'false');
		const frame = screen.getByTestId('theme-preview').element() as HTMLIFrameElement;
		await expect
			.poll(() =>
				frame.contentDocument
					?.querySelector('[data-preview-scene]')
					?.getAttribute('data-preview-scene')
			)
			.toBe(scene);
	});

	it('uses exact 390px and 320px phone canvases', async () => {
		const theme = resolveBuiltInTheme('playroom', 'light');
		const phone = render(ThemePreview, {
			theme,
			viewport: 'phone',
			label: '390 preview'
		});
		await expect
			.element(phone.getByTestId('theme-preview'))
			.toHaveAttribute('style', 'width: 24.375rem;');

		phone.unmount();
		const smallPhone = render(ThemePreview, {
			theme,
			viewport: 'phone-small',
			label: '320 preview'
		});
		await expect
			.element(smallPhone.getByTestId('theme-preview'))
			.toHaveAttribute('style', 'width: 20rem;');
	});

	it('keeps media-editor chrome behind the protected token boundary', async () => {
		const screen = render(ThemePreview, {
			theme: resolveBuiltInTheme('midnight', 'dark'),
			scene: 'video-editor',
			label: 'Protected video editor preview'
		});

		await expect.element(screen.getByTitle('Protected video editor preview')).toBeVisible();
		await expect.element(screen.getByTestId('theme-preview')).toHaveAttribute('aria-busy', 'false');
		const frame = screen.getByTestId('theme-preview').element() as HTMLIFrameElement;
		expect(
			frame.contentDocument?.querySelector('[data-protected-editor-chrome="video-editor"]')
		).not.toBeNull();
		expect(document.querySelector('[data-protected-editor-chrome="video-editor"]')).toBeNull();
	});
});
