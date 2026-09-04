import {
	BUNDLED_THEME_FONT_FAMILIES,
	THEME_ASSET_SLOTS,
	THEME_ICON_PACK_IDS,
	THEME_SCHEMES,
	THEME_TYPOGRAPHY_ROLE_KEYS,
	isCompleteThemeSchemeManifest,
	type ThemeAsset,
	type ThemeAssetSlot,
	type ThemeFontFace,
	type ThemeIconPackId,
	type ThemeManifest,
	type ThemeScheme,
	type ThemeSchemeManifest
} from '$lib/themes';

export const THEME_EDITOR_SECTIONS = [
	'colors',
	'typography',
	'spacing',
	'shape',
	'elevation',
	'motion',
	'shell',
	'components'
] as const;

export type ThemeEditorSection = (typeof THEME_EDITOR_SECTIONS)[number];

export type ThemeEditorValidationCode =
	| 'scheme_unsupported'
	| 'scheme_not_shared'
	| 'theme_id'
	| 'theme_name'
	| 'manifest_size'
	| 'invalid_json'
	| 'manifest_object'
	| 'schema_version'
	| 'id'
	| 'revision'
	| 'name'
	| 'description'
	| 'icon_pack'
	| 'supported_schemes_empty'
	| 'unsupported_scheme'
	| 'duplicate_scheme'
	| 'incomplete_scheme'
	| 'undeclared_scheme'
	| 'scheme_order'
	| 'resource_arrays'
	| 'character_limit'
	| 'unknown_fields'
	| 'required_field'
	| 'resource_limit'
	| 'invalid_font'
	| 'duplicate_font'
	| 'invalid_asset'
	| 'duplicate_asset'
	| 'missing_font_face'
	| 'random_seed';

export class ThemeEditorValidationError extends Error {
	constructor(
		readonly code: ThemeEditorValidationCode,
		readonly values: Readonly<Record<string, string | number>>,
		message: string
	) {
		super(message);
		this.name = 'ThemeEditorValidationError';
	}
}

function validationError(
	code: ThemeEditorValidationCode,
	message: string,
	values: Readonly<Record<string, string | number>> = {}
) {
	return new ThemeEditorValidationError(code, values, message);
}

export function updateThemeSectionValue<
	Section extends ThemeEditorSection,
	Key extends keyof ThemeSchemeManifest[Section]
>(
	manifest: ThemeManifest,
	scheme: ThemeScheme,
	section: Section,
	key: Key,
	value: ThemeSchemeManifest[Section][Key]
): ThemeManifest {
	const next = structuredClone(manifest);
	const schemeManifest = next.schemes[scheme];
	if (!schemeManifest) {
		throw validationError('scheme_unsupported', `${scheme} is not supported by ${manifest.name}`, {
			scheme,
			name: manifest.name
		});
	}
	schemeManifest[section] = {
		...schemeManifest[section],
		[key]: value
	};
	return next;
}

export function resetThemeSection(
	manifest: ThemeManifest,
	baseline: ThemeManifest,
	scheme: ThemeScheme,
	section: ThemeEditorSection
): ThemeManifest {
	const next = structuredClone(manifest);
	const sourceScheme = baseline.schemes[scheme];
	const targetScheme = next.schemes[scheme];
	if (!sourceScheme || !targetScheme) {
		throw validationError('scheme_not_shared', `${scheme} is not available in both themes`, {
			scheme
		});
	}
	targetScheme[section] = structuredClone(sourceScheme[section]);
	return next;
}

export function duplicateThemeManifest(
	manifest: ThemeManifest,
	id: string,
	name: string
): ThemeManifest {
	const normalizedID = id.trim();
	const normalizedName = name.trim();
	if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(normalizedID)) {
		throw validationError('theme_id', 'Theme ID must use lowercase letters, numbers, and hyphens');
	}
	if (normalizedName.length === 0 || themeCodePointLength(normalizedName) > 80) {
		throw validationError('theme_name', 'Theme name must contain 1 to 80 characters');
	}
	return {
		...structuredClone(manifest),
		id: normalizedID,
		revision: 'draft',
		name: normalizedName
	};
}

