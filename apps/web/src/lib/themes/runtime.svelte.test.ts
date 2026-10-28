import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveBuiltInTheme } from '@openpost/ui/themes/builtins.js';
import {
	WebThemeRuntime,
	browserThemeRuntimeLoaders,
	createBrowserThemeRuntimeLoaders,
	type ThemeRuntimeLoaders
} from '@openpost/ui/themes/runtime.js';

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
		const color = 'oklch(0.2 0.1 40)';
		const existing = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
		const originalContent = existing?.content;
		// The shipped default adapter targets the runner document. Prove that entry
		// point and its restoration, then leave no runner-document mutation behind.
		const restore = browserThemeRuntimeLoaders.setBrowserSurface(color);
		try {
			const themed = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
			expect(themed?.content).toBe(color);
			if (existing) expect(themed).toBe(existing);
			else expect(themed).not.toBeNull();
		} finally {
			restore();
		}
		expect(document.querySelector('meta[name="theme-color"]')).toBe(existing);
		expect(existing?.content).toBe(originalContent);

		const ownedDocument = document.implementation.createHTMLDocument('owned meta');
		const owner = ownedDocument.createElement('meta');
		owner.name = 'theme-color';
		owner.content = 'oklch(0.1 0 0)';
		ownedDocument.head.append(owner);

		const owned = createBrowserThemeRuntimeLoaders(ownedDocument).setBrowserSurface(color);
		expect(ownedDocument.querySelector('meta[name="theme-color"]')).toBe(owner);
		expect(owner.content).toBe(color);
		owned();
		expect(ownedDocument.querySelector('meta[name="theme-color"]')).toBe(owner);
		expect(owner.content).toBe('oklch(0.1 0 0)');
		// Restoring twice must not remove or rewrite the element it already restored.
		owned();
		expect(ownedDocument.querySelector('meta[name="theme-color"]')).toBe(owner);
		expect(owner.content).toBe('oklch(0.1 0 0)');

		const absentDocument = document.implementation.createHTMLDocument('absent meta');
		const created = createBrowserThemeRuntimeLoaders(absentDocument).setBrowserSurface(color);
		expect(absentDocument.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe(
			color
		);
		created();
		expect(absentDocument.querySelector('meta[name="theme-color"]')).toBeNull();
		created();
		expect(absentDocument.querySelector('meta[name="theme-color"]')).toBeNull();

		const changedDocument = document.implementation.createHTMLDocument('changed meta');
		const changed = changedDocument.createElement('meta');
		changed.name = 'theme-color';
		changed.content = 'oklch(0.1 0 0)';
		changedDocument.head.append(changed);
		const guard = createBrowserThemeRuntimeLoaders(changedDocument).setBrowserSurface(color);
		changed.content = 'oklch(0.4 0 0)';
		// Ownership was lost once another writer changed the value, so teardown
		// must leave that external content alone.
		guard();
		expect(changedDocument.querySelector('meta[name="theme-color"]')).toBe(changed);
		expect(changed.content).toBe('oklch(0.4 0 0)');

		expect(document.querySelector('meta[name="theme-color"]')).toBe(existing);
		expect(existing?.content).toBe(originalContent);
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
