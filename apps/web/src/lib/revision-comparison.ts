export interface RevisionCollectionChanges {
	added: number;
	removed: number;
	changed: number;
}

type SerializableValue =
	| string
	| number
	| boolean
	| null
	| undefined
	| SerializableValue[]
	| { [key: string]: SerializableValue };

export function compareRevisionItems<T extends { id: string }>(
	current: readonly T[],
	target: readonly T[]
): RevisionCollectionChanges {
	const currentItems = new Map(current.map((item) => [item.id, item]));
	const targetItems = new Map(target.map((item) => [item.id, item]));
	const changedIDs = new Set<string>();
	for (const [id, targetItem] of targetItems) {
		const currentItem = currentItems.get(id);
		if (currentItem && !sameRevisionValue(currentItem, targetItem)) changedIDs.add(id);
	}
	for (const id of changedRevisionOrderIDs(current, target)) changedIDs.add(id);
	return {
		added: [...targetItems.keys()].filter((id) => !currentItems.has(id)).length,
		removed: [...currentItems.keys()].filter((id) => !targetItems.has(id)).length,
		changed: changedIDs.size
	};
}

export function changedRevisionOrderIDs<T extends { id: string }>(
	current: readonly T[],
	target: readonly T[]
): Set<string> {
	const currentIDs = new Set(current.map((item) => item.id));
	const targetIDs = new Set(target.map((item) => item.id));
	const currentCommon = current.map((item) => item.id).filter((id) => targetIDs.has(id));
	const targetCommon = target.map((item) => item.id).filter((id) => currentIDs.has(id));
	const changed = new Set<string>();
	for (let index = 0; index < currentCommon.length; index += 1) {
		const currentID = currentCommon[index];
		const targetID = targetCommon[index];
		if (currentID !== targetID) {
			if (currentID) changed.add(currentID);
			if (targetID) changed.add(targetID);
		}
	}
	return changed;
}

export function sameRevisionValue<TLeft, TRight>(left: TLeft, right: TRight): boolean {
	return JSON.stringify(parseCanonicalValue(left)) === JSON.stringify(parseCanonicalValue(right));
}

function parseCanonicalValue(value: unknown): SerializableValue {
	if (Array.isArray(value)) return value.map(parseCanonicalValue);
	if (isSerializableRecord(value)) {
		return Object.fromEntries(
			Object.entries(value)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, member]) => [key, parseCanonicalValue(member)])
		);
	}
	if (
		value === null ||
		value === undefined ||
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean'
	) {
		return value;
	}
	return undefined;
}

function isSerializableRecord(value: unknown): value is { [key: string]: SerializableValue } {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
