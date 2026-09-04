import { convert, isColor } from '@asamuzakjp/css-color';
import {
	THEME_COLOR_TOKEN_KEYS,
	THEME_MOTION_RECIPE_KEYS,
	THEME_REDUCED_MOTION_OPTIONS,
	THEME_TYPOGRAPHY_ROLE_KEYS,
	type ThemeColorTokens,
	type ThemeMotionRecipe,
	type ThemeSchemeManifest
} from './contracts.js';

const CSS_TIME_PATTERN = /^[0-9]+(?:\.[0-9]+)?(?:ms|s)$/;
const CSS_LENGTH_PATTERN = /^(-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+))(px|rem|em|%|vw|vh)$/;
const CSS_TRACKING_PATTERN = /^(-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+))(px|rem|em)$/;
const CSS_CUBIC_BEZIER_PATTERN =
	/^cubic-bezier\(\s*(-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+))\s*,\s*(-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+))\s*,\s*(-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+))\s*,\s*(-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+))\s*\)$/;
const FONT_FAMILY_PATTERN = /^[a-zA-Z0-9 _.,:'-]+$/;
const LINE_HEIGHT_PATTERN = /^[0-9]+(?:\.[0-9]+)?$/;
const NAMED_EASINGS = new Set(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out']);
const STATUS_COLOR_KEYS = ['danger', 'success', 'warning', 'info'] as const;
const MINIMUM_STATUS_COLOR_DISTANCE = 0.04;
const MINIMUM_SEMANTIC_ACTION_DISTANCE = 0.014;
const MINIMUM_TEXT_CONTRAST = 4.5;
const MINIMUM_FOCUS_CONTRAST = 3;

interface ParsedCssLength {
	value: number;
	unit: 'px' | 'rem' | 'em' | '%' | 'vw' | 'vh';
}

interface RgbaColor {
	red: number;
	green: number;
	blue: number;
	alpha: number;
}

const readableColorPairs = [
	['ink', 'canvas', 'canvas', MINIMUM_TEXT_CONTRAST],
	['mutedInk', 'canvas', 'canvas', MINIMUM_TEXT_CONTRAST],
	['ink', 'surface', 'canvas', MINIMUM_TEXT_CONTRAST],
	['ink', 'surfaceRaised', 'canvas', MINIMUM_TEXT_CONTRAST],
	['ink', 'surfaceSunken', 'canvas', MINIMUM_TEXT_CONTRAST],
	['selectionInk', 'selection', 'canvas', MINIMUM_TEXT_CONTRAST],
	['brandInk', 'brand', 'canvas', MINIMUM_TEXT_CONTRAST],
	['workspaceInk', 'workspace', 'canvas', MINIMUM_TEXT_CONTRAST],
	['dangerInk', 'danger', 'canvas', MINIMUM_TEXT_CONTRAST],
	['successInk', 'success', 'canvas', MINIMUM_TEXT_CONTRAST],
	['warningInk', 'warning', 'canvas', MINIMUM_TEXT_CONTRAST],
	['infoInk', 'info', 'canvas', MINIMUM_TEXT_CONTRAST],
	['fieldInk', 'field', 'canvas', MINIMUM_TEXT_CONTRAST],
	['fieldInk', 'fieldHover', 'canvas', MINIMUM_TEXT_CONTRAST],
	['fieldInk', 'fieldFocus', 'canvas', MINIMUM_TEXT_CONTRAST],
	['fieldDisabledInk', 'fieldDisabled', 'canvas', MINIMUM_TEXT_CONTRAST],
	['disabledInk', 'disabled', 'canvas', MINIMUM_TEXT_CONTRAST],
	['navigationActiveInk', 'navigationActive', 'canvas', MINIMUM_TEXT_CONTRAST],
	['sidebarInk', 'sidebar', 'canvas', MINIMUM_TEXT_CONTRAST],
	['sidebarActiveInk', 'sidebarActive', 'sidebar', MINIMUM_TEXT_CONTRAST],
	['chromeInk', 'chrome', 'canvas', MINIMUM_TEXT_CONTRAST]
] as const satisfies readonly (readonly [
	keyof ThemeColorTokens,
	keyof ThemeColorTokens,
	keyof ThemeColorTokens,
	number
])[];

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
	return (
		isSafeThemeCssValue(value) &&
		isColor(value) &&
		convert.colorToHex(value, { alpha: true }) !== null
	);
}

function parseSimpleCssLength(value: string): ParsedCssLength | undefined {
	if (value === '0') return { value: 0, unit: 'px' };
	const match = CSS_LENGTH_PATTERN.exec(value);
	if (!match) return undefined;
	const number = Number(match[1]);
	if (!Number.isFinite(number)) return undefined;
	return {
		value: number,
		// SAFETY: CSS_LENGTH_PATTERN restricts this capture to ParsedCssLength units.
		unit: match[2] as ParsedCssLength['unit']
	};
}

function isParsedCssLength(value: ParsedCssLength | undefined): value is ParsedCssLength {
	return value !== undefined;
}

function parseCssLength(value: string): readonly ParsedCssLength[] | undefined {
	const simple = parseSimpleCssLength(value);
	if (simple) return [simple];
	if (!value.startsWith('clamp(') || !value.endsWith(')')) return undefined;
	const parts = value
		.slice('clamp('.length, -1)
		.split(',')
		.map((part) => parseSimpleCssLength(part.trim()));
	if (parts.length !== 3 || !parts.every(isParsedCssLength)) return undefined;
	return parts;
}

function absolutePixels(length: ParsedCssLength): number | undefined {
	if (length.unit === 'px') return length.value;
	if (length.unit === 'rem' || length.unit === 'em') return length.value * 16;
	return undefined;
}

function isBoundedCssLength(value: string, maximum: number, allowNegative = false): boolean {
	if (!isSafeThemeCssValue(value)) return false;
	const lengths = parseCssLength(value);
	if (!lengths) return false;
	if (
		lengths.some(
			(length) =>
				Math.abs(absolutePixels(length) ?? length.value) > maximum ||
				(!allowNegative && length.value < 0) ||
				((length.unit === '%' || length.unit === 'vw' || length.unit === 'vh') &&
					Math.abs(length.value) > 100)
		)
	) {
		return false;
	}
	if (lengths.length === 3) {
		const minimum = absolutePixels(lengths[0]!);
		const maximumValue = absolutePixels(lengths[2]!);
		return minimum !== undefined && maximumValue !== undefined && minimum <= maximumValue;
	}
	return true;
}

function cssPixels(value: string): number | undefined {
	const length = parseSimpleCssLength(value);
	return length ? absolutePixels(length) : undefined;
}

function minimumCssPixels(value: string): number | undefined {
	const lengths = parseCssLength(value);
	return lengths ? absolutePixels(lengths[0]!) : undefined;
}

function cssMilliseconds(value: string): number | undefined {
	if (!CSS_TIME_PATTERN.test(value)) return undefined;
	const number = Number.parseFloat(value);
	return value.endsWith('ms') ? number : number * 1000;
}

function splitCssWhitespace(value: string): string[] | undefined {
	const parts: string[] = [];
	let current = '';
	let depth = 0;
	for (const character of value) {
		if (character === '(') depth += 1;
		if (character === ')') depth -= 1;
		if (depth < 0 || (character === ',' && depth === 0)) return undefined;
		if (/\s/.test(character) && depth === 0) {
			if (current) parts.push(current);
			current = '';
			continue;
		}
		current += character;
	}
	if (depth !== 0) return undefined;
	if (current) parts.push(current);
	return parts;
}

function isSafeShadowColor(value: string): boolean {
	if (isSafeThemeColor(value)) return true;
	if (!value.includes('var(--action-focal)') || /var\((?!--action-focal\))/.test(value)) {
		return false;
	}
	return isSafeThemeColor(value.replaceAll('var(--action-focal)', 'black'));
}

function isSafeShadow(value: string): boolean {
	if (value === 'none') return true;
	if (value.length > 256 || !isSafeThemeCssValue(value)) return false;
	const parts = splitCssWhitespace(value);
	if (!parts) return false;
	if (parts[0] === 'inset') parts.shift();
	if (parts.length < 3 || parts.length > 5) return false;
	const color = parts.pop();
	if (!color || !isSafeShadowColor(color)) return false;
	const lengths = parts.map(parseSimpleCssLength);
	if (!lengths.every(isParsedCssLength)) return false;
	const [offsetX, offsetY, blur, spread] = lengths;
	if (!offsetX || !offsetY || (blur && blur.value < 0)) return false;
	return [offsetX, offsetY, blur, spread].every((length) => {
		if (!length) return true;
		const pixels = absolutePixels(length);
		return pixels !== undefined && Math.abs(pixels) <= 256;
	});
}

function isSafeTypography(manifest: ThemeSchemeManifest): boolean {
	const minimumSizes = {
		display: 24,
		title: 18,
		body: 14,
		label: 12,
		metadata: 11,
		code: 12
	} as const;
	return THEME_TYPOGRAPHY_ROLE_KEYS.every((key) => {
		const role = manifest.typography[key];
		const lineHeight = Number(role.lineHeight);
		const tracking = CSS_TRACKING_PATTERN.exec(role.tracking);
		const trackingValue = Number(tracking?.[1]);
		const trackingUnit = tracking?.[2];
		const hasSafeTracking =
			Number.isFinite(trackingValue) &&
			(trackingUnit === 'px'
				? trackingValue >= -1 && trackingValue <= 3
				: trackingValue >= -0.04 && trackingValue <= 0.2);
		return (
			FONT_FAMILY_PATTERN.test(role.family) &&
			isSafeThemeCssValue(role.family) &&
			role.fallbacks.length >= 1 &&
			role.fallbacks.length <= 8 &&
			new Set(role.fallbacks).size === role.fallbacks.length &&
			role.fallbacks.every((fallback) => SAFE_FONT_FALLBACKS.has(fallback)) &&
			isBoundedCssLength(role.size, 256) &&
			(minimumCssPixels(role.size) ?? 0) >= minimumSizes[key] &&
			LINE_HEIGHT_PATTERN.test(role.lineHeight) &&
			lineHeight >= 1 &&
			lineHeight <= 2.5 &&
			hasSafeTracking
		);
	});
}

function isSafeEasing(value: string): boolean {
	if (NAMED_EASINGS.has(value)) return true;
	const match = CSS_CUBIC_BEZIER_PATTERN.exec(value);
	if (!match) return false;
	const values = match.slice(1).map(Number);
	return (
		values.every((number) => Number.isFinite(number) && number >= -10 && number <= 10) &&
		values[0]! >= 0 &&
		values[0]! <= 1 &&
		values[2]! >= 0 &&
		values[2]! <= 1
	);
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
		isSafeEasing(recipe.easing) &&
		distance !== undefined &&
		distance >= 0 &&
		distance <= maximumDistance &&
		recipe.opacity >= minimumOpacity &&
		recipe.opacity <= 1
	);
}

