import {
	BUNDLED_THEME_FONT_FAMILIES,
	THEME_ASSET_SLOTS,
	THEME_ICON_PACK_IDS,
	THEME_TYPOGRAPHY_ROLE_KEYS,
	isCompleteThemeSchemeManifest,
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
	if (!schemeManifest) throw new Error(`${scheme} is not supported by ${manifest.name}`);
	(schemeManifest[section][key] as ThemeSchemeManifest[Section][Key]) = value;
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
	if (!sourceScheme || !targetScheme) throw new Error(`${scheme} is not available in both themes`);
	targetScheme[section] = structuredClone(sourceScheme[section]) as never;
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
		throw new Error('Theme ID must use lowercase letters, numbers, and hyphens');
	}
	if (normalizedName.length === 0 || themeCodePointLength(normalizedName) > 80) {
		throw new Error('Theme name must contain 1 to 80 characters');
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

export function parseThemeManifest(source: string): ThemeManifest {
	if (new TextEncoder().encode(source).byteLength > 256 * 1024) {
		throw new Error('Manifest must be no larger than 256 KiB');
	}
	let candidate: unknown;
	try {
		candidate = JSON.parse(source);
	} catch (error) {
		throw new Error(error instanceof Error ? error.message : 'Manifest is not valid JSON');
	}
	if (!candidate || typeof candidate !== 'object') throw new Error('Manifest must be an object');
	const value = candidate as Partial<ThemeManifest>;
	const rootKeys = [
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
	];
	assertExactRootKeys(value, rootKeys);
	if (value.schemaVersion !== 1) throw new Error('schemaVersion must be 1');
	if (typeof value.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value.id)) {
		throw new Error('id must be a stable identifier');
	}
	if (
		typeof value.revision !== 'string' ||
		value.revision.length > 128 ||
		!/^[a-zA-Z0-9][a-zA-Z0-9 _.-]*$/.test(value.revision)
	) {
		throw new Error('revision must be a stable identifier');
	}
	if (
		typeof value.name !== 'string' ||
		value.name.trim() === '' ||
		themeCodePointLength(value.name) > 80
	) {
		throw new Error('name must contain 1 to 80 characters');
	}
	if (typeof value.description !== 'string' || themeCodePointLength(value.description) > 240) {
		throw new Error('description must contain at most 240 characters');
	}
	if (!THEME_ICON_PACK_IDS.includes(value.iconPack as (typeof THEME_ICON_PACK_IDS)[number])) {
		throw new Error('iconPack is not supported');
	}
	if (!Array.isArray(value.supportedSchemes) || value.supportedSchemes.length === 0) {
		throw new Error('supportedSchemes must include light or dark');
	}
	const uniqueSchemes = new Set<ThemeScheme>();
	for (const scheme of value.supportedSchemes) {
		if (scheme !== 'light' && scheme !== 'dark')
			throw new Error(`${String(scheme)} is not a supported scheme`);
		if (uniqueSchemes.has(scheme)) throw new Error(`${scheme} is listed more than once`);
		uniqueSchemes.add(scheme);
		if (!isCompleteThemeSchemeManifest(value.schemes?.[scheme], scheme)) {
			throw new Error(`${scheme} must contain a complete manifest`);
		}
	}
	for (const scheme of ['light', 'dark'] as const) {
		if (value.schemes?.[scheme] && !uniqueSchemes.has(scheme)) {
			throw new Error(`${scheme} has values but is not declared as supported`);
		}
	}
	const declaredSchemes = ['light', 'dark'].filter(
		(scheme) => value.schemes?.[scheme as ThemeScheme]
	);
	if (value.supportedSchemes.join(',') !== declaredSchemes.join(',')) {
		throw new Error('supportedSchemes must follow the light, dark manifest order');
	}
	if (!Array.isArray(value.fonts) || !Array.isArray(value.assets)) {
		throw new Error('fonts and assets must be arrays');
	}
	validateManifestResources(value as ThemeManifest);
	return structuredClone(value as ThemeManifest);
}