export function serializeThemeManifest(manifest: ThemeManifest): string {
	return `${JSON.stringify(manifest, null, 2)}\n`;
}

interface ThemeManifestInput {
	schemaVersion?: unknown;
	id?: unknown;
	revision?: unknown;
	name?: unknown;
	description?: unknown;
	iconPack?: unknown;
	supportedSchemes?: unknown;
	schemes?: unknown;
	fonts?: unknown;
	assets?: unknown;
}

interface ThemeSchemesInput {
	light?: unknown;
	dark?: unknown;
}

interface ThemeFontFaceInput {
	id?: unknown;
	family?: unknown;
	sourceUrl?: unknown;
	format?: unknown;
	weight?: unknown;
	style?: unknown;
	display?: unknown;
}

interface ThemeAssetInput {
	id?: unknown;
	slot?: unknown;
	sourceUrl?: unknown;
	mimeType?: unknown;
	alt?: unknown;
}

const themeManifestKeys = [
	'schemaVersion',
	'id',
	'revision',
	'name',
	'description',
	'iconPack',
	'supportedSchemes',
	'schemes',
	'fonts',
	'assets'
] as const;
const themeFontFaceKeys = [
	'id',
	'family',
	'sourceUrl',
	'format',
	'weight',
	'style',
	'display'
] as const;
const themeAssetKeys = ['id', 'slot', 'sourceUrl', 'mimeType'] as const;
const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const fontFamilyPattern = /^[a-zA-Z0-9 _.,:'-]+$/;
const supportedAssetMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif']);
const bundledThemeFontFamilies = new Set<string>(BUNDLED_THEME_FONT_FAMILIES);

function isThemeManifestInput(value: unknown): value is ThemeManifestInput {
	return value !== null && typeof value === 'object';
}

function isThemeSchemesInput(value: unknown): value is ThemeSchemesInput {
	return value !== null && typeof value === 'object';
}

function isThemeFontFaceInput(value: unknown): value is ThemeFontFaceInput {
	return value !== null && typeof value === 'object';
}

function isThemeAssetInput(value: unknown): value is ThemeAssetInput {
	return value !== null && typeof value === 'object';
}

function isString(value: unknown): value is string {
	return typeof value === 'string';
}

function isThemeScheme(value: unknown): value is ThemeScheme {
	return THEME_SCHEMES.some((scheme) => scheme === value);
}

function isThemeIconPackId(value: unknown): value is ThemeIconPackId {
	return THEME_ICON_PACK_IDS.some((iconPack) => iconPack === value);
}

function isThemeAssetSlot(value: unknown): value is ThemeAssetSlot {
	return THEME_ASSET_SLOTS.some((slot) => slot === value);
}

function isFontWeight(value: unknown): value is number {
	return (
		typeof value === 'number' &&
		Number.isInteger(value) &&
		value >= 100 &&
		value <= 900 &&
		value % 100 === 0
	);
}

function isFontStyle(value: unknown): value is ThemeFontFace['style'] {
	return value === 'normal' || value === 'italic';
}

function isFontDisplay(value: unknown): value is ThemeFontFace['display'] {
	return value === 'swap' || value === 'fallback' || value === 'optional';
}

export function parseThemeManifest(source: string): ThemeManifest {
	if (new TextEncoder().encode(source).byteLength > 256 * 1024) {
		throw validationError('manifest_size', 'Manifest must be no larger than 256 KiB');
	}
	let candidate: unknown;
	try {
		candidate = JSON.parse(source);
	} catch {
		throw validationError('invalid_json', 'Manifest is not valid JSON');
	}
	if (!isThemeManifestInput(candidate)) {
		throw validationError('manifest_object', 'Manifest must be an object');
	}
	const value = candidate;
	assertExactRootKeys(value, themeManifestKeys);
	if (value.schemaVersion !== 1) throw validationError('schema_version', 'schemaVersion must be 1');
	if (!isString(value.id) || !identifierPattern.test(value.id)) {
		throw validationError('id', 'id must be a stable identifier');
	}
	if (
		!isString(value.revision) ||
		value.revision.length > 128 ||
		!/^[a-zA-Z0-9][a-zA-Z0-9 _.-]*$/.test(value.revision)
	) {
		throw validationError('revision', 'revision must be a stable identifier');
	}
	if (!isString(value.name) || value.name.trim() === '' || themeCodePointLength(value.name) > 80) {
		throw validationError('name', 'name must contain 1 to 80 characters');
	}
	if (!isString(value.description) || themeCodePointLength(value.description) > 240) {
		throw validationError('description', 'description must contain at most 240 characters');
	}
	if (!isThemeIconPackId(value.iconPack)) {
		throw validationError('icon_pack', 'iconPack is not supported');
	}
	if (!Array.isArray(value.supportedSchemes) || value.supportedSchemes.length === 0) {
		throw validationError('supported_schemes_empty', 'supportedSchemes must include light or dark');
	}
	const supportedSchemes: ThemeScheme[] = [];
	const schemeInputs: ThemeSchemesInput = isThemeSchemesInput(value.schemes) ? value.schemes : {};
	const schemes: Partial<Record<ThemeScheme, ThemeSchemeManifest>> = {};
	for (const candidateScheme of value.supportedSchemes) {
		if (!isThemeScheme(candidateScheme)) {
			throw validationError(
				'unsupported_scheme',
				`${String(candidateScheme)} is not a supported scheme`,
				{
					scheme: String(candidateScheme)
				}
			);
		}
		if (supportedSchemes.includes(candidateScheme)) {
			throw validationError('duplicate_scheme', `${candidateScheme} is listed more than once`, {
				scheme: candidateScheme
			});
		}
		supportedSchemes.push(candidateScheme);
		const schemeManifest = schemeInputs[candidateScheme];
		if (!isCompleteThemeSchemeManifest(schemeManifest, candidateScheme)) {
			throw validationError(
				'incomplete_scheme',
				`${candidateScheme} must contain a complete manifest`,
				{
					scheme: candidateScheme
				}
			);
		}
		schemes[candidateScheme] = schemeManifest;
	}
	for (const candidateScheme of THEME_SCHEMES) {
		if (schemeInputs[candidateScheme] && !supportedSchemes.includes(candidateScheme)) {
			throw validationError(
				'undeclared_scheme',
				`${candidateScheme} has values but is not declared as supported`,
				{ scheme: candidateScheme }
			);
		}
	}
	const declaredSchemes = THEME_SCHEMES.filter((candidateScheme) => schemeInputs[candidateScheme]);
	if (supportedSchemes.join(',') !== declaredSchemes.join(',')) {
		throw validationError(
			'scheme_order',
			'supportedSchemes must follow the light, dark manifest order'
		);
	}
	if (!Array.isArray(value.fonts) || !Array.isArray(value.assets)) {
		throw validationError('resource_arrays', 'fonts and assets must be arrays');
	}
	if (value.fonts.length > 16 || value.assets.length > THEME_ASSET_SLOTS.length) {
		throw validationError(
			'resource_limit',
			'resources contains too many fonts or decorative assets'
		);
	}
	const manifest: ThemeManifest = {
		schemaVersion: 1,
		id: value.id,
		revision: value.revision,
		name: value.name,
		description: value.description,
		iconPack: value.iconPack,
		supportedSchemes,
		schemes,
		fonts: parseThemeFontFaces(value.fonts),
		assets: parseThemeAssets(value.assets)
	};
	validateManifestResources(manifest);
	return structuredClone(manifest);
}

function parseThemeFontFaces(values: unknown[]): ThemeFontFace[] {
	return values.map((value, index) => {
		if (
			!isThemeFontFaceInput(value) ||
			!hasExactKeys(value, themeFontFaceKeys) ||
			!isString(value.id) ||
			!identifierPattern.test(value.id) ||
			!isString(value.family) ||
			!fontFamilyPattern.test(value.family) ||
			!isString(value.sourceUrl) ||
			value.sourceUrl !== `asset:${value.id}` ||
			value.format !== 'woff2' ||
			!isFontWeight(value.weight) ||
			!isFontStyle(value.style) ||
			!isFontDisplay(value.display)
		) {
			throw validationError(
				'invalid_font',
				`fonts[${index}] contains an invalid font face or resource reference`,
				{ index }
			);
		}
		return {
			id: value.id,
			family: value.family,
			sourceUrl: value.sourceUrl,
			format: value.format,
			weight: value.weight,
			style: value.style,
			display: value.display
		};
	});
}

function parseThemeAssets(values: unknown[]): ThemeAsset[] {
	return values.map((value, index) => {
		if (!isThemeAssetInput(value)) {
			throw validationError(
				'invalid_asset',
				`assets[${index}] contains an invalid decorative asset or resource reference`,
				{ index }
			);
		}
		const expectedKeys: string[] = [...themeAssetKeys];
		if (value.alt !== undefined) expectedKeys.push('alt');
		if (
			!hasExactKeys(value, expectedKeys) ||
			!isString(value.id) ||
			!identifierPattern.test(value.id) ||
			!isThemeAssetSlot(value.slot) ||
			!isString(value.sourceUrl) ||
			value.sourceUrl !== `asset:${value.id}` ||
			!isString(value.mimeType) ||
			!supportedAssetMimeTypes.has(value.mimeType) ||
			(value.alt !== undefined && !isString(value.alt)) ||
			(isString(value.alt) && themeCodePointLength(value.alt) > 240) ||
			(value.slot.endsWith('illustration') && (!isString(value.alt) || !value.alt.trim()))
		) {
			throw validationError(
				'invalid_asset',
				`assets[${index}] contains an invalid decorative asset or resource reference`,
				{ index }
			);
		}
		const asset: ThemeAsset = {
			id: value.id,
			slot: value.slot,
			sourceUrl: value.sourceUrl,
			mimeType: value.mimeType
		};
		if (isString(value.alt)) asset.alt = value.alt;
		return asset;
	});
}

function hasExactKeys<Owner extends object>(
	value: Owner,
	expectedKeys: readonly string[]
): boolean {
	const keys = Object.keys(value).sort();
	const expected = [...expectedKeys].sort();
	return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

export function themeCodePointLength(value: string): number {
	return [...value].length;
}

export function takeThemeCodePoints(value: string, maximum: number): string {
	if (!Number.isInteger(maximum) || maximum < 0) {
		throw validationError('character_limit', 'Character limit must be a non-negative integer');
	}
	return [...value].slice(0, maximum).join('');
}

function assertExactRootKeys<Owner extends object>(value: Owner, expectedKeys: readonly string[]) {
	const actual = new Set(Object.keys(value));
	const unexpected = Object.keys(value).filter((key) => !expectedKeys.includes(key));
	if (unexpected.length > 0) {
		throw validationError(
			'unknown_fields',
			`Manifest contains unknown or missing fields: ${unexpected.join(', ')}`,
			{ fields: unexpected.join(', ') }
		);
	}
	const missing = expectedKeys.find((key) => !actual.has(key));
	if (missing)
		throw validationError('required_field', `${missing} is required`, { field: missing });
}

function validateManifestResources(manifest: ThemeManifest) {
	const resourceIDs = new Set<string>();
	const fontFaceKeys = new Set<string>();
	for (const font of manifest.fonts) {
		const faceKey = `${font.family}:${font.weight}:${font.style}`;
		if (resourceIDs.has(font.id) || fontFaceKeys.has(faceKey)) {
			throw validationError('duplicate_font', 'resources contains duplicate IDs or font faces');
		}
		resourceIDs.add(font.id);
		fontFaceKeys.add(faceKey);
	}
	const usedSlots = new Set<string>();
	for (const asset of manifest.assets) {
		if (resourceIDs.has(asset.id) || usedSlots.has(asset.slot)) {
			throw validationError('duplicate_asset', 'resources contains duplicate IDs or asset slots');
		}
		resourceIDs.add(asset.id);
		usedSlots.add(asset.slot);
	}

	for (const scheme of manifest.supportedSchemes) {
		const schemeManifest = manifest.schemes[scheme];
		if (!schemeManifest) {
			throw validationError('incomplete_scheme', `${scheme} must contain a complete manifest`, {
				scheme
			});
		}
		for (const role of THEME_TYPOGRAPHY_ROLE_KEYS) {
			const typography = schemeManifest.typography[role];
			if (
				!bundledThemeFontFamilies.has(typography.family) &&
				!manifest.fonts.some(
					(font) =>
						font.family === typography.family &&
						font.weight === typography.weight &&
						font.style === 'normal'
				)
			) {
				throw validationError(
					'missing_font_face',
					`${scheme} ${role} has no matching bundled or uploaded font face`,
					{ scheme, role }
				);
			}
		}
	}
}

export function themeEditorFingerprint(manifest: ThemeManifest): string {
	return JSON.stringify(manifest);
}

export function isThemeFontInUse(manifest: ThemeManifest, resourceID: string): boolean {
	const font = manifest.fonts.find((candidate) => candidate.id === resourceID);
	if (!font || font.style !== 'normal') return false;
	return manifest.supportedSchemes.some((scheme) => {
		const schemeManifest = manifest.schemes[scheme];
		if (!schemeManifest) return false;
		return THEME_TYPOGRAPHY_ROLE_KEYS.some((role) => {
			const typography = schemeManifest.typography[role];
			return typography.family === font.family && typography.weight === font.weight;
		});
	});
}

const randomPalettes = [
	{
		focal: '#155EEF',
		focalInk: '#FFFFFF',
		focalHover: '#004EEB',
		focalActive: '#0040C1',
		selection: '#D1E0FF',
		selectionInk: '#00359E',
		focus: '#111827',
		link: '#155EEF',
		linkHover: '#004EEB',
		chart1: '#155EEF',
		chart2: '#004EEB'
	},
	{
		focal: '#087E8B',
		focalInk: '#FFFFFF',
		focalHover: '#066B76',
		focalActive: '#055761',
		selection: '#C5F0F3',
		selectionInk: '#064F57',
		focus: '#111827',
		link: '#087E8B',
		linkHover: '#066B76',
		chart1: '#087E8B',
		chart2: '#066B76'
	},
	{
		focal: '#A23E48',
		focalInk: '#FFFFFF',
		focalHover: '#8D3540',
		focalActive: '#742A33',
		selection: '#F6D8DC',
		selectionInk: '#6A2530',
		focus: '#111827',
		link: '#A23E48',
		linkHover: '#8D3540',
		chart1: '#A23E48',
		chart2: '#8D3540'
	},
	{
		focal: '#5F4BB6',
		focalInk: '#FFFFFF',
		focalHover: '#503F9E',
		focalActive: '#413382',
		selection: '#E2DDFC',
		selectionInk: '#382C72',
		focus: '#111827',
		link: '#5F4BB6',
		linkHover: '#503F9E',
		chart1: '#5F4BB6',
		chart2: '#503F9E'
	}
] as const;

const darkRandomPalettes = [
	{
		focal: 'oklch(0.82 0.2 125)',
		focalInk: 'oklch(0.12 0.03 125)',
		focalHover: 'color-mix(in oklch, oklch(0.82 0.2 125) 90%, oklch(0.91 0.01 110))',
		focalActive: 'color-mix(in oklch, oklch(0.82 0.2 125) 82%, oklch(0.91 0.01 110))',
		selection: 'oklch(0.3 0.09 125)',
		selectionInk: 'oklch(0.9 0.09 125)',
		focus: 'oklch(0.91 0.01 110)',
		link: 'oklch(0.78 0.14 210)',
		linkHover: 'color-mix(in oklch, oklch(0.78 0.14 210) 82%, oklch(0.91 0.01 110))',
		chart1: 'oklch(0.82 0.2 125)',
		chart2: 'oklch(0.74 0.14 210)'
	},
	{
		focal: 'oklch(0.762 0.154 159)',
		focalInk: 'oklch(0.182 0 90)',
		focalHover: 'oklch(0.668 0.139 159)',
		focalActive: 'oklch(0.606 0.122 161)',
		selection: 'oklch(0.273 0.024 164)',
		selectionInk: 'oklch(0.985 0 90)',
		focus: 'oklch(0.724 0.178 155)',
		link: 'oklch(0.724 0.178 155)',
		linkHover: 'color-mix(in oklch, oklch(0.724 0.178 155) 82%, oklch(0.985 0 90))',
		chart1: 'oklch(0.762 0.154 159)',
		chart2: 'oklch(0.724 0.178 155)'
	},
	{
		focal: 'oklch(0.51 0.19 30)',
		focalInk: 'oklch(1 0 0)',
		focalHover: 'oklch(0.45 0.17 29)',
		focalActive: 'oklch(0.40 0.15 28)',
		selection: 'oklch(0.24 0 0)',
		selectionInk: 'oklch(1 0 0)',
		focus: 'oklch(1 0 0)',
		link: 'oklch(1 0 0)',
		linkHover: 'oklch(0.82 0 0)',
		chart1: 'oklch(0.55 0.19 30)',
		chart2: 'oklch(0.70 0 0)'
	},
	{
		focal: 'oklch(0.52 0.21 275)',
		focalInk: 'oklch(0.98 0 0)',
		focalHover: 'oklch(0.52 0.23 272)',
		focalActive: 'oklch(0.46 0.21 276)',
		selection: 'oklch(0.32 0.09 275)',
		selectionInk: 'oklch(0.96 0.005 285)',
		focus: 'oklch(0.66 0.16 278)',
		link: 'oklch(0.66 0.16 278)',
		linkHover: 'color-mix(in oklch, oklch(0.66 0.16 278) 82%, oklch(0.98 0 0))',
		chart1: 'oklch(0.52 0.21 275)',
		chart2: 'oklch(0.66 0.16 278)'
	}
] as const;

export function randomizeThemeManifest(
	manifest: ThemeManifest,
	scheme: ThemeScheme,
	seed: number,
	section?: ThemeEditorSection
): ThemeManifest {
	if (!Number.isSafeInteger(seed)) {
		throw validationError('random_seed', 'Randomization seed must be a safe integer');
	}
	const next = structuredClone(manifest);
	const target = next.schemes[scheme];
	if (!target) {
		throw validationError('scheme_unsupported', `${scheme} is not supported by ${manifest.name}`, {
			scheme,
			name: manifest.name
		});
	}
	const random = seededRandom(seed);
	const shouldChange = (candidate: ThemeEditorSection) =>
		section === undefined || section === candidate;

	if (shouldChange('colors')) {
		const palettes = scheme === 'dark' ? darkRandomPalettes : randomPalettes;
		const start = Math.floor(random() * palettes.length);
		for (let offset = 0; offset < palettes.length; offset += 1) {
			const palette = palettes[(start + offset) % palettes.length]!;
			const colors = {
				...target.colors,
				actionFocal: palette.focal,
				actionFocalInk: palette.focalInk,
				actionFocalHover: palette.focalHover,
				actionFocalActive: palette.focalActive,
				actionPrimary: palette.focal,
				actionPrimaryInk: palette.focalInk,
				actionPrimaryHover: palette.focalHover,
				actionPrimaryActive: palette.focalActive,
				selection: palette.selection,
				selectionInk: palette.selectionInk,
				focus: palette.focus,
				link: palette.link,
				actionLink: palette.link,
				actionLinkHover: palette.linkHover,
				chart1: palette.chart1,
				chart2: palette.chart2
			};
			if (!isCompleteThemeSchemeManifest({ ...target, colors }, scheme)) continue;
			target.colors = colors;
			break;
		}
	}
	if (shouldChange('typography')) {
		const headingWeights = [500, 600, 700] as const;
		const headingWeight = headingWeights[Math.floor(random() * headingWeights.length)]!;
		const headingTracking = ['-0.01em', '-0.02em', '-0.03em'][Math.floor(random() * 3)]!;
		for (const role of ['display', 'title', 'label'] as const) {
			const typography = target.typography[role];
			const availableWeights = next.fonts
				.filter((font) => font.family === typography.family && font.style === 'normal')
				.map((font) => font.weight);
			typography.weight = bundledThemeFontFamilies.has(typography.family)
				? headingWeight
				: (availableWeights[Math.floor(random() * availableWeights.length)] ?? typography.weight);
			if (role !== 'label') typography.tracking = headingTracking;
		}
	}
	if (shouldChange('spacing')) {
		const densities = ['compact', 'comfortable', 'spacious'] as const;
		target.spacing.density = densities[Math.floor(random() * densities.length)]!;
		target.spacing.componentGap = ['0.5rem', '0.75rem', '1rem'][Math.floor(random() * 3)]!;
	}
	if (shouldChange('shape')) {
		const radius = ['0.375rem', '0.625rem', '0.875rem'][Math.floor(random() * 3)]!;
		target.shape.radius = radius;
		target.shape.radiusMd = radius;
		target.shape.radiusLg = ['0.75rem', '1rem', '1.25rem'][Math.floor(random() * 3)]!;
	}
	if (shouldChange('elevation')) {
		target.elevation.card = [
			'none',
			'0 8px 22px -16px rgb(0 0 0 / 0.28)',
			'0 12px 30px -20px rgb(0 0 0 / 0.34)'
		][Math.floor(random() * 3)]!;
	}
	if (shouldChange('motion')) {
		const fast = [80, 100, 120][Math.floor(random() * 3)]!;
		for (const [recipe, offset] of [
			['press', 0],
			['hover', 20],
			['selection', 40],
			['entry', 100],
			['exit', 60],
			['loading', 320],
			['pageTransition', 160]
		] as const) {
			target.motion[recipe].duration = `${fast + offset}ms`;
		}
	}
	if (shouldChange('shell')) {
		const treatments = [
			'plain',
			'paper',
			'playful',
			'garden',
			'study',
			'tactile',
			'precision'
		] as const;
		target.shell.canvasTreatment = treatments[Math.floor(random() * treatments.length)]!;
	}
	if (shouldChange('components')) {
		const button = ['solid', 'tonal', 'outlined', 'precise', 'pill'] as const;
		const card = ['flat', 'outlined', 'paper', 'lifted'] as const;
		target.components.button = button[Math.floor(random() * button.length)]!;
		target.components.card = card[Math.floor(random() * card.length)]!;
		target.components.container = ['flat', 'outlined', 'tinted'][Math.floor(random() * 3)]!;
		target.components.tabs = ['underline', 'pill', 'segmented'][Math.floor(random() * 3)]!;
		target.components.navigation = ['quiet', 'tonal', 'outlined'][Math.floor(random() * 3)]!;
		target.components.table = ['ruled', 'striped', 'plain'][Math.floor(random() * 3)]!;
		target.components.emptyState = ['plain', 'illustrated', 'framed'][Math.floor(random() * 3)]!;
		target.components.loadingState = ['spinner', 'pulse', 'skeleton'][Math.floor(random() * 3)]!;
	}
	return next;
}

function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state += 0x6d2b79f5;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}
