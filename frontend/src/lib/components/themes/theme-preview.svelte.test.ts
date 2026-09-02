import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { switchLocale } from '$lib/i18n';
import { resolveBuiltInTheme, WebThemeRuntime, type ThemeRuntimeLoaders } from '$lib/themes';
import ThemePreview, { THEME_PREVIEW_SCENES } from './theme-preview.svelte';
import { themePreviewCopy } from './theme-preview-copy';
import '../../../routes/layout.css';

const PHONE_VIEWPORTS = [
	{ viewport: 'phone', width: 390 },
	{ viewport: 'phone-small', width: 320 }
] as const;

function previewFrame(element: Element): HTMLIFrameElement {
	if (!(element instanceof HTMLIFrameElement))
		throw new Error('Theme preview iframe is unavailable');
	return element;
}

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

	it.each(THEME_PREVIEW_SCENES)('renders the %s product scene', async (scene) => {
		const label = `Workshop ${scene} preview`;
		const screen = render(ThemePreview, {
			theme: resolveBuiltInTheme('workshop', 'light'),
			scene,
			label
		});

		await expect.element(screen.getByTitle(label)).toBeVisible();
		await expect.element(screen.getByTestId('theme-preview')).toHaveAttribute('aria-busy', 'false');
		const frame = previewFrame(screen.getByTestId('theme-preview').element());
		await expect
			.poll(() =>
				frame.contentDocument
					?.querySelector('[data-preview-scene]')
					?.getAttribute('data-preview-scene')
			)
			.toBe(scene);
	});

	it.each(PHONE_VIEWPORTS)(
		'keeps long translated copy in every scene inside an exact $width px $viewport canvas',
		async ({ viewport, width }) => {
			const theme = resolveBuiltInTheme('playroom', 'light');
			const label = `${width} preview`;
			const screen = render(ThemePreview, {
				theme,
				scene: THEME_PREVIEW_SCENES[0],
				viewport,
				label,
				locale: 'de'
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
				await screen.rerender({ theme, scene, viewport, label, locale: 'de' });
				const frame = previewFrame(screen.getByTestId('theme-preview').element());
				await expect
					.poll(() =>
						frame.contentDocument
							?.querySelector('[data-preview-scene]')
							?.getAttribute('data-preview-scene')
					)
					.toBe(scene);
				await expect.poll(() => Number.parseFloat(getComputedStyle(frame).width)).toBe(width);
				await expect.poll(() => horizontalOverflow(frame)).toEqual({ document: 0, scene: 0 });
				if (scene === 'composer') {
					const composerCopy = frame.contentDocument?.querySelector<HTMLElement>(
						'[data-preview-copy="composer-body"]'
					)?.textContent;
					expect(composerCopy?.trim().length).toBeGreaterThan(
						themePreviewCopy('en').composerBody.length
					);
				}
			}
		}
	);

	it('updates an already mounted standalone preview after the app locale changes', async () => {
		const screen = render(ThemePreview, {
			theme: resolveBuiltInTheme('workshop', 'light'),
			scene: 'dashboard',
			label: 'Locale preview'
		});
		const frame = previewFrame(screen.getByTestId('theme-preview').element());
		await expect.element(screen.getByTestId('theme-preview')).toHaveAttribute('aria-busy', 'false');
		expect(frame.contentDocument?.body.textContent).toContain(
			themePreviewCopy('en').scenes.dashboard.eyebrow
		);

		switchLocale('de', { reload: false });

		await expect
			.poll(() => frame.contentDocument?.body.textContent)
			.toContain(themePreviewCopy('de').scenes.dashboard.eyebrow);
	});

	it.each([
		['notebook', 'light', 'Source Serif 4', '28px'],
		['midnight', 'dark', 'Inter Tight', '24px']
	] as const)(
		'uses the shared shell and semantic type roles for %s',
		async (family, scheme, titleFamily, sectionGap) => {
			const theme = resolveBuiltInTheme(family, scheme);
			const screen = render(ThemePreview, {
				theme,
				scene: 'tables',
				label: `${theme.name} shell preview`
			});
			await expect
				.element(screen.getByTestId('theme-preview'))
				.toHaveAttribute('aria-busy', 'false');
			const frame = previewFrame(screen.getByTestId('theme-preview').element());
			const previewDocument = frame.contentDocument!;
			const pageContainer = previewDocument.querySelector<HTMLElement>(
				'[data-slot="page-container"]'
			)!;
			const appHeader = previewDocument.querySelector<HTMLElement>('[data-slot="app-header"]')!;
			const sidebar = previewDocument.querySelector<HTMLElement>('[data-slot="sidebar"]')!;
			const mobileNavigation = previewDocument.querySelector<HTMLElement>(
				'[data-slot="mobile-bottom-nav"]'
			)!;
			const title = previewDocument.querySelector<HTMLElement>('[data-theme-type="title"]')!;
			const metadata = previewDocument.querySelector<HTMLElement>('[data-theme-type="metadata"]')!;
			const code = previewDocument.querySelector<HTMLElement>('[data-theme-type="code"]')!;

			expect(pageContainer).not.toBeNull();
			expect(appHeader).not.toBeNull();
			expect(sidebar).not.toBeNull();
			expect(mobileNavigation).not.toBeNull();
			expect(getComputedStyle(pageContainer).gap).toBe(sectionGap);
			expect(getComputedStyle(appHeader).minHeight).toBe('56px');
			expect(getComputedStyle(sidebar).width).toContain('256px');
			expect(getComputedStyle(mobileNavigation).minHeight).toBe('72px');
			expect(getComputedStyle(title).fontFamily).toContain(titleFamily);
			expect(getComputedStyle(title).fontWeight).toBe(
				String(theme.manifest.typography.title.weight)
			);
			expect(getComputedStyle(metadata).fontSize).toBe('12px');
			expect(getComputedStyle(code).fontFamily).toContain('Geist Mono');
		}
	);

	it('keeps preview fixture labels valid and small copy readable', async () => {
		const screen = render(ThemePreview, {
			theme: resolveBuiltInTheme('workshop', 'light'),
			scene: 'composer',
			label: 'Composer accessibility preview'
		});
		await expect.element(screen.getByTestId('theme-preview')).toHaveAttribute('aria-busy', 'false');
		const frame = previewFrame(screen.getByTestId('theme-preview').element());

		await expect
			.poll(() => frame.contentDocument?.querySelector('[role="textbox"]'))
			.not.toBeNull();
		const document = frame.contentDocument!;
		expect(document.querySelector('label[for="preview-composer"]')).toBeNull();
		expect(document.querySelector('[role="textbox"]')?.getAttribute('aria-labelledby')).toBe(
			'preview-composer-label'
		);
		const compactText = [
			...document.querySelectorAll<HTMLElement>(
				'[data-theme-type="metadata"], [data-theme-type="label"]'
			)
		];
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
		const frame = previewFrame(screen.getByTestId('theme-preview').element());
		expect(
			frame.contentDocument?.querySelector('[data-protected-editor-chrome="video-editor"]')
		).not.toBeNull();
		expect(document.querySelector('[data-protected-editor-chrome="video-editor"]')).toBeNull();
	});
});