const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const fontFamilyPattern = /^[a-zA-Z0-9 _.,:'-]+$/;
const supportedAssetMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif']);
const bundledThemeFontFamilies = new Set<string>(BUNDLED_THEME_FONT_FAMILIES);

function hasExactKeys(value: object, expectedKeys: string[]): boolean {
	const keys = Object.keys(value).sort();
	const expected = [...expectedKeys].sort();
	return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

export function themeCodePointLength(value: string): number {
	return [...value].length;
}

export function takeThemeCodePoints(value: string, maximum: number): string {
	if (!Number.isInteger(maximum) || maximum < 0) {
		throw new Error('Character limit must be a non-negative integer');
	}
	return [...value].slice(0, maximum).join('');
}

function assertExactRootKeys(value: object, expectedKeys: string[]) {
	const actual = new Set(Object.keys(value));
	const unexpected = Object.keys(value).filter((key) => !expectedKeys.includes(key));
	if (unexpected.length > 0) {
		throw new Error(`Manifest contains unknown or missing fields: ${unexpected.join(', ')}`);
	}
	const missing = expectedKeys.find((key) => !actual.has(key));
	if (missing) throw new Error(`${missing} is required`);
}

function validateManifestResources(manifest: ThemeManifest) {
	if (manifest.fonts.length > 16 || manifest.assets.length > THEME_ASSET_SLOTS.length) {
		throw new Error('resources contains too many fonts or decorative assets');
	}
	const resourceIDs = new Set<string>();
	const fontFaceKeys = new Set<string>();
	for (const [index, font] of manifest.fonts.entries()) {
		if (
			!font ||
			!hasExactKeys(font, ['id', 'family', 'sourceUrl', 'format', 'weight', 'style', 'display']) ||
			!identifierPattern.test(font.id) ||
			!fontFamilyPattern.test(font.family) ||
			font.sourceUrl !== `asset:${font.id}` ||
			font.format !== 'woff2' ||
			!Number.isInteger(font.weight) ||
			font.weight < 100 ||
			font.weight > 900 ||
			font.weight % 100 !== 0 ||
			!['normal', 'italic'].includes(font.style) ||
			!['swap', 'fallback', 'optional'].includes(font.display)
		) {
			throw new Error(`fonts[${index}] contains an invalid font face or resource reference`);
		}
		const faceKey = `${font.family}:${font.weight}:${font.style}`;
		if (resourceIDs.has(font.id) || fontFaceKeys.has(faceKey)) {
			throw new Error('resources contains duplicate IDs or font faces');
		}
		resourceIDs.add(font.id);
		fontFaceKeys.add(faceKey);
	}
	const usedSlots = new Set<string>();
	for (const [index, asset] of manifest.assets.entries()) {
		if (
			!asset ||
			!hasExactKeys(asset, [
				'id',
				'slot',
				'sourceUrl',
				'mimeType',
				...(asset.alt === undefined ? [] : ['alt'])
			]) ||
			!identifierPattern.test(asset.id) ||
			asset.sourceUrl !== `asset:${asset.id}` ||
			!THEME_ASSET_SLOTS.includes(asset.slot) ||
			!supportedAssetMimeTypes.has(asset.mimeType) ||
			(asset.alt !== undefined && typeof asset.alt !== 'string') ||
			(asset.alt ? themeCodePointLength(asset.alt) : 0) > 240 ||
			(asset.slot.endsWith('illustration') && !asset.alt?.trim())
		) {
			throw new Error(
				`assets[${index}] contains an invalid decorative asset or resource reference`
			);
		}
		if (resourceIDs.has(asset.id) || usedSlots.has(asset.slot)) {
			throw new Error('resources contains duplicate IDs or asset slots');
		}
		resourceIDs.add(asset.id);
		usedSlots.add(asset.slot);
	}

	for (const scheme of manifest.supportedSchemes) {
		const schemeManifest = manifest.schemes[scheme]!;
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
				throw new Error(`${scheme} ${role} has no matching bundled or uploaded font face`);
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
		selectionInk: '#00359E'
	},
	{
		focal: '#087E8B',
		focalInk: '#FFFFFF',
		focalHover: '#066B76',
		focalActive: '#055761',
		selection: '#C5F0F3',
		selectionInk: '#064F57'
	},
	{
		focal: '#A23E48',
		focalInk: '#FFFFFF',
		focalHover: '#8D3540',
		focalActive: '#742A33',
		selection: '#F6D8DC',
		selectionInk: '#6A2530'
	},
	{
		focal: '#5F4BB6',
		focalInk: '#FFFFFF',
		focalHover: '#503F9E',
		focalActive: '#413382',
		selection: '#E2DDFC',
		selectionInk: '#382C72'
	}
] as const;

export function randomizeThemeManifest(
	manifest: ThemeManifest,
	scheme: ThemeScheme,
	seed: number,
	section?: ThemeEditorSection
): ThemeManifest {
	if (!Number.isSafeInteger(seed)) throw new Error('Randomization seed must be a safe integer');
	const next = structuredClone(manifest);
	const target = next.schemes[scheme];
	if (!target) throw new Error(`${scheme} is not supported by ${manifest.name}`);
	const random = seededRandom(seed);
	const shouldChange = (candidate: ThemeEditorSection) =>
		section === undefined || section === candidate;

	if (shouldChange('colors')) {
		const palette = randomPalettes[Math.floor(random() * randomPalettes.length)]!;
		target.colors = {
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
			focus: palette.focal,
			link: palette.focal,
			actionLink: palette.focal,
			actionLinkHover: palette.focalHover,
			chart1: palette.focal,
			chart2: palette.focalHover
		};
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
		const button = ['solid', 'tonal', 'outlined', 'precise'] as const;
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
