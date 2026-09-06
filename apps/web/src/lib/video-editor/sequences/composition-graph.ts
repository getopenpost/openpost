import type { SubComposition, TimelineItem } from '../project/types';

export function isCompositionReference(item: TimelineItem): boolean {
	return Boolean(item.compositionId) && (item.type === 'composition' || item.type === 'audio');
}

export function directCompositionReferences(items: TimelineItem[]): string[] {
	return [
		...new Set(
			items.flatMap((item) =>
				isCompositionReference(item) && item.compositionId ? [item.compositionId] : []
			)
		)
	];
}

export function compositionReferences(
	compositionId: string,
	targetId: string,
	compositionById: Map<string, SubComposition>,
	visited = new Set<string>()
): boolean {
	if (compositionId === targetId) return true;
	if (visited.has(compositionId)) return false;
	visited.add(compositionId);
	const composition = compositionById.get(compositionId);
	if (!composition) return false;
	for (const referencedId of directCompositionReferences(composition.items)) {
		if (
			referencedId === targetId ||
			compositionReferences(referencedId, targetId, compositionById, visited)
		)
			return true;
	}
	return false;
}

export function wouldCreateCompositionCycle(
	parentCompositionId: string | null,
	insertedCompositionId: string,
	compositionById: Map<string, SubComposition>
): boolean {
	return parentCompositionId
		? compositionReferences(insertedCompositionId, parentCompositionId, compositionById)
		: false;
}
