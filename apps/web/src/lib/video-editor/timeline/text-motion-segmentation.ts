import type { TextMotionUnit } from '../project/types';

export interface TextUnitSegmentation {
	lineUnitIndices: Array<Array<number | null>>;
	unitCount: number;
}

interface LineSegmentation {
	indices: Array<number | null>;
	nextUnit: number;
}

const WHITESPACE = /\s/u;
let cachedSegmenter: Intl.Segmenter | null = null;

function isWhitespace(character: string): boolean {
	return WHITESPACE.test(character);
}

function wordSegmenter(): Intl.Segmenter | null {
	if (!('Segmenter' in Intl)) return null;
	cachedSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'word' });
	return cachedSegmenter;
}

function segmentWords(line: string, segmenter: Intl.Segmenter, nextUnit: number): LineSegmentation {
	const indices: Array<number | null> = [];
	let lastUnit: number | null = null;
	let pending: number[] = [];
	for (const segment of segmenter.segment(line)) {
		if (segment.isWordLike) {
			const unit = nextUnit;
			nextUnit += 1;
			pending.forEach((position) => {
				indices[position] = unit;
			});
			pending = [];
			lastUnit = unit;
			for (const _character of segment.segment) indices.push(unit);
			continue;
		}
		for (const character of segment.segment) {
			if (isWhitespace(character)) indices.push(null);
			else if (lastUnit !== null) indices.push(lastUnit);
			else {
				pending.push(indices.length);
				indices.push(null);
			}
		}
	}
	if (pending.length > 0) {
		const unit = nextUnit;
		nextUnit += 1;
		pending.forEach((position) => {
			indices[position] = unit;
		});
	}
	return { indices, nextUnit };
}

function segmentWordsFallback(line: string, nextUnit: number): LineSegmentation {
	const indices: Array<number | null> = [];
	let inWord = false;
	for (const character of line) {
		if (isWhitespace(character)) {
			indices.push(null);
			inWord = false;
		} else {
			if (!inWord) nextUnit += 1;
			inWord = true;
			indices.push(nextUnit - 1);
		}
	}
	return { indices, nextUnit };
}

export function segmentTextUnits(
	lines: readonly string[],
	unit: TextMotionUnit
): TextUnitSegmentation {
	if (unit === 'whole-clip') {
		return {
			lineUnitIndices: lines.map((line) =>
				Array.from(line, (character) => (isWhitespace(character) ? null : 0))
			),
			unitCount: 1
		};
	}
	if (unit === 'line') {
		return {
			lineUnitIndices: lines.map((line, index) => Array.from(line, () => index)),
			unitCount: lines.length
		};
	}
	if (unit === 'character') {
		let nextUnit = 0;
		return {
			lineUnitIndices: lines.map((line) =>
				Array.from(line, (character) => (isWhitespace(character) ? null : nextUnit++))
			),
			unitCount: nextUnit
		};
	}
	const segmenter = wordSegmenter();
	let nextUnit = 0;
	const lineUnitIndices = lines.map((line) => {
		const result = segmenter
			? segmentWords(line, segmenter, nextUnit)
			: segmentWordsFallback(line, nextUnit);
		nextUnit = result.nextUnit;
		return result.indices;
	});
	return { lineUnitIndices, unitCount: nextUnit };
}
