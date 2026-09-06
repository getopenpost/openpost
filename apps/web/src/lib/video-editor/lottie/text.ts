/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof -- This adapter validates and edits the recursive third-party Lottie JSON shape. */
/** Discover and override authored text layers and text slots in Lottie JSON. */

export interface LottieTextLayer {
	key: string;
	text: string;
	label: string;
}

interface TextDocument {
	t?: unknown;
}

interface TextData {
	d?: { k?: Array<{ s?: TextDocument }>; sid?: unknown };
}

interface TextLayer {
	ty?: unknown;
	nm?: unknown;
	t?: TextData;
}

interface SlotDefinition {
	p?: { k?: unknown; p?: { t?: unknown } };
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

function textDocument(value: unknown): TextDocument | undefined {
	return Array.isArray(value) ? (value[0] as { s?: TextDocument } | undefined)?.s : undefined;
}

function textLayersBoundTo(animation: Record<string, unknown>, slotId: string): TextLayer[] {
	if (!Array.isArray(animation.layers)) return [];
	return (animation.layers as TextLayer[]).filter(
		(layer) => layer.ty === 5 && layer.t?.d?.sid === slotId
	);
}

function readSlotText(animation: Record<string, unknown>, slotId: string): string | undefined {
	const property = (animation.slots as Record<string, SlotDefinition> | undefined)?.[slotId]?.p;
	const primary = textDocument(property?.k)?.t;
	if (typeof primary === 'string') return primary;
	if (typeof property?.p?.t === 'string') return property.p.t;
	for (const layer of textLayersBoundTo(animation, slotId)) {
		const fallback = textDocument(layer.t?.d?.k)?.t;
		if (typeof fallback === 'string') return fallback;
	}
	return undefined;
}

function writeSlotText(animation: Record<string, unknown>, slotId: string, value: string): boolean {
	let changed = false;
	const property = (animation.slots as Record<string, SlotDefinition> | undefined)?.[slotId]?.p;
	const document = textDocument(property?.k);
	if (document) {
		document.t = value;
		changed = true;
	}
	if (property?.p && typeof property.p === 'object') {
		property.p.t = value;
		changed = true;
	}
	for (const layer of textLayersBoundTo(animation, slotId)) {
		const bound = textDocument(layer.t?.d?.k);
		if (!bound) continue;
		bound.t = value;
		changed = true;
	}
	return changed;
}

function firstLayerText(layer: TextLayer): string | null {
	for (const frame of layer.t?.d?.k ?? []) {
		if (typeof frame.s?.t === 'string') return frame.s.t;
	}
	return null;
}

export function extractLottieTextLayers(value: unknown): LottieTextLayer[] {
	const animation = parseAnimation(value);
	if (!animation || !Array.isArray(animation.layers)) return [];
	const result: LottieTextLayer[] = [];
	if (animation.slots && typeof animation.slots === 'object') {
		for (const [id, definition] of Object.entries(
			animation.slots as Record<string, SlotDefinition>
		)) {
			const text = readSlotText(animation, id);
			if (text === undefined) continue;
			const label =
				typeof definition.nm === 'string' && definition.nm.trim() ? definition.nm.trim() : id;
			result.push({ key: `s:${id}`, text, label });
		}
	}
	animation.layers.forEach((raw, index) => {
		const layer = raw as TextLayer;
		if (layer.ty !== 5 || typeof layer.t?.d?.sid === 'string') return;
		const text = firstLayerText(layer);
		if (text === null) return;
		const label =
			typeof layer.nm === 'string' && layer.nm.trim() ? layer.nm.trim() : `Text ${index + 1}`;
		result.push({ key: String(index), text, label });
	});
	return result;
}

export function applyLottieTextOverrides(
	value: unknown,
	overrides: Record<string, string>
): string | null {
	const animation = parseAnimation(value);
	if (!animation || !Array.isArray(animation.layers) || Object.keys(overrides).length === 0) {
		return null;
	}
	let changed = false;
	for (const [key, text] of Object.entries(overrides)) {
		if (key.startsWith('s:') && writeSlotText(animation, key.slice(2), text)) changed = true;
	}
	animation.layers.forEach((raw, index) => {
		const text = overrides[String(index)];
		if (text === undefined) return;
		const layer = raw as TextLayer;
		if (layer.ty !== 5 || typeof layer.t?.d?.sid === 'string') return;
		for (const frame of layer.t?.d?.k ?? []) {
			if (typeof frame.s?.t !== 'string') continue;
			frame.s.t = text;
			changed = true;
		}
	});
	return changed ? JSON.stringify(animation) : null;
}
