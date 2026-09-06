/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof -- This adapter validates and edits the recursive third-party Lottie JSON shape. */
/** Discover and override authored solid fill and stroke colors in Lottie JSON. */

export interface LottieColorLayer {
	key: string;
	color: string;
	label: string;
	named: boolean;
}

type Rgb = [number, number, number];

interface AnimatedValue {
	a?: unknown;
	k?: unknown;
	sid?: unknown;
}

interface ShapeItem {
	ty?: unknown;
	nm?: unknown;
	c?: AnimatedValue;
	it?: unknown;
}

interface EditableColor {
	read: () => Rgb;
	write: (rgb: Rgb) => void;
	label: string;
	named: boolean;
}

interface SlotDefinition {
	p?: AnimatedValue;
	nm?: unknown;
}

function parseAnimation(value: unknown): Record<string, unknown> | null {
	if (typeof value === 'string') {
		try {
			return JSON.parse(value) as Record<string, unknown>;
		} catch {
			return null;
		}
	}
	return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function isRgb(value: unknown): value is number[] {
	return Array.isArray(value) && value.length >= 3 && typeof value[0] === 'number';
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

export function lottieRgbToHex(rgb: readonly number[]): string {
	const channel = (value: number) =>
		Math.round(clamp01(value) * 255)
			.toString(16)
			.padStart(2, '0');
	return `#${channel(rgb[0] ?? 0)}${channel(rgb[1] ?? 0)}${channel(rgb[2] ?? 0)}`;
}

export function hexToLottieRgb(hex: string): Rgb | null {
	const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!match) return null;
	const value = Number.parseInt(match[1]!, 16);
	return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

function name(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

const GENERATED_COLOR_NAME = /^(fill|stroke)(\s+\d+)?$/i;

function authoredName(value: string): boolean {
	return value.length > 0 && !GENERATED_COLOR_NAME.test(value);
}

function colorsForShape(item: ShapeItem, label: string, named: boolean): EditableColor[] {
	if (item.ty !== 'fl' && item.ty !== 'st') return [];
	const color = item.c;
	if (!color || typeof color !== 'object' || typeof color.sid === 'string') return [];
	if (color.a === 1) {
		const keyframes = color.k;
		if (!Array.isArray(keyframes) || !isRgb((keyframes[0] as { s?: unknown })?.s)) return [];
		return [
			{
				label,
				named,
				read: () => {
					const first = (keyframes[0] as { s: number[] }).s;
					return [first[0]!, first[1]!, first[2]!];
				},
				write: (rgb) => {
					for (const frame of keyframes as Array<{ s?: unknown; e?: unknown }>) {
						if (isRgb(frame.s)) [frame.s[0], frame.s[1], frame.s[2]] = rgb;
						if (isRgb(frame.e)) [frame.e[0], frame.e[1], frame.e[2]] = rgb;
					}
				}
			}
		];
	}
	if (!isRgb(color.k)) return [];
	const rgb = color.k;
	return [
		{
			label,
			named,
			read: () => [rgb[0]!, rgb[1]!, rgb[2]!],
			write: (next) => {
				[rgb[0], rgb[1], rgb[2]] = next;
			}
		}
	];
}

function walkInlineColors(
	animation: Record<string, unknown> | null,
	visit: (color: EditableColor, key: string) => void
): void {
	if (!Array.isArray(animation?.layers)) return;
	let ordinal = 0;
	const walk = (shapes: unknown, layerName: string): void => {
		if (!Array.isArray(shapes)) return;
		for (const raw of shapes) {
			const item = raw as ShapeItem;
			if (item.ty === 'gr') {
				walk(item.it, layerName);
				continue;
			}
			const fallback = item.ty === 'st' ? 'Stroke' : 'Fill';
			const shapeName = name(item.nm);
			for (const color of colorsForShape(
				item,
				shapeName || (layerName ? `${layerName} ${fallback}` : fallback),
				authoredName(shapeName)
			)) {
				visit(color, `c${ordinal}`);
				ordinal += 1;
			}
		}
	};
	for (const raw of animation.layers) {
		const layer = raw as { shapes?: unknown; nm?: unknown };
		walk(layer.shapes, name(layer.nm));
	}
}

function slotColor(property: AnimatedValue | undefined): Rgb | null {
	if (!property || typeof property !== 'object') return null;
	if (property.a === 1) {
		const first = Array.isArray(property.k)
			? (property.k[0] as { s?: unknown } | undefined)
			: undefined;
		return isRgb(first?.s) ? [first.s[0]!, first.s[1]!, first.s[2]!] : null;
	}
	return isRgb(property.k) ? [property.k[0]!, property.k[1]!, property.k[2]!] : null;
}

function slotColors(animation: Record<string, unknown>): LottieColorLayer[] {
	if (!animation.slots || typeof animation.slots !== 'object') return [];
	const result: LottieColorLayer[] = [];
	for (const [id, definition] of Object.entries(
		animation.slots as Record<string, SlotDefinition>
	)) {
		const color = slotColor(definition.p);
		if (!color) continue;
		result.push({
			key: `s:${id}`,
			color: lottieRgbToHex(color),
			label: name(definition.nm) || id,
			named: true
		});
	}
	return result;
}

function forEachShape(animation: Record<string, unknown>, visit: (item: ShapeItem) => void): void {
	if (!Array.isArray(animation.layers)) return;
	const walk = (shapes: unknown): void => {
		if (!Array.isArray(shapes)) return;
		for (const raw of shapes) {
			const item = raw as ShapeItem;
			if (item.ty === 'gr') walk(item.it);
			else visit(item);
		}
	};
	for (const raw of animation.layers) walk((raw as { shapes?: unknown }).shapes);
}

function applySlotColor(animation: Record<string, unknown>, id: string, rgb: Rgb): boolean {
	let changed = false;
	const property = (animation.slots as Record<string, SlotDefinition> | undefined)?.[id]?.p;
	if (property && typeof property === 'object') {
		if (property.a === 1 && Array.isArray(property.k)) {
			for (const frame of property.k as Array<{ s?: unknown; e?: unknown }>) {
				if (isRgb(frame.s)) {
					[frame.s[0], frame.s[1], frame.s[2]] = rgb;
					changed = true;
				}
				if (isRgb(frame.e)) [frame.e[0], frame.e[1], frame.e[2]] = rgb;
			}
		} else if (isRgb(property.k)) {
			[property.k[0], property.k[1], property.k[2]] = rgb;
			changed = true;
		} else {
			property.a = 0;
			property.k = [...rgb, 1];
			changed = true;
		}
	}
	forEachShape(animation, (item) => {
		if (item.ty !== 'fl' && item.ty !== 'st') return;
		if (!item.c || item.c.sid !== id) return;
		if (isRgb(item.c.k)) [item.c.k[0], item.c.k[1], item.c.k[2]] = rgb;
		else item.c.k = [...rgb, 1];
		changed = true;
	});
	return changed;
}

export function extractLottieColorLayers(value: unknown): LottieColorLayer[] {
	const animation = parseAnimation(value);
	if (!animation) return [];
	const result = slotColors(animation);
	walkInlineColors(animation, (color, key) => {
		result.push({
			key,
			color: lottieRgbToHex(color.read()),
			label: color.label,
			named: color.named
		});
	});
	return result;
}

export function applyLottieColorOverrides(
	value: unknown,
	overrides: Record<string, string>
): string | null {
	const animation = parseAnimation(value);
	if (!animation || Object.keys(overrides).length === 0) return null;
	let changed = false;
	for (const [key, hex] of Object.entries(overrides)) {
		if (!key.startsWith('s:')) continue;
		const rgb = hexToLottieRgb(hex);
		if (rgb && applySlotColor(animation, key.slice(2), rgb)) changed = true;
	}
	walkInlineColors(animation, (color, key) => {
		const rgb = overrides[key] ? hexToLottieRgb(overrides[key]!) : null;
		if (!rgb) return;
		color.write(rgb);
		changed = true;
	});
	return changed ? JSON.stringify(animation) : null;
}
