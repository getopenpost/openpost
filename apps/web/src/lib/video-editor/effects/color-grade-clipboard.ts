import { colorPreviewStore } from './color-preview-store.svelte';
import { snapshotColorGrade } from './color-grade';
import { replaceColorGradeEffects } from '../timeline/actions/effects';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';

export interface ColorGradeClipboardResult {
	effectCount: number;
	itemCount: number;
}

export function copyColorGradeFromItem(itemId: string): ColorGradeClipboardResult | null {
	const item = timelineStore.itemById.get(itemId);
	if (!item || item.type === 'audio') return null;
	const grade = snapshotColorGrade(item.effects);
	if (grade.length === 0) return null;
	colorPreviewStore.copyGrade(grade);
	return { effectCount: grade.length, itemCount: 1 };
}

export function pasteColorGradeToItems(
	itemIds: readonly string[]
): ColorGradeClipboardResult | null {
	const grade = colorPreviewStore.gradeClipboard;
	if (!grade?.length) return null;
	const targetIds = Array.from(new Set(itemIds)).filter((itemId) => {
		const item = timelineStore.itemById.get(itemId);
		return item !== undefined && item.type !== 'audio';
	});
	if (targetIds.length === 0 || !replaceColorGradeEffects(targetIds, grade)) return null;
	return { effectCount: grade.length, itemCount: targetIds.length };
}
