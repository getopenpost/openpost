import { describe, expect, it } from 'vitest';
import { getBuiltInTheme } from '$lib/themes';
import {
	THEME_EDITOR_SECTIONS,
	duplicateThemeManifest,
	isThemeFontInUse,
	parseThemeManifest,
	randomizeThemeManifest,
	resetThemeSection,
	serializeThemeManifest,
	takeThemeCodePoints,
	themeCodePointLength,
	themeEditorFingerprint,
	updateThemeSectionValue
} from './theme-editor-model';

describe('theme editor model', () => {
	it('updates one token without mutating the published source', () => {
		const source = getBuiltInTheme('workshop');
		const original = source.schemes.light!.colors.actionFocal;
		const updated = updateThemeSectionValue(source, 'light', 'colors', 'actionFocal', '#155EEF');

		expect(updated.schemes.light!.colors.actionFocal).toBe('#155EEF');
		expect(source.schemes.light!.colors.actionFocal).toBe(original);
		expect(updated.schemes.dark).toEqual(source.schemes.dark);
	});

	it('resets only the selected section from the starting theme', () => {
		const source = getBuiltInTheme('workshop');
		let draft = updateThemeSectionValue(source, 'light', 'shape', 'radius', '2rem');
		draft = updateThemeSectionValue(draft, 'light', 'colors', 'actionFocal', '#155EEF');

		const reset = resetThemeSection(draft, source, 'light', 'shape');

		expect(reset.schemes.light!.shape).toEqual(source.schemes.light!.shape);
		expect(reset.schemes.light!.colors.actionFocal).toBe('#155EEF');
	});

	it('duplicates a complete snapshot without linking it to the source', () => {
		const source = getBuiltInTheme('notebook');
		const duplicate = duplicateThemeManifest(source, 'northstar-notebook', 'Northstar Notebook');

		expect(duplicate.id).toBe('northstar-notebook');
		expect(duplicate.revision).toBe('draft');
		expect(duplicate.schemes.light).toEqual(source.schemes.light);
		expect(duplicate.schemes.light).not.toBe(source.schemes.light);
	});

	it('round trips complete manifests and rejects missing supported schemes', () => {
		const source = getBuiltInTheme('midnight');
		const encoded = serializeThemeManifest(source);
		expect(parseThemeManifest(encoded)).toEqual(source);

		const incomplete = JSON.parse(encoded);
		delete incomplete.schemes.dark;
		expect(() => parseThemeManifest(JSON.stringify(incomplete))).toThrow(
			'dark must contain a complete manifest'
		);
	});

	it('accepts an intentionally empty optional description', () => {
		const source = structuredClone(getBuiltInTheme('workshop'));
		source.description = '';

		expect(parseThemeManifest(serializeThemeManifest(source))).toEqual(source);
	});

	it('measures translated metadata in Unicode code points like the API', () => {
		const source = structuredClone(getBuiltInTheme('workshop'));
		source.name = '🌿'.repeat(80);
		source.description = '雲'.repeat(240);

		expect(parseThemeManifest(serializeThemeManifest(source))).toEqual(source);
		expect(themeCodePointLength(source.name)).toBe(80);
		expect(takeThemeCodePoints('Theme 🌿 palette', 7)).toBe('Theme 🌿');
	});

	it('rejects unknown fields and unsafe stored resource references', () => {
		const source = getBuiltInTheme('workshop');
		const withUnknownField = {
			...structuredClone(source),
			trackingPixel: true
		};
		expect(() => parseThemeManifest(JSON.stringify(withUnknownField))).toThrow(
			'unknown or missing fields'
		);

		const withUnsafeAsset = structuredClone(source);
		withUnsafeAsset.assets = [
			{
				id: 'empty-art',
				slot: 'empty-state-illustration',
				sourceUrl: 'https://tracker.example/empty.png',
				mimeType: 'image/png',
				alt: ''
			}
		];
		expect(() => parseThemeManifest(JSON.stringify(withUnsafeAsset))).toThrow(
			'invalid decorative asset'
		);
	});

	it('requires a bundled family or matching uploaded face for every type role', () => {
		const source = structuredClone(getBuiltInTheme('workshop'));
		source.schemes.light!.typography.body.family = 'Missing Sans';

		expect(() => parseThemeManifest(JSON.stringify(source))).toThrow(
			'has no matching bundled or uploaded font face'
		);

		source.fonts = [
			{
				id: 'missing-sans-400-italic',
				family: 'Missing Sans',
				sourceUrl: 'asset:missing-sans-400-italic',
				format: 'woff2',
				weight: 400,
				style: 'italic',
				display: 'swap'
			}
		];
		expect(() => parseThemeManifest(JSON.stringify(source))).toThrow(
			'has no matching bundled or uploaded font face'
		);
		expect(isThemeFontInUse(source, 'missing-sans-400-italic')).toBe(false);

		source.fonts[0]!.style = 'normal';
		expect(parseThemeManifest(JSON.stringify(source))).toEqual(source);
		expect(isThemeFontInUse(source, 'missing-sans-400-italic')).toBe(true);
		expect(isThemeFontInUse(source, 'unknown-font')).toBe(false);
	});

	it('rejects server-owned native font derivatives from stored draft manifests', () => {
		const source = structuredClone(getBuiltInTheme('workshop'));
		source.fonts = [
			{
				id: 'organization-sans-400',
				family: 'Organization Sans',
				sourceUrl: 'asset:organization-sans-400',
				format: 'woff2',
				weight: 400,
				style: 'normal',
				display: 'swap'
			}
		];
		source.schemes.light!.typography.body.family = 'Organization Sans';
		const encoded = JSON.parse(serializeThemeManifest(source));
		encoded.fonts[0].nativeDerivative = {
			sourceUrl: '/api/v1/theme-assets/organization-sans-400/content?workspace_id=one&format=ttf',
			format: 'ttf',
			identity: 'sha256-example'
		};

		expect(() => parseThemeManifest(JSON.stringify(encoded))).toThrow('invalid font face');
	});

	it('uses the complete visual document as the dirty-state fingerprint', () => {
		const source = getBuiltInTheme('workshop');
		const changed = updateThemeSectionValue(source, 'dark', 'motion', 'press', {
			...source.schemes.dark!.motion.press,
			duration: '1ms'
		});

		expect(themeEditorFingerprint(changed)).not.toBe(themeEditorFingerprint(source));
		expect(themeEditorFingerprint(structuredClone(source))).toBe(themeEditorFingerprint(source));
	});

	it('randomizes deterministically without changing protected editor roles', () => {
		const source = getBuiltInTheme('workshop');
		const first = randomizeThemeManifest(source, 'light', 42017);
		const second = randomizeThemeManifest(source, 'light', 42017);

		expect(first).toEqual(second);
		expect(first.schemes.light!.protectedEditor).toEqual(source.schemes.light!.protectedEditor);
		expect(first.schemes.dark).toEqual(source.schemes.dark);
	});

	it('produces a complete valid theme for representative seeds and every section', () => {
		const source = getBuiltInTheme('workshop');
		for (const seed of [0, 1, 2, 17, 42017, 2_147_483_647]) {
			expect(() =>
				parseThemeManifest(serializeThemeManifest(randomizeThemeManifest(source, 'light', seed)))
			).not.toThrow();
			for (const section of THEME_EDITOR_SECTIONS) {
				const randomized = randomizeThemeManifest(source, 'light', seed, section);
				expect(() => parseThemeManifest(serializeThemeManifest(randomized))).not.toThrow();
				for (const untouched of THEME_EDITOR_SECTIONS) {
					if (untouched === section) continue;
					expect(randomized.schemes.light![untouched]).toEqual(source.schemes.light![untouched]);
				}
			}
		}
	});

	it('keeps typography randomization on uploaded static font faces that exist', () => {
		const source = structuredClone(getBuiltInTheme('workshop'));
		source.fonts = [
			{
				id: 'organization-display-400',
				family: 'Organization Display',
				sourceUrl: 'asset:organization-display-400',
				format: 'woff2',
				weight: 400,
				style: 'normal',
				display: 'swap'
			}
		];
		for (const role of ['display', 'title', 'label'] as const) {
			source.schemes.light!.typography[role].family = 'Organization Display';
			source.schemes.light!.typography[role].weight = 400;
		}

		const randomized = randomizeThemeManifest(source, 'light', 17, 'typography');

		expect(randomized.schemes.light!.typography.display.weight).toBe(400);
		expect(randomized.schemes.light!.typography.title.weight).toBe(400);
		expect(randomized.schemes.light!.typography.label.weight).toBe(400);
		expect(() => parseThemeManifest(serializeThemeManifest(randomized))).not.toThrow();
	});
});
