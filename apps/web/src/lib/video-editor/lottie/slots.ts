/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof -- This adapter validates the recursive third-party Lottie JSON shape. */
/** Discover scalar and two-axis value slots for native dotLottie editing. */

export type LottieSlotValue = number | [number, number];

export type LottieValueSlot =
	| { id: string; label: string; type: 'scalar'; value: number }
	| { id: string; label: string; type: 'vector'; value: [number, number] };

interface SlotProperty {
	a?: unknown;
	k?: unknown;
}

interface SlotDefinition {
	p?: SlotProperty;
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

function staticValue(property: SlotProperty | undefined): unknown {
	if (!property || typeof property !== 'object') return undefined;
	if (property.a === 1) {
		return Array.isArray(property.k)
			? (property.k[0] as { s?: unknown } | undefined)?.s
			: undefined;
	}
	return property.k;
}

function isVector(value: unknown): value is [number, number] {
	return (
		Array.isArray(value) &&
		value.length === 2 &&
		typeof value[0] === 'number' &&
		typeof value[1] === 'number'
	);
}

export function extractLottieValueSlots(value: unknown): LottieValueSlot[] {
	const animation = parseAnimation(value);
	if (!animation?.slots || typeof animation.slots !== 'object') return [];
	const result: LottieValueSlot[] = [];
	for (const [id, definition] of Object.entries(
		animation.slots as Record<string, SlotDefinition>
	)) {
		const value = staticValue(definition.p);
		const label =
			typeof definition.nm === 'string' && definition.nm.trim() ? definition.nm.trim() : id;
		if (typeof value === 'number') result.push({ id, label, type: 'scalar', value });
		else if (isVector(value)) result.push({ id, label, type: 'vector', value: [...value] });
	}
	return result;
}