function toRgbaColor(value: string): RgbaColor | undefined {
	if (!isSafeThemeColor(value)) return undefined;
	const [red, green, blue, alpha] = convert.colorToRgb(value).map(Number);
	if (![red, green, blue, alpha].every(Number.isFinite)) return undefined;
	return {
		red: Math.min(1, Math.max(0, red! / 255)),
		green: Math.min(1, Math.max(0, green! / 255)),
		blue: Math.min(1, Math.max(0, blue! / 255)),
		alpha: Math.min(1, Math.max(0, alpha!))
	};
}

function compositeColor(foreground: RgbaColor, background: RgbaColor): RgbaColor {
	const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
	if (alpha === 0) return { red: 0, green: 0, blue: 0, alpha: 0 };
	return {
		red:
			(foreground.red * foreground.alpha +
				background.red * background.alpha * (1 - foreground.alpha)) /
			alpha,
		green:
			(foreground.green * foreground.alpha +
				background.green * background.alpha * (1 - foreground.alpha)) /
			alpha,
		blue:
			(foreground.blue * foreground.alpha +
				background.blue * background.alpha * (1 - foreground.alpha)) /
			alpha,
		alpha
	};
}

function relativeLuminance(color: RgbaColor): number {
	const linear = (channel: number) =>
		channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
	return 0.2126 * linear(color.red) + 0.7152 * linear(color.green) + 0.0722 * linear(color.blue);
}

