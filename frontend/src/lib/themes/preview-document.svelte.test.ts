import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveBuiltInTheme } from './builtins.js';
import { mountThemePreviewDocument } from './preview-document.js';
import { WebThemeRuntime, type ThemeRuntimeLoaders } from './runtime.js';

const frames: HTMLIFrameElement[] = [];

function isolatedRuntime() {
	const loaders: ThemeRuntimeLoaders = {
		stageFonts: vi.fn(async () => ({ release: vi.fn() })),
		loadAssets: vi.fn(async () => undefined),
		loadIconPack: vi.fn(async () => undefined),
		setBrowserSurface: vi.fn(() => vi.fn())
	};
	return { loaders, runtime: new WebThemeRuntime(loaders) };
}

afterEach(() => {
	for (const frame of frames.splice(0)) frame.remove();
});

describe('theme preview document', () => {
	it('isolates theme variables, scene content, and portal content in one iframe document', async () => {
		const hostTheme = document.documentElement.getAttribute('data-theme-id');
		const source = document.implementation.createHTMLDocument('preview styles');
		const style = source.createElement('style');
		style.textContent = '[data-preview-scene] { display: grid; }';
		source.head.append(style);
		const frame = document.createElement('iframe');
		frame.title = 'Theme preview';
		document.body.append(frame);
		frames.push(frame);

		const { loaders, runtime } = isolatedRuntime();
		const preview = await mountThemePreviewDocument(frame, { styleSource: source, runtime });

		expect(frame.getAttribute('sandbox')).toBe('allow-same-origin');
		expect(frame.referrerPolicy).toBe('no-referrer');
		expect(preview.document).toBe(frame.contentDocument);
		expect(preview.document).not.toBe(document);
		expect(preview.root.ownerDocument).toBe(preview.document);
		expect(preview.portalTarget.ownerDocument).toBe(preview.document);
		expect(preview.portalProps).toEqual({ to: preview.portalTarget });
		expect(preview.document.documentElement.dataset.themeId).toBeUndefined();
		expect(loaders.stageFonts).not.toHaveBeenCalled();
		expect(document.documentElement.getAttribute('data-theme-id')).toBe(hostTheme);
		expect(preview.document.head.textContent).toContain('[data-preview-scene]');

		expect(await preview.apply(resolveBuiltInTheme('midnight', 'dark'))).toBe(true);
		expect(preview.document.documentElement.dataset.themeId).toBe('midnight');
		expect(preview.document.documentElement.classList.contains('dark')).toBe(true);
		expect(loaders.stageFonts).toHaveBeenCalledTimes(1);
		expect(loaders.loadAssets).toHaveBeenCalledTimes(1);
		expect(loaders.loadIconPack).toHaveBeenCalledTimes(1);

		const scene = preview.document.createElement('main');
		scene.dataset.previewScene = '';
		preview.root.append(scene);
		const portal = preview.document.createElement('div');
		portal.dataset.previewPortal = '';
		preview.portalTarget.append(portal);
		expect(preview.document.querySelector('[data-preview-portal]')).toBe(portal);
		expect(document.querySelector('[data-preview-portal]')).toBeNull();

		expect(await preview.apply(resolveBuiltInTheme('playroom', 'light'))).toBe(true);
		expect(preview.document.documentElement.dataset.themeId).toBe('playroom');
		expect(preview.document.documentElement.classList.contains('dark')).toBe(false);
		preview.destroy();
		expect(preview.root.childElementCount).toBe(0);
		expect(preview.portalTarget.childElementCount).toBe(0);
		expect(await preview.apply(resolveBuiltInTheme('studio', 'light'))).toBe(false);
	});
});
