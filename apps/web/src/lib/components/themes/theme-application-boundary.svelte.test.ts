import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { resolveBuiltInTheme, WebThemeRuntime, type ThemeRuntimeLoaders } from '$lib/themes';
import ThemeApplicationBoundary from './theme-application-boundary.svelte';

const loaders: ThemeRuntimeLoaders = {
	stageFonts: async () => ({ release: () => undefined }),
	loadAssets: async () => undefined,
	loadIconPack: async () => undefined,
	setBrowserSurface: () => () => undefined
};

function runtime() {
	return new WebThemeRuntime(loaders);
}

describe('application theme boundary', () => {
	it('activates one complete theme and clears it outside authenticated app routes', async () => {
		const root = document.documentElement;
		const view = render(ThemeApplicationBoundary, {
			active: false,
			runtime: runtime(),
			scheme: 'light',
			theme: null
		});

		expect(root.dataset.themeId).toBeUndefined();

		await view.rerender({
			active: true,
			scheme: 'light',
			theme: resolveBuiltInTheme('studio', 'light')
		});
		await expect.poll(() => root.dataset.themeId).toBe('studio');
		expect(root.dataset.themeScheme).toBe('light');
		expect(root.dataset.themeScope).toBe('application');

		await view.rerender({ active: false, scheme: 'light', theme: null });
		await expect.poll(() => root.dataset.themeId).toBeUndefined();
		expect(root.style.getPropertyValue('--theme-color-canvas')).toBe('');
	});

	it('uses a complete Workshop fallback while a workspace theme is unavailable', async () => {
		const root = document.documentElement;
		const view = render(ThemeApplicationBoundary, {
			active: true,
			runtime: runtime(),
			scheme: 'dark',
			theme: null
		});

		await expect.poll(() => root.dataset.themeId).toBe('workshop');
		expect(root.dataset.themeScheme).toBe('dark');
		expect(root.dataset.themeSource).toBe('fallback');
		expect(root.dataset.themeFallback).toBe('missing-theme');

		view.unmount();
		await expect.poll(() => root.dataset.themeId).toBeUndefined();
	});
});
