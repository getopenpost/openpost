import { tick } from 'svelte';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { mode, setMode } from 'mode-watcher';
import ProductScreenshot from './ProductScreenshot.svelte';

type ScreenshotProps = {
	lightSrc: string;
	darkSrc: string;
	lightSrcset?: string;
	darkSrcset?: string;
	sizes?: string;
	alt: string;
	label: string;
};

const composer: ScreenshotProps = {
	lightSrc: '/assets/screenshots/main-light.webp',
	darkSrc: '/assets/screenshots/main-dark.webp',
	lightSrcset:
		'/assets/screenshots/main-light-768.webp 768w, /assets/screenshots/main-light-1536.webp 1536w, /assets/screenshots/main-light.webp 2880w',
	darkSrcset:
		'/assets/screenshots/main-dark-768.webp 768w, /assets/screenshots/main-dark-1536.webp 1536w, /assets/screenshots/main-dark.webp 2880w',
	sizes: '(max-width: 800px) calc(100vw - 32px), 1248px',
	alt: 'OpenPost composer with a draft',
	label: 'Compose'
};

async function renderAtMode(props: ScreenshotProps, theme: 'light' | 'dark') {
	setMode(theme);
	await tick();
	expect(mode.current).toBe(theme);
	const screen = await render(ProductScreenshot, props);
	const img = screen.container.querySelector('img');
	expect(img).not.toBeNull();
	return { img: img!, link: screen.container.querySelector('a')! };
}

describe('ProductScreenshot zoom source', () => {
	it('serves the dark variants to the zoomed clone in dark mode', async () => {
		const { img, link } = await renderAtMode(composer, 'dark');
		// medium-zoom clones the <img> outside of <picture>: the dark <source>
		// never applies to the clone and its HiDPI pass re-reads the img
		// srcset, so the img itself must be mode-correct (composer quirk:
		// only this tour view ships responsive srcset variants).
		expect(img.getAttribute('src')).toBe(composer.darkSrc);
		expect(img.getAttribute('srcset')).toBe(composer.darkSrcset);
		expect(img.getAttribute('data-zoom-src')).toBe(composer.darkSrc);
		expect(link.getAttribute('href')).toBe(composer.darkSrc);
	});

	it('serves the light variants in light mode', async () => {
		const { img, link } = await renderAtMode(composer, 'light');
		expect(img.getAttribute('src')).toBe(composer.lightSrc);
		expect(img.getAttribute('srcset')).toBe(composer.lightSrcset);
		expect(img.getAttribute('data-zoom-src')).toBe(composer.lightSrc);
		expect(link.getAttribute('href')).toBe(composer.lightSrc);
	});

	it('leaves views without responsive variants working in dark mode', async () => {
		const { img } = await renderAtMode(
			{
				...composer,
				lightSrcset: undefined,
				darkSrcset: undefined,
				sizes: undefined
			},
			'dark'
		);
		expect(img.getAttribute('src')).toBe(composer.darkSrc);
		expect(img.getAttribute('data-zoom-src')).toBe(composer.darkSrc);
		expect(img.hasAttribute('srcset')).toBe(false);
	});
});
