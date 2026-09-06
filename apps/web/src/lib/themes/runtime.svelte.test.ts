import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveBuiltInTheme } from './builtins.js';
import {
	WebThemeRuntime,
	browserThemeRuntimeLoaders,
	type ThemeRuntimeLoaders
} from './runtime.js';

const scopes: HTMLElement[] = [];

function scope(): HTMLElement {
	const element = document.createElement('section');
	document.body.append(element);
	scopes.push(element);
	return element;
}

function loaders(): ThemeRuntimeLoaders {
	return {
		stageFonts: vi.fn(async () => ({ release: vi.fn() })),
		loadAssets: vi.fn(async () => undefined),
		loadIconPack: vi.fn(async () => undefined),
		setBrowserSurface: vi.fn(() => vi.fn())
	};
}

afterEach(() => {
	for (const element of scopes.splice(0)) element.remove();
});

describe('scoped WebThemeRuntime', () => {
	it('restores the document theme-color meta element it temporarily owns', () => {
		const existing = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
		const originalContent = existing?.content;
		const restore = browserThemeRuntimeLoaders.setBrowserSurface('oklch(0.2 0.1 40)');
		const themed = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

		expect(themed?.content).toBe('oklch(0.2 0.1 40)');
		restore();
		if (existing) {
			expect(existing.content).toBe(originalContent);
		} else {
			expect(document.querySelector('meta[name="theme-color"]')).toBeNull();
		}
	});

	it('applies a complete preview without leaking variables or scheme state to the page root', async () => {
		const preview = scope();
		const originalRootTheme = document.documentElement.getAttribute('data-theme-id');
		const originalRootCanvas = document.documentElement.style.getPropertyValue('--background');
		const runtimeLoaders = loaders();
		const runtime = new WebThemeRuntime(runtimeLoaders);

		expect(await runtime.applyScoped(resolveBuiltInTheme('midnight', 'dark'), preview)).toBe(true);
		expect(preview.dataset.themeId).toBe('midnight');
		expect(preview.dataset.themeScope).toBe('preview');
		expect(preview.classList.contains('dark')).toBe(true);
		expect(preview.style.getPropertyValue('--background')).toBe('oklch(0.105 0.008 265)');
		expect(preview.style.getPropertyValue('--timeline-playhead')).toBe('oklch(0.72 0.16 45)');
		expect(document.documentElement.getAttribute('data-theme-id')).toBe(originalRootTheme);
		expect(document.documentElement.style.getPropertyValue('--background')).toBe(
			originalRootCanvas
		);
		expect(runtimeLoaders.setBrowserSurface).not.toHaveBeenCalled();
	});

	it('clears only the variables and metadata owned by the preview runtime', async () => {
		const preview = scope();
		preview.style.setProperty('--host-owned', 'keep');
		preview.setAttribute('data-host-owned', 'keep');
		const runtime = new WebThemeRuntime(loaders());

		await runtime.applyScoped(resolveBuiltInTheme('corkboard', 'light'), preview);
		runtime.clear(preview);

		expect(preview.style.getPropertyValue('--background')).toBe('');
		expect(preview.getAttribute('data-theme-id')).toBeNull();
		expect(preview.style.getPropertyValue('--host-owned')).toBe('keep');
		expect(preview.getAttribute('data-host-owned')).toBe('keep');
		expect(preview.classList.contains('dark')).toBe(false);
	});

	it('restores an existing dark class after a temporary light preview is cleared', async () => {
		const preview = scope();
		preview.classList.add('dark');
		const runtime = new WebThemeRuntime(loaders());

		await runtime.applyScoped(resolveBuiltInTheme('studio', 'light'), preview);
		expect(preview.classList.contains('dark')).toBe(false);
		runtime.clear(preview);

		expect(preview.classList.contains('dark')).toBe(true);
	});

	it('removes a dark class owned by the runtime when a dark preview is cleared', async () => {
		const preview = scope();
		const runtime = new WebThemeRuntime(loaders());

		await runtime.applyScoped(resolveBuiltInTheme('midnight', 'dark'), preview);
		expect(preview.classList.contains('dark')).toBe(true);
		runtime.clear(preview);

		expect(preview.classList.contains('dark')).toBe(false);
	});
});
