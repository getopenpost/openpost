import type { TextMotionEffect } from '../project/types';
import type { TimelineItem } from '../project/types';
import type { TextMotionSlot } from '../project/types';
import { getTextMotionPreset } from './text-motion-presets';
import { segmentTextUnits } from './text-motion-segmentation';

export interface TextMotionTimelineBand {
	slot: TextMotionSlot;
	presetId: TextMotionEffect['presetId'];
	fromFrame: number;
	toFrame: number;
	clipFromFrame: number;
	clipToFrame: number;
	unitCount: number;
	durationFrames: number;
	offsetFrames: number;
}

function getTextMotionUnitCount(item: TimelineItem, effect: TextMotionEffect): number {
	if (item.type !== 'text') return 1;
	const unit = effect.unit ?? getTextMotionPreset(effect.presetId).unit;
	const text = typeof item.text === 'string' ? item.text : '';
	return Math.max(1, segmentTextUnits(text.split(/\r?\n/u), unit).unitCount);
}

function getTextMotionWindow(
	item: TimelineItem,
	effect: TextMotionEffect | undefined
): { length: number; unitCount: number } {
	if (!effect) return { length: 0, unitCount: 0 };
	const unitCount = getTextMotionUnitCount(item, effect);
	const maxRank =
		effect.order === 'center' ? Math.floor((unitCount - 1) / 2) : Math.max(0, unitCount - 1);
	const requested =
		Math.max(0, effect.durationFrames) + Math.max(0, effect.staggerFrames) * maxRank;
	return { length: Math.min(item.durationInFrames / 2, requested), unitCount };
}

/** Resolve the absolute timeline spans occupied by a text item's procedural slots. */
export function getTextMotionTimelineBands(item: TimelineItem): TextMotionTimelineBand[] {
	if (item.type !== 'text' || !item.textMotion) return [];
	const { in: inEffect, loop: loopEffect, out: outEffect } = item.textMotion;
	const inWindow = getTextMotionWindow(item, inEffect);
	const outWindow = getTextMotionWindow(item, outEffect);
	const clipEnd = item.from + item.durationInFrames;
	const inOffset = Math.min(
		Math.max(0, inEffect?.offsetFrames ?? 0),
		Math.max(0, item.durationInFrames - inWindow.length)
	);
	const outOffset = Math.min(
		Math.max(0, outEffect?.offsetFrames ?? 0),
		Math.max(0, item.durationInFrames - outWindow.length)
	);
	const inFrom = item.from + inOffset;
	const inTo = inFrom + inWindow.length;
	const outTo = clipEnd - outOffset;
	const outFrom = outTo - outWindow.length;
	const bands: TextMotionTimelineBand[] = [];
	if (inEffect && inWindow.length > 0) {
		bands.push({
			slot: 'in',
			presetId: inEffect.presetId,
			fromFrame: inFrom,
			toFrame: inTo,
			clipFromFrame: item.from,
			clipToFrame: clipEnd,
			unitCount: inWindow.unitCount,
			durationFrames: inEffect.durationFrames,
			offsetFrames: inOffset
		});
	}
	if (loopEffect) {
		const loopFrom = inEffect ? inTo : item.from;
		const loopTo = outEffect ? outFrom : clipEnd;
		if (loopTo > loopFrom) {
			bands.push({
				slot: 'loop',
				presetId: loopEffect.presetId,
				fromFrame: loopFrom,
				toFrame: loopTo,
				clipFromFrame: item.from,
				clipToFrame: clipEnd,
				unitCount: getTextMotionUnitCount(item, loopEffect),
				durationFrames: loopEffect.durationFrames,
				offsetFrames: 0
			});
		}
	}
	if (outEffect && outWindow.length > 0) {
		bands.push({
			slot: 'out',
			presetId: outEffect.presetId,
			fromFrame: outFrom,
			toFrame: outTo,
			clipFromFrame: item.from,
			clipToFrame: clipEnd,
			unitCount: outWindow.unitCount,
			durationFrames: outEffect.durationFrames,
			offsetFrames: outOffset
		});
	}
	return bands;
}

export function getMaxOffsetFrames(
	band: TextMotionTimelineBand,
	allBands: readonly TextMotionTimelineBand[]
): number {
	const length = band.toFrame - band.fromFrame;
	if (band.slot === 'in') {
		const outBand = allBands.find((c) => c.slot === 'out');
		const boundary = outBand?.fromFrame ?? band.clipToFrame;
		return Math.max(0, Math.floor(boundary - band.clipFromFrame - length));
	}
	if (band.slot === 'out') {
		const inBand = allBands.find((c) => c.slot === 'in');
		const boundary = inBand?.toFrame ?? band.clipFromFrame;
		return Math.max(0, Math.floor(band.clipToFrame - boundary - length));
	}
	return 0;
}
