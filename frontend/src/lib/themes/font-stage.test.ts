import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { resolveBuiltInTheme } from './builtins.js';
import type {
	ResolvedTheme,
	ThemeFontFace,
	ThemeRuntimeFontFace,
	WebResolvedTheme
} from './contracts.js';
import {
	createThemeFontPlan,
	stageThemeFontPlan,
	type ThemeFontEnvironment,
	type ThemeFontFaceHandle
} from './font-stage.js';

function storedFace(family: string, weight: number): ThemeFontFace {
	return {
		id: `${family.toLowerCase().replaceAll(' ', '-')}-${weight}`,
		family,
		sourceUrl: `/api/v1/theme-assets/font-${weight}/content?organization_id=organization-id`,
		format: 'woff2',
		weight,
		style: 'normal',
		display: 'swap'
	};
}

function uploadedPreview(revision = '1'): WebResolvedTheme {
	const theme: WebResolvedTheme = resolveBuiltInTheme('studio', 'light');
	theme.id = 'organization-theme';
	theme.revision = revision;
	theme.source = 'organization';
	theme.manifest.typography.body.family = 'Organization Sans';
	theme.fonts = [storedFace('Organization Sans', 400)];
	return theme;
}

describe('web theme font staging', () => {
	it('keeps stored preview faces separate from resolved native font contracts', () => {
		const stored = storedFace('Organization Sans', 400);
		const runtime: ThemeRuntimeFontFace = {
			...stored,
			nativeDerivative: {
				sourceUrl: '/api/v1/theme-assets/native-font/content?workspace_id=workspace-id',
				format: 'ttf',
				identity: 'a'.repeat(64)
			}
		};
		const preview: WebResolvedTheme = { ...uploadedPreview(), fonts: [stored] };
		const resolved: ResolvedTheme = { ...resolveBuiltInTheme('studio', 'light'), fonts: [runtime] };

		expectTypeOf<ThemeRuntimeFontFace>().toMatchTypeOf<ThemeFontFace>();
		expectTypeOf<ResolvedTheme>().toMatchTypeOf<WebResolvedTheme>();
		expect(createThemeFontPlan(preview)).not.toBeNull();
		expect(createThemeFontPlan(resolved)).not.toBeNull();
	});

	it('requires the exact uploaded face used by every active typography role', () => {
		const theme = uploadedPreview();
		theme.manifest.typography.title.family = 'Organization Sans';

		expect(createThemeFontPlan(theme)).toBeNull();

		theme.fonts.push(storedFace('Organization Sans', 600));
		expect(createThemeFontPlan(theme)?.entries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: 'uploaded', weight: 400 }),
				expect.objectContaining({ kind: 'uploaded', weight: 600 })
			])
		);
	});

	it('namespaces uploaded families by immutable theme revision and ignores native derivatives', () => {
		const first = uploadedPreview('7');
		const second = uploadedPreview('8');
		const runtimeFace: ThemeRuntimeFontFace = {
			...first.fonts[0]!,
			nativeDerivative: {
				sourceUrl: 'https://native-only.invalid/font.ttf',
				format: 'ttf',
				identity: 'b'.repeat(64)
			}
		};
		first.fonts = [runtimeFace];
		const firstPlan = createThemeFontPlan(first)!;
		const secondPlan = createThemeFontPlan(second)!;
		const entry = firstPlan.entries.find((candidate) => candidate.kind === 'uploaded')!;

		expect(firstPlan.familyNames.get('Organization Sans')).not.toBe(
			secondPlan.familyNames.get('Organization Sans')
		);
		expect(entry.sourceUrl).toBe(runtimeFace.sourceUrl);
		expect(entry).not.toHaveProperty('nativeDerivative');
	});

	it('adds uploaded faces only after every exact face and bundled family is ready', async () => {
		const theme = uploadedPreview();
		theme.manifest.typography.title.family = 'Organization Sans';
		theme.fonts.push(storedFace('Organization Sans', 600));
		const plan = createThemeFontPlan(theme)!;
		const handles: ThemeFontFaceHandle[] = [];
		const add = vi.fn();
		const remove = vi.fn();
		let created = 0;
		const environment: ThemeFontEnvironment = {
			loadBundled: vi.fn(async () => true),
			createUploaded: vi.fn(() => {
				const index = created++;
				const handle: ThemeFontFaceHandle = {
					load: index === 1 ? () => Promise.reject(new Error('broken face')) : vi.fn()
				};
				handles.push(handle);
				return handle;
			}),
			add,
			delete: remove
		};

		await expect(stageThemeFontPlan(plan, environment)).rejects.toThrow('broken face');
		expect(handles).toHaveLength(2);
		expect(add).not.toHaveBeenCalled();
		expect(remove).not.toHaveBeenCalled();
	});

	it('releases every namespaced uploaded face exactly once', async () => {
		const plan = createThemeFontPlan(uploadedPreview())!;
		const handle: ThemeFontFaceHandle = { load: vi.fn(async () => undefined) };
		const add = vi.fn();
		const remove = vi.fn();
		const stage = await stageThemeFontPlan(plan, {
			loadBundled: vi.fn(async () => true),
			createUploaded: vi.fn(() => handle),
			add,
			delete: remove
		});

		expect(add).toHaveBeenCalledOnce();
		stage.release();
		stage.release();
		expect(remove).toHaveBeenCalledOnce();
		expect(remove).toHaveBeenCalledWith(handle);
	});
});
