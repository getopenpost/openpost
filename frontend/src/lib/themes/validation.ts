import {
	THEME_COLOR_TOKEN_KEYS,
	THEME_MOTION_RECIPE_KEYS,
	THEME_TYPOGRAPHY_ROLE_KEYS,
	type ThemeMotionRecipe,
	type ThemeSchemeManifest
} from './contracts.js';

const CSS_LENGTH_PATTERN =
	/^(?:0|-?[0-9]+(?:\.[0-9]+)?(?:px|rem|em|%|vw|vh)|clamp\([0-9a-zA-Z.%+/, -]+\))$/;
const CSS_TIME_PATTERN = /^[0-9]+(?:\.[0-9]+)?(?:ms|s)$/;
const CSS_TRACKING_PATTERN = /^-?[0-9]+(?:\.[0-9]+)?(?:px|rem|em)$/;
const CSS_EASING_PATTERN =
	/^(?:linear|ease|ease-in|ease-out|ease-in-out|cubic-bezier\([0-9., -]+\))$/;
const FONT_FAMILY_PATTERN = /^[a-zA-Z0-9 _.,:'-]+$/;
const LINE_HEIGHT_PATTERN = /^[0-9]+(?:\.[0-9]+)?$/;
const COLOR_FUNCTION_PREFIXES = [
	'rgb(',
	'rgba(',
	'hsl(',
	'hsla(',
	'oklch(',
	'oklab(',
	'color-mix('
];
const COLOR_CHARACTERS_PATTERN = /^[ #(),.%+/_\-0-9a-zA-Z]+$/;
const SHADOW_CHARACTERS_PATTERN = /^[ #(),.%+/_\-0-9a-zA-Z]+$/;
const LENGTH_PART_PATTERN = /(-?[0-9]+(?:\.[0-9]+)?)(px|rem|em|%|vw|vh)/g;

const SAFE_FONT_FALLBACKS = new Set([
	'Arial',
	'BlinkMacSystemFont',
	'Consolas',
	'Courier New',
	'DM Sans',
	'Geist',
	'Geist Mono',
	'Georgia',
	'Helvetica',
	'Inter',
	'Inter Tight',
	'Manrope',
	'Menlo',
	'Monaco',
	'Segoe UI',
	'SFMono-Regular',
	'Source Serif 4',
	'Times New Roman',
	'-apple-system',
	'monospace',
	'sans-serif',
	'serif',
	'system-ui',
	'ui-monospace',
	'ui-serif'
]);

function hasBalancedParentheses(value: string): boolean {
	let depth = 0;
	for (const character of value) {
		if (character === '(') depth += 1;
		if (character === ')') depth -= 1;
		if (depth < 0) return false;
	}
	return depth === 0;
}

export function isSafeThemeCssValue(value: string): boolean {
	const lower = value.toLowerCase();
	return (
		value.length > 0 &&
		value.length <= 512 &&
		!lower.includes('url(') &&
		!/[;{}<>@\r\n]/.test(value) &&
		hasBalancedParentheses(value)
	);
}

export function isSafeThemeColor(value: string): boolean {
	if (!isSafeThemeCssValue(value)) return false;
	if (value === 'transparent' || value === 'black' || value === 'white') return true;
	if (/^#[0-9a-fA-F]{3,4}$|^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{8}$/.test(value)) return true;
	return (
		COLOR_FUNCTION_PREFIXES.some((prefix) => value.startsWith(prefix)) &&
		COLOR_CHARACTERS_PATTERN.test(value)
	);
}

function cssLengthParts(value: string): number[] | undefined {
	if (value === '0') return [0];
	const parts = [...value.matchAll(LENGTH_PART_PATTERN)].map((match) => {
		const number = Number(match[1]);
		return match[2] === 'rem' || match[2] === 'em' ? number * 16 : number;
	});
	return parts.length > 0 ? parts : undefined;
}

function isBoundedCssLength(value: string, maximum: number, allowNegative = false): boolean {
	if (!CSS_LENGTH_PATTERN.test(value) || !isSafeThemeCssValue(value)) return false;
	const parts = cssLengthParts(value);
	return Boolean(
		parts &&
		parts.every(
			(part) => Number.isFinite(part) && Math.abs(part) <= maximum && (allowNegative || part >= 0)
		)
	);
}

function cssPixels(value: string): number | undefined {
	if (value === '0') return 0;
	const match = /^(-?[0-9]+(?:\.[0-9]+)?)(px|rem|em)$/.exec(value);
	if (!match) return undefined;
	const number = Number(match[1]);
	return match[2] === 'rem' || match[2] === 'em' ? number * 16 : number;
}

function cssMilliseconds(value: string): number | undefined {
	if (!CSS_TIME_PATTERN.test(value)) return undefined;
	const number = Number.parseFloat(value);
	return value.endsWith('ms') ? number : number * 1000;
}

function isSafeShadow(value: string): boolean {
	return (
		value === 'none' ||
		(value.length <= 256 && isSafeThemeCssValue(value) && SHADOW_CHARACTERS_PATTERN.test(value))
	);
}

function isSafeTypography(manifest: ThemeSchemeManifest): boolean {
	return THEME_TYPOGRAPHY_ROLE_KEYS.every((key) => {
		const role = manifest.typography[key];
		const lineHeight = Number(role.lineHeight);
		const tracking = cssPixels(role.tracking);
		return (
			FONT_FAMILY_PATTERN.test(role.family) &&
			isSafeThemeCssValue(role.family) &&
			role.fallbacks.length >= 1 &&
			role.fallbacks.length <= 8 &&
			new Set(role.fallbacks).size === role.fallbacks.length &&
			role.fallbacks.every((fallback) => SAFE_FONT_FALLBACKS.has(fallback)) &&
			isBoundedCssLength(role.size, 256) &&
			LINE_HEIGHT_PATTERN.test(role.lineHeight) &&
			lineHeight >= 1 &&
			lineHeight <= 2.5 &&
			CSS_TRACKING_PATTERN.test(role.tracking) &&
			tracking !== undefined &&
			Math.abs(tracking) <= 64
		);
	});
}

function isSafeMotionRecipe(
	recipe: ThemeMotionRecipe,
	minimumOpacity: number,
	maximumDistance: number
): boolean {
	const duration = cssMilliseconds(recipe.duration);
	const distance = cssPixels(recipe.distance);
	return (
		duration !== undefined &&
		duration >= 0 &&
		duration <= 2000 &&
		CSS_EASING_PATTERN.test(recipe.easing) &&
		isSafeThemeCssValue(recipe.easing) &&
		distance !== undefined &&
		distance >= 0 &&
		distance <= maximumDistance &&
		recipe.opacity >= minimumOpacity &&
		recipe.opacity <= 1
	);
}

export function isSafeThemeSchemeManifestValues(manifest: ThemeSchemeManifest): boolean {
	const spacing = manifest.spacing;
	const shape = manifest.shape;
	const shell = manifest.shell;
	const motionBounds = {
		press: [0.5, 4],
		hover: [0.5, 16],
		selection: [0.5, 16],
		entry: [0, 64],
		exit: [0, 64],
		loading: [0.1, 16],
		pageTransition: [0, 64]
	} as const;
	const controlHeight = cssPixels(spacing.controlHeight);
	const compactControlHeight = cssPixels(spacing.compactControlHeight);
	const touchTarget = cssPixels(spacing.touchTarget);
	const borderWidth = cssPixels(shape.borderWidth);

	return (
		THEME_COLOR_TOKEN_KEYS.every((key) => isSafeThemeColor(manifest.colors[key])) &&
		isSafeTypography(manifest) &&
		isBoundedCssLength(spacing.base, 64) &&
		isBoundedCssLength(spacing.controlHeight, 96) &&
		isBoundedCssLength(spacing.compactControlHeight, 96) &&
		isBoundedCssLength(spacing.touchTarget, 96) &&
		isBoundedCssLength(spacing.pageGutter, 256) &&
		isBoundedCssLength(spacing.sectionGap, 256) &&
		isBoundedCssLength(spacing.componentGap, 256) &&
		controlHeight !== undefined &&
		controlHeight >= 36 &&
		compactControlHeight !== undefined &&
		compactControlHeight >= 32 &&
		touchTarget !== undefined &&
		touchTarget >= 44 &&
		isBoundedCssLength(shape.radius, 256) &&
		isBoundedCssLength(shape.radiusSm, 256) &&
		isBoundedCssLength(shape.radiusMd, 256) &&
		isBoundedCssLength(shape.radiusLg, 256) &&
		isBoundedCssLength(shape.radiusMedia, 256) &&
		isBoundedCssLength(shape.radiusPill, 10_000) &&
		borderWidth !== undefined &&
		borderWidth >= 1 &&
		borderWidth <= 4 &&
		Object.values(manifest.elevation).every(isSafeShadow) &&
		THEME_MOTION_RECIPE_KEYS.every((key) =>
			isSafeMotionRecipe(manifest.motion[key], ...motionBounds[key])
		) &&
		isBoundedCssLength(shell.contentMaxWidth, 4096) &&
		isBoundedCssLength(shell.sidebarWidth, 1024) &&
		isBoundedCssLength(shell.headerHeight, 256) &&
		isBoundedCssLength(shell.mobileNavigationHeight, 256)
	);
}
