import { describe, expect, it, vi } from 'vitest';
import { resolveBuiltInTheme } from './builtins.js';
import type { ThemeFontFace } from './contracts.js';
import {
	WebThemeRuntime,
	isOpaqueThemeResourceUrl,
	isSameOriginThemeResourceUrl,
	themeSchemeToCssVariables,
	type ThemeRuntimeLoaders,
	type ThemeScope
} from './runtime.js';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((finish) => {
		resolve = finish;
	});
	return { promise, resolve };
}

function fakeScope(): ThemeScope & {
	attributes: Map<string, string>;
	properties: Map<string, string>;
} {
	const attributes = new Map<string, string>();
	const properties = new Map<string, string>();
	return {
		attributes,
		properties,
		style: {
			setProperty: (name, value) => properties.set(name, value),
			removeProperty: (name) => properties.delete(name)
		},
		setAttribute: (name, value) => attributes.set(name, value),
		removeAttribute: (name) => attributes.delete(name),
		getAttribute: (name) => attributes.get(name) ?? null
	};
}

function loaders(overrides: Partial<ThemeRuntimeLoaders> = {}): ThemeRuntimeLoaders {
	return {
		loadFonts: vi.fn(async () => undefined),
		loadAssets: vi.fn(async () => undefined),
		loadIconPack: vi.fn(async () => undefined),
		setBrowserSurface: vi.fn(),
		...overrides
	};
}

