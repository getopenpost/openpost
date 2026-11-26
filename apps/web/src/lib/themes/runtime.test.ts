import { describe, expect, it, vi } from 'vitest';
import { resolveBuiltInTheme } from '@openpost/ui/themes/builtins.js';
import type { ThemeAsset, WebResolvedTheme } from '@openpost/ui/themes/contracts.js';
import {
	WebThemeRuntime,
	isOpaqueThemeResourceUrl,
	isSameOriginThemeResourceUrl,
	type ThemeRuntimeLoaders,
	type ThemeScope
} from '@openpost/ui/themes/runtime.js';

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
		stageFonts: vi.fn(async () => ({ release: vi.fn() })),
		loadAssets: vi.fn(async () => undefined),
		loadIconPack: vi.fn(async () => undefined),
		setBrowserSurface: vi.fn(() => vi.fn()),
		...overrides
	};
}

function organizationTheme(family: 'studio' | 'notebook' = 'studio'): WebResolvedTheme {
	const theme: WebResolvedTheme = resolveBuiltInTheme(family, 'light');
	theme.id = 'theme-id';
	theme.revision = '2';
	theme.source = 'organization';
	return theme;
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

	it('accepts only the exact immutable workspace revision query shape', () => {
		const assetPath = '/api/v1/theme-assets/opaque-id/content';
		const resourceScope = {
			kind: 'published',
			themeId: 'theme-id',
			revision: '2'
		} as const;
		expect(
			isOpaqueThemeResourceUrl(
				`${assetPath}?workspace_id=workspace-id&theme_id=theme-id&revision=2`,
				resourceScope
			)
		).toBe(true);
		expect(
			isOpaqueThemeResourceUrl(
				`${assetPath}?workspace_id=workspace-id&theme_id=other-theme&revision=2`,
				resourceScope
			)
		).toBe(false);
		expect(
			isOpaqueThemeResourceUrl(
				`${assetPath}?workspace_id=workspace-id&theme_id=theme-id&revision=3`,
				resourceScope
			)
		).toBe(false);
		for (const unsafeQuery of [
			'',
			'?workspace_id=workspace-id',
			'?organization_id=organization-id',
			'?workspace_id=workspace-id&theme_id=theme-id',
			'?organization_id=organization-id&theme_id=theme-id&revision=2',
			'?workspace_id=workspace-id&workspace_id=second',
			'?workspace_id=workspace-id&theme_id=theme-id&revision=0',
			'?workspace_id=workspace-id&unexpected=value'
		]) {
			expect(
				isOpaqueThemeResourceUrl(`${assetPath}${unsafeQuery}`, resourceScope),
				unsafeQuery
			).toBe(false);
		}
	});

	it('accepts the organization asset route only for an explicit editor preview scope', () => {
		const editorUrl = '/api/v1/theme-assets/opaque-id/content?organization_id=organization-id';
		expect(isOpaqueThemeResourceUrl(editorUrl, { kind: 'editor-preview' })).toBe(true);
		expect(
			isOpaqueThemeResourceUrl(editorUrl, {
				kind: 'published',
				themeId: 'theme-id',
				revision: '2'
			})
		).toBe(false);
		expect(
			isOpaqueThemeResourceUrl(`${editorUrl}&revision=2`, {
				kind: 'editor-preview'
			})
		).toBe(false);
	});

	it('stages organization-scoped resources only in marked editor previews', async () => {
		const resource = {
			id: 'draft-paper',
			slot: 'background-texture' as const,
			sourceUrl: '/api/v1/theme-assets/draft-paper/content?organization_id=organization-id',
			mimeType: 'image/png'
		} satisfies ThemeAsset;
		const editorPreview = organizationTheme('notebook');
		editorPreview.revision = 'draft-3';
		editorPreview.webResourceScope = 'editor-preview';
		editorPreview.assets = [resource];
		const runtime = new WebThemeRuntime(loaders());
		const previewScope = fakeScope();

		expect(await runtime.applyScoped(editorPreview, previewScope)).toBe(true);
		expect(previewScope.getAttribute('data-theme-fallback')).toBeNull();

		const applicationScope = fakeScope();
		expect(await runtime.apply(editorPreview, applicationScope)).toBe(true);
		expect(applicationScope.getAttribute('data-theme-fallback')).toBe('unsafe-resource');

		const unmarkedPreview = {
			...editorPreview,
			webResourceScope: 'published' as const
		};
		const unmarkedScope = fakeScope();
		expect(await runtime.applyScoped(unmarkedPreview, unmarkedScope)).toBe(true);
		expect(unmarkedScope.getAttribute('data-theme-fallback')).toBe('unsafe-resource');
	});

	it('uses a distinct fallback reason for unsafe resource references', async () => {
		const scope = fakeScope();
		const runtimeLoaders = loaders();
		const runtime = new WebThemeRuntime(runtimeLoaders);
		const selected = organizationTheme('notebook');
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

	it('rejects unsafe raster MIME and paths independently of resource scope', async () => {
		const runtime = new WebThemeRuntime(loaders());
		const selected = organizationTheme('notebook');
		selected.assets.push({
			id: 'preview-paper',
			slot: 'header-decoration',
			sourceUrl:
				'/api/v1/theme-assets/preview-paper/content?workspace_id=workspace-id&theme_id=theme-id&revision=2',
			mimeType: 'image/png'
		});
		const valid = fakeScope();
		expect(await runtime.apply(selected, valid)).toBe(true);
		expect(valid.getAttribute('data-theme-fallback'), 'valid scoped PNG control').toBeNull();
		const vector = structuredClone(selected);
		Reflect.set(vector.assets[0]!, 'mimeType', 'image/svg+xml');
		const vectorScope = fakeScope();
		expect(await runtime.apply(vector, vectorScope)).toBe(true);
		expect(vectorScope.getAttribute('data-theme-fallback'), 'SVG MIME rejection').toBe(
			'unsafe-resource'
		);
		const unscoped = structuredClone(selected);
		unscoped.assets[0]!.sourceUrl = '/uploads/preview-paper.png';
		const pathScope = fakeScope();
		expect(await runtime.apply(unscoped, pathScope)).toBe(true);
		expect(pathScope.getAttribute('data-theme-fallback'), 'nonopaque path rejection').toBe(
			'unsafe-resource'
		);
	});

	it('keeps the current scope intact until all theme resources are ready', async () => {
		const fonts = deferred();
		const scope = fakeScope();
		scope.setAttribute('data-theme-id', 'workshop');
		scope.style.setProperty('--background', 'old-canvas');
		const runtime = new WebThemeRuntime(
			loaders({
				stageFonts: async () => {
					await fonts.promise;
					return { release: vi.fn() };
				}
			})
		);
		const pending = runtime.apply(resolveBuiltInTheme('studio', 'light'), scope);

		expect(scope.getAttribute('data-theme-id')).toBe('workshop');
		expect(scope.properties.get('--background')).toBe('old-canvas');

		fonts.resolve();
		expect(await pending).toBe(true);
		expect(scope.getAttribute('data-theme-id')).toBe('studio');
		expect(scope.properties.get('--background')).toBe('oklch(0.99 0.004 250)');
	});

	it('releases staged fonts after stale preparation, replacement, and clear', async () => {
		const firstPack = deferred();
		const releases = [vi.fn(), vi.fn(), vi.fn()];
		const stageFonts = vi
			.fn()
			.mockResolvedValueOnce({ release: releases[0] })
			.mockResolvedValueOnce({ release: releases[1] })
			.mockResolvedValueOnce({ release: releases[2] });
		const scope = fakeScope();
		const runtime = new WebThemeRuntime(
			loaders({
				stageFonts,
				loadIconPack: (pack) => (pack === 'lucide' ? firstPack.promise : Promise.resolve())
			})
		);

		const stale = runtime.apply(resolveBuiltInTheme('workshop', 'light'), scope);
		expect(await runtime.apply(resolveBuiltInTheme('notebook', 'light'), scope)).toBe(true);
		firstPack.resolve();
		expect(await stale).toBe(false);
		expect(
			scope.getAttribute('data-theme-id'),
			'stale preparation must preserve latest notebook'
		).toBe('notebook');
		expect(releases[0]).toHaveBeenCalledOnce();
		expect(releases[1]).not.toHaveBeenCalled();

		expect(await runtime.apply(resolveBuiltInTheme('playroom', 'light'), scope)).toBe(true);
		expect(releases[1]).toHaveBeenCalledOnce();
		expect(releases[2]).not.toHaveBeenCalled();
		runtime.clear(scope);
		expect(releases[2]).toHaveBeenCalledOnce();
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

	it('never blocks product access when fallback resource staging also fails', async () => {
		const scope = fakeScope();
		const runtime = new WebThemeRuntime(
			loaders({
				stageFonts: () => Promise.reject(new Error('font subsystem unavailable')),
				loadAssets: () => Promise.reject(new Error('image subsystem unavailable')),
				loadIconPack: () => Promise.reject(new Error('chunk subsystem unavailable'))
			})
		);

		await expect(runtime.apply(resolveBuiltInTheme('studio', 'light'), scope)).resolves.toBe(true);
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
		expect(scope.properties.get('--timeline-waveform')).toBe('oklch(0.3 0.05 245)');
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
});
