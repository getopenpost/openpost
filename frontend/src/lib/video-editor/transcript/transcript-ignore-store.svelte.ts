import type { SourceRange } from '../timeline/actions/range-removal';
import type { TranscriptSourceWord } from './speech-cleanup';
import type { TranscriptSelectionTargets } from './transcript-edit-model';

export interface TranscriptIgnoreRanges {
	[mediaId: string]: SourceRange[];
}

const RANGE_EPSILON = 1e-6;

export function normalizeTranscriptIgnoreRanges(ranges: readonly SourceRange[]): SourceRange[] {
	const normalized: SourceRange[] = [];
	for (const range of ranges.toSorted((left, right) => left.start - right.start)) {
		if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end <= range.start)
			continue;
		const next = { start: Math.max(0, range.start), end: range.end };
		const previous = normalized.at(-1);
		if (previous && next.start <= previous.end + RANGE_EPSILON) {
			previous.end = Math.max(previous.end, next.end);
		} else {
			normalized.push(next);
		}
	}
	return normalized;
}

export function subtractTranscriptIgnoreRanges(
	base: readonly SourceRange[],
	remove: readonly SourceRange[]
): SourceRange[] {
	let result = normalizeTranscriptIgnoreRanges(base);
	for (const cut of normalizeTranscriptIgnoreRanges(remove)) {
		result = result.flatMap((range) => {
			if (cut.end <= range.start || cut.start >= range.end) return [range];
			const pieces: SourceRange[] = [];
			if (cut.start > range.start + RANGE_EPSILON)
				pieces.push({ start: range.start, end: Math.min(cut.start, range.end) });
			if (cut.end < range.end - RANGE_EPSILON)
				pieces.push({ start: Math.max(cut.end, range.start), end: range.end });
			return pieces;
		});
	}
	return result;
}

export function isTranscriptWordIgnored(
	word: Pick<TranscriptSourceWord, 'mediaId' | 'start' | 'end'>,
	ranges: TranscriptIgnoreRanges
): boolean {
	const duration = word.end - word.start;
	if (duration <= 0) return false;
	const covered = (ranges[word.mediaId] ?? []).reduce((total, range) => {
		return total + Math.max(0, Math.min(word.end, range.end) - Math.max(word.start, range.start));
	}, 0);
	return covered / duration >= 0.5;
}

function targetsForWords(words: readonly TranscriptSourceWord[]): TranscriptSelectionTargets {
	const targets: TranscriptSelectionTargets = {};
	for (const word of words) {
		if (!word.sourceItemId) continue;
		const target = (targets[word.sourceItemId] ??= { mediaId: word.mediaId, ranges: [] });
		target.ranges.push({ start: word.start, end: word.end });
	}
	return targets;
}

function cloneTargets(targets: TranscriptSelectionTargets): TranscriptSelectionTargets {
	return Object.fromEntries(
		Object.entries(targets).map(([sourceItemId, target]) => [
			sourceItemId,
			{ mediaId: target.mediaId, ranges: target.ranges.map((range) => ({ ...range })) }
		])
	);
}

class TranscriptIgnoreStore {
	targets = $state<TranscriptSelectionTargets>({});

	get ranges(): TranscriptIgnoreRanges {
		const ranges: TranscriptIgnoreRanges = {};
		for (const target of Object.values(this.targets)) {
			(ranges[target.mediaId] ??= []).push(...target.ranges);
		}
		return Object.fromEntries(
			Object.entries(ranges).map(([mediaId, entries]) => [
				mediaId,
				normalizeTranscriptIgnoreRanges(entries)
			])
		);
	}

	ignore(words: readonly TranscriptSourceWord[]): void {
		this.ignoreTargets(targetsForWords(words));
	}

	ignoreTargets(additions: TranscriptSelectionTargets): void {
		const next = cloneTargets(this.targets);
		for (const [sourceItemId, addition] of Object.entries(additions)) {
			const current = next[sourceItemId];
			next[sourceItemId] = {
				mediaId: addition.mediaId,
				ranges: normalizeTranscriptIgnoreRanges([...(current?.ranges ?? []), ...addition.ranges])
			};
		}
		this.targets = next;
	}

	restore(words: readonly TranscriptSourceWord[]): void {
		this.restoreTargets(targetsForWords(words));
	}

	restoreTargets(removals: TranscriptSelectionTargets): void {
		const next = cloneTargets(this.targets);
		for (const [sourceItemId, removal] of Object.entries(removals)) {
			const current = next[sourceItemId];
			if (!current) continue;
			const remaining = subtractTranscriptIgnoreRanges(current.ranges, removal.ranges);
			if (remaining.length === 0) delete next[sourceItemId];
			else next[sourceItemId] = { ...current, ranges: remaining };
		}
		this.targets = next;
	}

	clear(): void {
		this.targets = {};
	}

	isIgnored(
		word: Pick<TranscriptSourceWord, 'sourceItemId' | 'mediaId' | 'start' | 'end'>
	): boolean {
		const target = word.sourceItemId ? this.targets[word.sourceItemId] : undefined;
		if (!target) return false;
		return isTranscriptWordIgnored(word, { [target.mediaId]: target.ranges });
	}

	get spanCount(): number {
		return Object.values(this.targets).reduce((total, target) => total + target.ranges.length, 0);
	}

	get durationSeconds(): number {
		return Object.values(this.targets).reduce(
			(total, target) =>
				total + target.ranges.reduce((sum, range) => sum + Math.max(0, range.end - range.start), 0),
			0
		);
	}

	__resetForTesting(): void {
		this.clear();
	}
}

export const transcriptIgnoreStore = new TranscriptIgnoreStore();
