import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { switchLocale } from '$lib/i18n';
import { resolveBuiltInTheme, WebThemeRuntime, type ThemeRuntimeLoaders } from '$lib/themes';
import ThemePreview from './theme-preview.svelte';
import '../../../routes/layout.css';

function previewFrame(element: Element): HTMLIFrameElement {
	if (!(element instanceof HTMLIFrameElement))
		throw new Error('Theme preview iframe is unavailable');
	return element;
}

describe('ThemePreview', () => {
	afterEach(() => switchLocale('en', { reload: false }));

	it('stages initial resources once and only restages for a changed theme', async () => {
		const loaders: ThemeRuntimeLoaders = {
			stageFonts: vi.fn(async () => ({ release: vi.fn() })),
			loadAssets: vi.fn(async () => undefined),
			loadIconPack: vi.fn(async () => undefined),
			setBrowserSurface: vi.fn(() => vi.fn())
		};
		const runtime = new WebThemeRuntime(loaders);
		const workshop = resolveBuiltInTheme('workshop', 'light');
		const screen = render(ThemePreview, {
			theme: workshop,
			label: 'Resource staging preview',
			runtime
		});

		await expect.element(screen.getByTestId('theme-preview')).toHaveAttribute('aria-busy', 'false');
		expect(loaders.stageFonts).toHaveBeenCalledTimes(1);
		expect(loaders.loadAssets).toHaveBeenCalledTimes(1);
		expect(loaders.loadIconPack).toHaveBeenCalledTimes(1);

		await screen.rerender({ theme: workshop, label: 'Resource staging preview', runtime });
		expect(loaders.stageFonts).toHaveBeenCalledTimes(1);

		await screen.rerender({
			theme: resolveBuiltInTheme('playroom', 'light'),
			label: 'Resource staging preview',
			runtime
		});
		const frame = previewFrame(screen.getByTestId('theme-preview').element());
		await expect
			.poll(() => frame.contentDocument?.documentElement.dataset.themeId)
			.toBe('playroom');
		expect(loaders.stageFonts).toHaveBeenCalledTimes(2);
		expect(loaders.loadAssets).toHaveBeenCalledTimes(2);
		expect(loaders.loadIconPack).toHaveBeenCalledTimes(2);
	});

	it.each(['dashboard', 'composer', 'video-editor'] as const)(
		'renders the %s product scene',
		async (scene) => {
			const label = `Workshop ${scene} preview`;
			const screen = render(ThemePreview, {
				theme: resolveBuiltInTheme('workshop', 'light'),
				scene,
				label
			});

			await expect.element(screen.getByTitle(label)).toBeVisible();
			await expect
				.element(screen.getByTestId('theme-preview'))
				.toHaveAttribute('aria-busy', 'false');
			const frame = previewFrame(screen.getByTestId('theme-preview').element());
			await expect
				.poll(() =>
					frame.contentDocument
						?.querySelector('[data-preview-scene]')
						?.getAttribute('data-preview-scene')
				)
				.toBe(scene);
		}
	);

	it('keeps media-editor chrome behind the protected token boundary', async () => {
		const screen = render(ThemePreview, {
			theme: resolveBuiltInTheme('midnight', 'dark'),
			scene: 'video-editor',
			label: 'Protected video editor preview'
		});

		await expect.element(screen.getByTitle('Protected video editor preview')).toBeVisible();
		await expect.element(screen.getByTestId('theme-preview')).toHaveAttribute('aria-busy', 'false');
		const frame = previewFrame(screen.getByTestId('theme-preview').element());
		expect(
			frame.contentDocument?.querySelector('[data-protected-editor-chrome="video-editor"]')
		).not.toBeNull();
		expect(document.querySelector('[data-protected-editor-chrome="video-editor"]')).toBeNull();
	});
});
