import type { TimelineItem } from '../project/types';
import type { TranscriptSourceWord } from './speech-cleanup';

function isMediaItem(item: TimelineItem | undefined): item is TimelineItem {
	return item?.type === 'video' || item?.type === 'audio';
}

export function buildTranscriptClipboardItems(
	slice: readonly TranscriptSourceWord[],
	items: readonly TimelineItem[],
	timelineFps: number,
	createId: () => string = () => crypto.randomUUID()
): TimelineItem[] {
	const itemById = new Map(items.map((item) => [item.id, item]));
	const clones: TimelineItem[] = [];
	let index = 0;

	while (index < slice.length) {
		const first = slice[index];
		if (!first?.sourceItemId) break;
		let runEndIndex = index;
		while (
			runEndIndex + 1 < slice.length &&
			slice[runEndIndex + 1]?.sourceItemId === first.sourceItemId
		) {
			runEndIndex += 1;
		}
		const last = slice[runEndIndex] ?? first;
		const run = slice.slice(index, runEndIndex + 1);
		const runSourceStart = Math.min(...run.map((word) => word.start));
		const runSourceEnd = Math.max(...run.map((word) => word.end));
		const source = itemById.get(first.sourceItemId);
		if (isMediaItem(source)) {
			const companions = source.linkedGroupId
				? items.filter(
						(item) =>
							item.id !== source.id &&
							isMediaItem(item) &&
							item.linkedGroupId === source.linkedGroupId
					)
				: [];
			const linkedGroupId = companions.length > 0 ? createId() : undefined;
			const from = first.timelineStartFrame ?? source.from;
			const endFrame = last.timelineEndFrame ?? from + 1;
			const clone = (item: TimelineItem): TimelineItem => {
				const id = createId();
				const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : timelineFps;
				const sourceStart = Math.max(0, Math.round(runSourceStart * sourceFps));
				const sourceEnd = Math.max(sourceStart + 1, Math.round(runSourceEnd * sourceFps));
				return {
					...structuredClone(item),
					id,
					originId: id,
					from,
					durationInFrames: Math.max(1, endFrame - from),
					sourceStart,
					sourceEnd,
					linkedGroupId
				};
			};
			clones.push(clone(source), ...companions.map(clone));
		}
		index = runEndIndex + 1;
	}

	return clones;
}