export function themeColorContrastRatio(
	foreground: string,
	background: string,
	base = 'white'
): number | undefined {
	const foregroundColor = toRgbaColor(foreground);
	const backgroundColor = toRgbaColor(background);
	const baseColor = toRgbaColor(base);
	if (!foregroundColor || !backgroundColor || !baseColor) return undefined;
	const opaqueBase = compositeColor(baseColor, {
		red: 1,
		green: 1,
		blue: 1,
		alpha: 1
	});
	const compositedBackground = compositeColor(backgroundColor, opaqueBase);
	const compositedForeground = compositeColor(foregroundColor, compositedBackground);
	const foregroundLuminance = relativeLuminance(compositedForeground);
	const backgroundLuminance = relativeLuminance(compositedBackground);
	return (
		(Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
		(Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
	);
}

function hasReadableColorPairs(colors: ThemeColorTokens): boolean {
	return readableColorPairs.every(([foreground, background, base, minimum]) => {
		const ratio = themeColorContrastRatio(colors[foreground], colors[background], colors[base]);
		return ratio !== undefined && ratio >= minimum;
	});
}

const ACTION_COLOR_SETS = [
	['actionFocalInk', ['actionFocal', 'actionFocalHover', 'actionFocalActive']],
	['actionPrimaryInk', ['actionPrimary', 'actionPrimaryHover', 'actionPrimaryActive']],
	['actionOrdinaryInk', ['actionOrdinary', 'actionOrdinaryHover', 'actionOrdinaryActive']],
	['actionQuietInk', ['actionQuiet', 'actionQuietHover', 'actionQuietActive']],
	[
		'actionDestructiveInk',
		['actionDestructive', 'actionDestructiveHover', 'actionDestructiveActive']
	]
] as const satisfies readonly (readonly [
	keyof ThemeColorTokens,
	readonly (keyof ThemeColorTokens)[]
])[];

function hasReadableActionStates(colors: ThemeColorTokens): boolean {
	for (const [foreground, backgrounds] of ACTION_COLOR_SETS) {
		for (const background of backgrounds) {
			for (const underlay of ['canvas', 'surface'] as const) {
				const ratio = themeColorContrastRatio(
					colors[foreground],
					colors[background],
					colors[underlay]
				);
				if (ratio === undefined || ratio < MINIMUM_TEXT_CONTRAST) return false;
			}
		}
	}
	for (const foreground of ['actionLink', 'actionLinkHover'] as const) {
		for (const background of ['canvas', 'surface'] as const) {
			const ratio = themeColorContrastRatio(
				colors[foreground],
				colors[background],
				colors[background]
			);
			if (ratio === undefined || ratio < MINIMUM_TEXT_CONTRAST) return false;
		}
	}
	return true;
}

function hasVisibleFocus(colors: ThemeColorTokens): boolean {
	const contrastVisible = (
		['canvas', 'surface', 'field', 'sidebar', 'actionOrdinary'] as const
	).every((background) => {
		const ratio = themeColorContrastRatio(colors.focus, colors[background], colors.canvas);
		return ratio !== undefined && ratio >= MINIMUM_FOCUS_CONTRAST;
	});
	if (!contrastVisible) return false;
	return (['actionFocal', 'actionFocalHover', 'actionFocalActive'] as const).every((focal) => {
		const distance = perceptualColorDistance(colors.focus, colors[focal], colors.canvas);
		return distance !== undefined && distance >= MINIMUM_SEMANTIC_ACTION_DISTANCE;
	});
}

const ACTION_STATE_SETS = [
	['actionFocal', 'actionFocalHover', 'actionFocalActive'],
	['actionPrimary', 'actionPrimaryHover', 'actionPrimaryActive'],
	['actionOrdinary', 'actionOrdinaryHover', 'actionOrdinaryActive'],
	['actionQuiet', 'actionQuietHover', 'actionQuietActive'],
	['actionDestructive', 'actionDestructiveHover', 'actionDestructiveActive']
] as const satisfies readonly (readonly [
	keyof ThemeColorTokens,
	keyof ThemeColorTokens,
	keyof ThemeColorTokens
])[];

function hasDistinctActionStates(colors: ThemeColorTokens): boolean {
	for (const [base, hover, active] of ACTION_STATE_SETS) {
		for (const [first, second] of [
			[base, hover],
			[base, active],
			[hover, active]
		] as const) {
			const distance = perceptualColorDistance(colors[first], colors[second], colors.canvas);
			if (distance === undefined || distance < MINIMUM_SEMANTIC_ACTION_DISTANCE) return false;
		}
	}
	return true;
}

function perceptualColorDistance(
	first: string,
	second: string,
	underlay: string
): number | undefined {
	const firstColor = toRgbaColor(first);
	const secondColor = toRgbaColor(second);
	const underlayColor = toRgbaColor(underlay);
	if (!firstColor || !secondColor || !underlayColor || underlayColor.alpha !== 1) return undefined;
	const firstLab = toOklab(compositeColor(firstColor, underlayColor));
	const secondLab = toOklab(compositeColor(secondColor, underlayColor));
	return Math.hypot(
		firstLab[0] - secondLab[0],
		firstLab[1] - secondLab[1],
		firstLab[2] - secondLab[2]
	);
}

function toOklab(color: RgbaColor): readonly [number, number, number] {
	const linear = (channel: number) =>
		channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
	const red = linear(color.red);
	const green = linear(color.green);
	const blue = linear(color.blue);
	const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
	const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
	const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
	];
}

function hasDistinctDestructiveAction(colors: ThemeColorTokens): boolean {
	for (const [background, foreground] of [
		['actionFocal', 'actionFocalInk'],
		['actionPrimary', 'actionPrimaryInk'],
		['actionOrdinary', 'actionOrdinaryInk'],
		['actionQuiet', 'actionQuietInk']
	] as const) {
		const backgroundDistance = perceptualColorDistance(
			colors.actionDestructive,
			colors[background],
			colors.canvas
		);
		const foregroundDistance = perceptualColorDistance(
			colors.actionDestructiveInk,
			colors[foreground],
			colors.canvas
		);
		if (
			(backgroundDistance === undefined || backgroundDistance < MINIMUM_SEMANTIC_ACTION_DISTANCE) &&
			(foregroundDistance === undefined || foregroundDistance < MINIMUM_SEMANTIC_ACTION_DISTANCE)
		) {
			return false;
		}
	}
	return true;
}

function hasDistinctStatusColors(colors: ThemeColorTokens): boolean {
	for (let index = 0; index < STATUS_COLOR_KEYS.length; index += 1) {
		const first = convert.colorToOklab(colors[STATUS_COLOR_KEYS[index]!] ?? '').map(Number);
		for (let next = index + 1; next < STATUS_COLOR_KEYS.length; next += 1) {
			const second = convert.colorToOklab(colors[STATUS_COLOR_KEYS[next]!] ?? '').map(Number);
			if (first.length < 3 || second.length < 3 || [...first, ...second].some(Number.isNaN)) {
				return false;
			}
			const distance = Math.hypot(
				first[0]! - second[0]!,
				first[1]! - second[1]!,
				first[2]! - second[2]!
			);
			if (distance < MINIMUM_STATUS_COLOR_DISTANCE) return false;
		}
	}
	return true;
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
	const pageGutter = minimumCssPixels(spacing.pageGutter);
	const sectionGap = minimumCssPixels(spacing.sectionGap);
	const componentGap = minimumCssPixels(spacing.componentGap);
	const contentMaxWidth = minimumCssPixels(shell.contentMaxWidth);
	const sidebarWidth = minimumCssPixels(shell.sidebarWidth);
	const headerHeight = minimumCssPixels(shell.headerHeight);
	const mobileNavigationHeight = minimumCssPixels(shell.mobileNavigationHeight);

	return (
		THEME_COLOR_TOKEN_KEYS.every((key) => isSafeThemeColor(manifest.colors[key])) &&
		hasReadableColorPairs(manifest.colors) &&
		hasReadableActionStates(manifest.colors) &&
		hasVisibleFocus(manifest.colors) &&
		hasDistinctDestructiveAction(manifest.colors) &&
		hasDistinctStatusColors(manifest.colors) &&
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
		pageGutter !== undefined &&
		pageGutter >= 12 &&
		sectionGap !== undefined &&
		sectionGap >= 8 &&
		componentGap !== undefined &&
		componentGap >= 4 &&
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
		THEME_REDUCED_MOTION_OPTIONS.some((option) => option === manifest.motion.reducedMotion) &&
		hasDistinctActionStates(manifest.colors) &&
		isBoundedCssLength(shell.contentMaxWidth, 4096) &&
		isBoundedCssLength(shell.sidebarWidth, 1024) &&
		isBoundedCssLength(shell.headerHeight, 256) &&
		isBoundedCssLength(shell.mobileNavigationHeight, 256) &&
		contentMaxWidth !== undefined &&
		contentMaxWidth >= 320 &&
		sidebarWidth !== undefined &&
		sidebarWidth >= 192 &&
		headerHeight !== undefined &&
		headerHeight >= 44 &&
		mobileNavigationHeight !== undefined &&
		mobileNavigationHeight >= 56
	);
}
