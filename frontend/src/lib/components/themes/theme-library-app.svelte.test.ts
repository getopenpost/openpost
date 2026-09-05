import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ThemeLibraryAppTestHarness from './theme-library-app-test-harness.svelte';
import '../../../routes/layout.css';

describe('theme library application preview', () => {
	it.each([1600, 390, 320])('tests and restores the app theme at %ipx', async (width) => {
		await page.viewport(width, 900);
		const view = render(ThemeLibraryAppTestHarness);
		const root = document.documentElement;
		await expect.poll(() => root.dataset.themeId).toBe('workshop');
		const originalPrimary = getComputedStyle(root).getPropertyValue('--primary');
		await view.getByRole('button', { name: 'Test Supabase' }).click();
		await expect.poll(() => root.dataset.themeId).toBe('supabase');
		expect(root.dataset.themeScheme).toBe('dark');
		expect(getComputedStyle(root).getPropertyValue('--primary')).not.toBe(originalPrimary);
		expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
		await view.getByRole('button', { name: 'Stop testing' }).click();
		await expect.poll(() => root.dataset.themeId).toBe('workshop');
		expect(root.dataset.themeScheme).toBe('light');
		await view.getByRole('button', { name: 'Test Apple' }).click();
		await expect.poll(() => root.dataset.themeId).toBe('apple');
		expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
		await view.rerender({ showLibrary: false });
		await expect.poll(() => root.dataset.themeId).toBe('workshop');
		expect(root.dataset.themeScheme).toBe('light');
	});
});
