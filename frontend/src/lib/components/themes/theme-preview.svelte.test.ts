import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { resolveBuiltInTheme } from '$lib/themes';
import ThemePreview, { THEME_PREVIEW_SCENES } from './theme-preview.svelte';
import '../../../routes/layout.css';

const PHONE_VIEWPORTS = [
	{ viewport: 'phone', width: 390 },
	{ viewport: 'phone-small', width: 320 }
] as const;

function horizontalOverflow(frame: HTMLIFrameElement) {
	const previewDocument = frame.contentDocument;
	const scene = previewDocument?.querySelector<HTMLElement>('[data-preview-scene]');
	if (!previewDocument || !scene) return null;
	return {
		document:
			previewDocument.documentElement.scrollWidth - previewDocument.documentElement.clientWidth,
		scene: scene.scrollWidth - scene.clientWidth
	};
}

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

	it.each(PHONE_VIEWPORTS)(
		'keeps every scene inside an exact $width px $viewport canvas',
		async ({ viewport, width }) => {
			const theme = resolveBuiltInTheme('playroom', 'light');
			const label = `${width} preview`;
			const screen = render(ThemePreview, {
				theme,
				scene: THEME_PREVIEW_SCENES[0],
				viewport,
				label
			});
			screen.container.style.width = '280px';

			const scrollRegion = screen.getByRole('region', { name: label });
			await expect.element(scrollRegion).toHaveAttribute('tabindex', '0');
			scrollRegion.element().focus();
			expect(document.activeElement).toBe(scrollRegion.element());
			await expect
				.poll(() => scrollRegion.element().scrollWidth > scrollRegion.element().clientWidth)
				.toBe(true);

			for (const scene of THEME_PREVIEW_SCENES) {
				await screen.rerender({ theme, scene, viewport, label });
				const frame = screen.getByTestId('theme-preview').element() as HTMLIFrameElement;
				await expect
					.poll(() =>
						frame.contentDocument
							?.querySelector('[data-preview-scene]')
							?.getAttribute('data-preview-scene')
					)
					.toBe(scene);
				await expect.poll(() => Number.parseFloat(getComputedStyle(frame).width)).toBe(width);
				await expect.poll(() => horizontalOverflow(frame)).toEqual({ document: 0, scene: 0 });
			}
		}
	);

	it('keeps preview fixture labels valid and small copy readable', async () => {
		const screen = render(ThemePreview, {
			theme: resolveBuiltInTheme('workshop', 'light'),
			scene: 'composer',
			label: 'Composer accessibility preview'
		});
		await expect.element(screen.getByTestId('theme-preview')).toHaveAttribute('aria-busy', 'false');
		const frame = screen.getByTestId('theme-preview').element() as HTMLIFrameElement;

		await expect
			.poll(() => frame.contentDocument?.querySelector('[role="textbox"]'))
			.not.toBeNull();
		const document = frame.contentDocument!;
		expect(document.querySelector('label[for="preview-composer"]')).toBeNull();
		expect(document.querySelector('[role="textbox"]')?.getAttribute('aria-labelledby')).toBe(
			'preview-composer-label'
		);
		const compactText = [...document.querySelectorAll<HTMLElement>('[class*="text-["]')];
		expect(compactText.length).toBeGreaterThan(0);
		expect(
			Math.min(
				...compactText.map((element) => Number.parseFloat(getComputedStyle(element).fontSize))
			)
		).toBeGreaterThanOrEqual(11);
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