describe('WebThemeRuntime', () => {
	it('accepts only same-origin opaque resource URLs', () => {
		expect(
			isSameOriginThemeResourceUrl('/api/v1/theme-assets/opaque-id', 'https://openpost.test')
		).toBe(true);
		expect(
			isSameOriginThemeResourceUrl(
				'https://openpost.test/api/v1/theme-assets/opaque-id?signature=short-lived',
				'https://openpost.test'
			)
		).toBe(true);
		expect(
			isSameOriginThemeResourceUrl('https://cdn.example/font.woff2', 'https://openpost.test')
		).toBe(false);
		expect(
			isSameOriginThemeResourceUrl('data:font/woff2;base64,AA==', 'https://openpost.test')
		).toBe(false);
	});

	it('accepts only ordinary scope or immutable workspace preview query shapes', () => {
		const assetPath = '/api/v1/theme-assets/opaque-id/content';
		expect(isOpaqueThemeResourceUrl(`${assetPath}?workspace_id=workspace-id`)).toBe(true);
		expect(isOpaqueThemeResourceUrl(`${assetPath}?organization_id=organization-id`)).toBe(true);
		expect(
			isOpaqueThemeResourceUrl(
				`${assetPath}?workspace_id=workspace-id&theme_id=theme-id&revision=2`
			)
		).toBe(true);
		for (const unsafeQuery of [
			'',
			'?workspace_id=workspace-id&theme_id=theme-id',
			'?organization_id=organization-id&theme_id=theme-id&revision=2',
			'?workspace_id=workspace-id&workspace_id=second',
			'?workspace_id=workspace-id&theme_id=theme-id&revision=0',
			'?workspace_id=workspace-id&unexpected=value'
		]) {
			expect(isOpaqueThemeResourceUrl(`${assetPath}${unsafeQuery}`), unsafeQuery).toBe(false);
		}
	});

	it('uses a distinct fallback reason for unsafe resource references', async () => {
		const scope = fakeScope();
		const runtimeLoaders = loaders();
		const runtime = new WebThemeRuntime(runtimeLoaders);
		const selected = resolveBuiltInTheme('notebook', 'light');
		selected.assets.push({
			id: 'remote-paper',
			slot: 'background-texture',
			sourceUrl: 'https://cdn.example/paper.png',
			mimeType: 'image/png'
		});

		expect(await runtime.apply(selected, scope)).toBe(true);
		expect(scope.getAttribute('data-theme-fallback')).toBe('unsafe-resource');
		expect(scope.getAttribute('data-theme-id')).toBe('workshop');
		expect(runtimeLoaders.loadAssets).toHaveBeenCalledWith([]);
	});

	it('accepts only scoped opaque raster asset routes for previews', async () => {
		const runtime = new WebThemeRuntime(loaders());
		const selected = resolveBuiltInTheme('notebook', 'light');
		selected.assets.push({
			id: 'unsafe-vector',
			slot: 'header-decoration',
			sourceUrl: '/api/v1/theme-assets/unsafe-vector/content?organization_id=organization-id',
			mimeType: 'image/svg+xml'
		});
		const scope = fakeScope();

		expect(await runtime.apply(selected, scope)).toBe(true);
		expect(scope.getAttribute('data-theme-fallback')).toBe('unsafe-resource');

		selected.assets[0] = {
			...selected.assets[0],
			sourceUrl: '/uploads/unsafe-vector.png',
			mimeType: 'image/png'
		};
		const secondScope = fakeScope();
		expect(await runtime.apply(selected, secondScope)).toBe(true);
		expect(secondScope.getAttribute('data-theme-fallback')).toBe('unsafe-resource');
	});

	it('accepts only discrete uploaded font weights from 100 through 900', async () => {
		const scope = fakeScope();
		const runtime = new WebThemeRuntime(loaders());
		const selected = resolveBuiltInTheme('notebook', 'light');
		selected.fonts.push({
			id: 'body-font',
			family: 'Organization Sans',
			sourceUrl: '/api/v1/theme-assets/opaque-id/content?organization_id=organization-id',
			format: 'woff2',
			weight: 450,
			style: 'normal',
			display: 'swap'
		});

		expect(await runtime.apply(selected, scope)).toBe(true);
		expect(scope.getAttribute('data-theme-fallback')).toBe('unsafe-resource');
	});

	it('accepts the exact immutable workspace preview resource scope', async () => {
		const runtimeLoaders = loaders();
		const scope = fakeScope();
		const runtime = new WebThemeRuntime(runtimeLoaders);
		const selected = resolveBuiltInTheme('studio', 'light');
		selected.manifest.typography.body.family = 'Organization Sans';
		const face: ThemeFontFace = {
			id: 'organization-sans-400',
			family: 'Organization Sans',
			sourceUrl:
				'/api/v1/theme-assets/organization-sans-400/content?workspace_id=workspace-id&theme_id=theme-id&revision=2',
			format: 'woff2',
			weight: 400,
			style: 'normal',
			display: 'swap'
		};
		selected.fonts.push(face);

		expect(await runtime.apply(selected, scope)).toBe(true);
		expect(scope.getAttribute('data-theme-fallback')).toBeNull();
		expect(runtimeLoaders.loadFonts).toHaveBeenCalledWith([face]);

		selected.fonts[0] = {
			...face,
			sourceUrl: `${face.sourceUrl}&extra=unbounded`
		};
		const unsafeScope = fakeScope();
		expect(await runtime.apply(selected, unsafeScope)).toBe(true);
		expect(unsafeScope.getAttribute('data-theme-fallback')).toBe('unsafe-resource');
	});

	it('rejects unapproved primary families without an uploaded face', async () => {
		const scope = fakeScope();
		const runtime = new WebThemeRuntime(loaders());
		const selected = resolveBuiltInTheme('studio', 'light');
		selected.manifest.typography.body.family = 'Remote CSS Font';

		expect(await runtime.apply(selected, scope)).toBe(true);
		expect(scope.getAttribute('data-theme-fallback')).toBe('unsafe-resource');
	});

	it('rejects duplicate single-value asset slots', async () => {
		const scope = fakeScope();
		const runtime = new WebThemeRuntime(loaders());
		const selected = resolveBuiltInTheme('notebook', 'light');
		selected.assets.push(
			{
				id: 'paper-a',
				slot: 'background-texture',
				sourceUrl: '/api/v1/theme-assets/paper-a/content?organization_id=organization-id',
				mimeType: 'image/png'
			},
			{
				id: 'paper-b',
				slot: 'background-texture',
				sourceUrl: '/api/v1/theme-assets/paper-b/content?organization_id=organization-id',
				mimeType: 'image/png'
			}
		);

		expect(await runtime.apply(selected, scope)).toBe(true);
		expect(scope.getAttribute('data-theme-fallback')).toBe('unsafe-resource');
	});

	it('loads only uploaded faces used by the active typography roles', async () => {
		const runtimeLoaders = loaders();
		const scope = fakeScope();
		const runtime = new WebThemeRuntime(runtimeLoaders);
		const selected = resolveBuiltInTheme('studio', 'light');
		selected.manifest.typography.body.family = 'Organization Sans';
		const organizationFace: ThemeFontFace = {
			id: 'organization-sans-400',
			family: 'Organization Sans',
			sourceUrl:
				'/api/v1/theme-assets/organization-sans-400/content?organization_id=organization-id',
			format: 'woff2',
			weight: 400,
			style: 'normal',
			display: 'swap'
		};
		selected.fonts.push(organizationFace, {
			...organizationFace,
			id: 'unused-serif-400',
			family: 'Unused Serif',
			sourceUrl: '/api/v1/theme-assets/unused-serif-400/content?organization_id=organization-id'
		});

		expect(await runtime.apply(selected, scope)).toBe(true);
		expect(runtimeLoaders.loadFonts).toHaveBeenCalledWith([organizationFace]);
	});

	it('keeps the current scope intact until all theme resources are ready', async () => {
		const fonts = deferred();
		const scope = fakeScope();
		scope.setAttribute('data-theme-id', 'workshop');
		scope.style.setProperty('--background', 'old-canvas');
		const runtime = new WebThemeRuntime(loaders({ loadFonts: () => fonts.promise }));
		const pending = runtime.apply(resolveBuiltInTheme('studio', 'light'), scope);

		expect(scope.getAttribute('data-theme-id')).toBe('workshop');
		expect(scope.properties.get('--background')).toBe('old-canvas');

		fonts.resolve();
		expect(await pending).toBe(true);
		expect(scope.getAttribute('data-theme-id')).toBe('studio');
		expect(scope.properties.get('--background')).toBe('oklch(0.99 0.004 250)');
	});

	it('prevents a stale preparation from replacing the latest workspace theme', async () => {
		const firstPack = deferred();
		const scope = fakeScope();
		const runtime = new WebThemeRuntime(
			loaders({
				loadIconPack: (pack) => (pack === 'lucide' ? firstPack.promise : Promise.resolve())
			})
		);

		const first = runtime.apply(resolveBuiltInTheme('workshop', 'light'), scope);
		const second = runtime.apply(resolveBuiltInTheme('notebook', 'light'), scope);

		expect(await second).toBe(true);
		firstPack.resolve();
		expect(await first).toBe(false);
		expect(scope.getAttribute('data-theme-id')).toBe('notebook');
	});

	it('uses the same isolated runtime for editor previews without changing browser chrome', async () => {
		const runtimeLoaders = loaders();
		const scope = fakeScope();
		const runtime = new WebThemeRuntime(runtimeLoaders);

		expect(await runtime.applyScoped(resolveBuiltInTheme('playroom', 'light'), scope)).toBe(true);
		expect(scope.getAttribute('data-theme-scope')).toBe('preview');
		expect(scope.getAttribute('data-theme-icon-pack')).toBe('phosphor');
		expect(scope.getAttribute('data-theme-tabs')).toBe('pill');
		expect(scope.getAttribute('data-theme-empty-state')).toBe('illustrated');
		expect(scope.getAttribute('data-theme-editor-chrome')).toBe('neutral');
		expect(runtimeLoaders.setBrowserSurface).not.toHaveBeenCalled();
	});

	it('uses the browser chrome token for the application theme-color', async () => {
		const runtimeLoaders = loaders();
		const scope = fakeScope();
		const runtime = new WebThemeRuntime(runtimeLoaders);
		const selected = resolveBuiltInTheme('workshop', 'dark');

		expect(await runtime.apply(selected, scope)).toBe(true);
		expect(runtimeLoaders.setBrowserSurface).toHaveBeenCalledOnce();
		expect(runtimeLoaders.setBrowserSurface).toHaveBeenCalledWith(
			selected.manifest.colors.browserChrome
		);
		expect(selected.manifest.colors.browserChrome).not.toBe(
			selected.manifest.colors.browserSurface
		);
	});

	it('maps a resolved scheme to all browser and protected editor variables', () => {
		const variables = themeSchemeToCssVariables(resolveBuiltInTheme('workshop', 'dark'));

		expect(variables['--background']).toBe('oklch(0.145 0.008 55)');
		expect(variables['--selection']).toBe('oklch(0.32 0.065 45)');
		expect(variables['--browser-surface']).toBe('oklch(0.145 0.008 55)');
		expect(variables['--action-focal']).toBe('oklch(0.66 0.14 45)');
		expect(variables['--brand']).toBe('oklch(0.66 0.14 45)');
		expect(variables['--theme-type-display-size']).toBe('clamp(2rem, 4vw, 3.5rem)');
		expect(variables['--theme-type-code-family']).toContain('Geist Mono Variable');
		expect(variables['--theme-motion-page-transition-duration']).toBe('240ms');
		expect(variables['--theme-border-style']).toBe('solid');
		expect(variables['--theme-asset-sidebar-decoration']).toBe('none');
		expect(variables['--theme-asset-header-decoration']).toBe('none');
		expect(variables['--theme-asset-loading-illustration']).toBe('none');
		expect(variables['--editor-canvas']).toBe('oklch(0.12 0.006 55)');
		expect(variables['--timeline-playhead']).toBe('oklch(0.72 0.16 45)');
		expect(variables['--canvas-selection']).toBe('oklch(0.72 0.16 45)');
	});

	it('commits the embedded Workshop fallback when a selected resource cannot load', async () => {
		const scope = fakeScope();
		const runtime = new WebThemeRuntime(
			loaders({
				loadIconPack: (pack) =>
					pack === 'heroicons-outline'
						? Promise.reject(new Error('pack unavailable'))
						: Promise.resolve()
			})
		);

		expect(await runtime.apply(resolveBuiltInTheme('studio', 'light'), scope)).toBe(true);
		expect(scope.getAttribute('data-theme-id')).toBe('workshop');
		expect(scope.getAttribute('data-theme-fallback')).toBe('resource-failed');
		expect(scope.properties.get('--action-focal')).toBe('oklch(0.55 0.155 45)');
	});

	it('rejects protected editor token drift as one invalid manifest', async () => {
		const scope = fakeScope();
		const runtime = new WebThemeRuntime(loaders());
		const selected = resolveBuiltInTheme('notebook', 'light');
		selected.manifest.protectedEditor.timelineWaveform = 'transparent';

		expect(await runtime.apply(selected, scope)).toBe(true);
		expect(scope.getAttribute('data-theme-id')).toBe('workshop');
		expect(scope.getAttribute('data-theme-fallback')).toBe('invalid-manifest');
		expect(scope.properties.get('--timeline-waveform')).toBe('oklch(0.74 0.04 245)');
	});

	it('rejects remote CSS and negative or unbounded render values before committing', async () => {
		const unsafeThemes = [
			(selected = resolveBuiltInTheme('studio', 'light')) => {
				selected.manifest.colors.canvas = 'url(https://example.com/track.png)';
				return selected;
			},
			(selected = resolveBuiltInTheme('studio', 'light')) => {
				selected.manifest.spacing.pageGutter = '-1rem';
				return selected;
			},
			(selected = resolveBuiltInTheme('studio', 'light')) => {
				selected.manifest.shell.sidebarWidth = '99999px';
				return selected;
			},
			(selected = resolveBuiltInTheme('studio', 'light')) => {
				selected.manifest.motion.pageTransition.duration = '3s';
				return selected;
			}
		];

		for (const unsafeTheme of unsafeThemes) {
			const scope = fakeScope();
			scope.style.setProperty('--background', 'old-canvas');
			const runtime = new WebThemeRuntime(loaders());

			expect(await runtime.apply(unsafeTheme(), scope)).toBe(true);
			expect(scope.getAttribute('data-theme-id')).toBe('workshop');
			expect(scope.getAttribute('data-theme-fallback')).toBe('invalid-manifest');
			expect(scope.properties.get('--background')).toBe('oklch(0.985 0.002 80)');
		}
	});

	it('rejects an incomplete component or motion recipe', async () => {
		const runtime = new WebThemeRuntime(loaders());
		const selected = resolveBuiltInTheme('studio', 'light');
		// SAFETY: this test deliberately removes required wire fields to verify runtime fallback.
		delete (selected.manifest.components as Partial<typeof selected.manifest.components>).toast;
		// SAFETY: this test deliberately removes required wire fields to verify runtime fallback.
		delete (selected.manifest.motion.entry as Partial<typeof selected.manifest.motion.entry>)
			.opacity;
		const scope = fakeScope();

		expect(await runtime.apply(selected, scope)).toBe(true);
		expect(scope.getAttribute('data-theme-id')).toBe('workshop');
		expect(scope.getAttribute('data-theme-fallback')).toBe('invalid-manifest');
	});
});
