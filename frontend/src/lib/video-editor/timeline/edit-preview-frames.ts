/** Pure frame mapping for edit comparison previews. */

import { frameToSourceSeconds } from '../media/render-plan';
import { formatTimelinePreviewTimecode } from '../preview/timeline-preview-scrub';
import type { TimelineItem } from '../project/types';
import { getLinkedItems } from './utils/linked-items';

const VISUAL_TYPES = new Set<TimelineItem['type']>([
	'video',
	'image',
	'composition',
	'lottie',
	'text',
	'shape',
	'subtitle'
]);

export function resolveVisualItem(items: TimelineItem[], anchorId: string): TimelineItem | null {
	const anchor = items.find((item) => item.id === anchorId);
	if (!anchor) return null;
	if (VISUAL_TYPES.has(anchor.type)) return anchor;
	const linked = getLinkedItems(items, anchorId);
	const visual = linked.find((item) => VISUAL_TYPES.has(item.type));
	return visual ?? null;
}

export interface EditPreviewPanel {
	item: TimelineItem | null;
	frame: number | null;
	label: string;
	timecode: string | null;
	isGap: boolean;
	isBaseline: boolean;
	sourceSeconds: number | null;
}

function panelForOut(
	item: TimelineItem | null,
	fps: number,
	label: string,
	isBaseline: boolean
): EditPreviewPanel {
	if (!item) {
		return {
			item: null,
			frame: null,
			label,
			timecode: null,
			isGap: true,
			isBaseline,
			sourceSeconds: null
		};
	}
	const frame = item.from + item.durationInFrames - 1;
	const sourceSeconds = frameToSourceSeconds(item, frame, fps);
	return {
		item,
		frame,
		label,
		timecode: formatTimelinePreviewTimecode(frame, fps),
		isGap: false,
		isBaseline,
		sourceSeconds
	};
}

function panelForIn(
	item: TimelineItem | null,
	fps: number,
	label: string,
	isBaseline: boolean
): EditPreviewPanel {
	if (!item) {
		return {
			item: null,
			frame: null,
			label,
			timecode: null,
			isGap: true,
			isBaseline,
			sourceSeconds: null
		};
	}
	const frame = item.from;
	const sourceSeconds = frameToSourceSeconds(item, frame, fps);
	return {
		item,
		frame,
		label,
		timecode: formatTimelinePreviewTimecode(frame, fps),
		isGap: false,
		isBaseline,
		sourceSeconds
	};
}

function gapPanel(label: string, isBaseline = false): EditPreviewPanel {
	return {
		item: null,
		frame: null,
		label,
		timecode: null,
		isGap: true,
		isBaseline,
		sourceSeconds: null
	};
}

export function buildRollingPanels(
	items: TimelineItem[],
	leftId: string,
	rightId: string,
	fps: number
): EditPreviewPanel[] {
	const left = resolveVisualItem(items, leftId);
	const right = resolveVisualItem(items, rightId);
	const leftPanel = left ? panelForOut(left, fps, 'OUT', false) : gapPanel('GAP');
	const rightPanel = right ? panelForIn(right, fps, 'IN', false) : gapPanel('GAP');
	return [leftPanel, rightPanel];
}

function findNearestNext(items: TimelineItem[], anchor: TimelineItem): TimelineItem | null {
	let best: TimelineItem | null = null;
	let bestFrom = Number.POSITIVE_INFINITY;
	for (const candidate of items) {
		if (candidate.trackId !== anchor.trackId) continue;
		if (candidate.id === anchor.id) continue;
		if (candidate.from <= anchor.from) continue;
		if (candidate.from < bestFrom) {
			bestFrom = candidate.from;
			best = candidate;
		}
	}
	return best;
}

function findNearestPrev(items: TimelineItem[], anchor: TimelineItem): TimelineItem | null {
	let best: TimelineItem | null = null;
	let bestEnd = Number.NEGATIVE_INFINITY;
	for (const candidate of items) {
		if (candidate.trackId !== anchor.trackId) continue;
		if (candidate.id === anchor.id) continue;
		const end = candidate.from + candidate.durationInFrames;
		if (end > anchor.from) continue;
		if (end > bestEnd) {
			bestEnd = end;
			best = candidate;
		}
	}
	return best;
}

export function buildRipplePanels(
	items: TimelineItem[],
	anchorId: string,
	handle: 'start' | 'end',
	fps: number
): EditPreviewPanel[] {
	const anchorVisual = resolveVisualItem(items, anchorId);
	const anchorRaw = items.find((item) => item.id === anchorId) ?? anchorVisual;
	if (!anchorVisual || !anchorRaw) {
		return [gapPanel('GAP'), gapPanel('GAP')];
	}
	if (handle === 'end') {
		const nextRaw = findNearestNext(items, anchorRaw);
		const nextVisual = nextRaw ? resolveVisualItem(items, nextRaw.id) : null;
		const isAdjacent = Boolean(
			nextRaw && nextRaw.from === anchorRaw.from + anchorRaw.durationInFrames
		);
		const outPanel = panelForOut(anchorVisual, fps, 'OUT', false);
		const inPanel =
			isAdjacent && nextVisual ? panelForIn(nextVisual, fps, 'IN', false) : gapPanel('GAP');
		return [outPanel, inPanel];
	}
	const prevRaw = findNearestPrev(items, anchorRaw);
	const prevVisual = prevRaw ? resolveVisualItem(items, prevRaw.id) : null;
	const isAdjacent = Boolean(prevRaw && prevRaw.from + prevRaw.durationInFrames === anchorRaw.from);
	const outPanel =
		isAdjacent && prevVisual ? panelForOut(prevVisual, fps, 'OUT', false) : gapPanel('GAP');
	const inPanel = panelForIn(anchorVisual, fps, 'IN', false);
	return [outPanel, inPanel];
}

function resolveBaselineVisual(
	baseline: Record<string, TimelineItem>,
	anchorId: string
): TimelineItem | null {
	const baselineItem = baseline[anchorId] ?? null;
	if (!baselineItem) return null;
	if (VISUAL_TYPES.has(baselineItem.type)) return baselineItem;
	const linked = Object.values(baseline).filter(
		(item) => item.linkedGroupId === baselineItem.linkedGroupId
	);
	return linked.find((item) => VISUAL_TYPES.has(item.type)) ?? null;
}

export function buildSlipPanels(
	items: TimelineItem[],
	anchorId: string,
	baseline: Record<string, TimelineItem>,
	fps: number
): EditPreviewPanel[] {
	const currentVisual = resolveVisualItem(items, anchorId);
	const baselineVisual = resolveBaselineVisual(baseline, anchorId);
	return [
		currentVisual ? panelForIn(currentVisual, fps, 'IN', false) : gapPanel('IN'),
		currentVisual ? panelForOut(currentVisual, fps, 'OUT', false) : gapPanel('OUT'),
		baselineVisual ? panelForIn(baselineVisual, fps, 'IN', true) : gapPanel('IN', true),
		baselineVisual ? panelForOut(baselineVisual, fps, 'OUT', true) : gapPanel('OUT', true)
	];
}

export function buildSlidePanels(
	items: TimelineItem[],
	anchorId: string,
	leftId: string | null | undefined,
	rightId: string | null | undefined,
	baseline: Record<string, TimelineItem>,
	fps: number
): EditPreviewPanel[] {
	const leftVisual = leftId ? resolveVisualItem(items, leftId) : null;
	const rightVisual = rightId ? resolveVisualItem(items, rightId) : null;
	const baselineLeft = leftId ? resolveBaselineVisual(baseline, leftId) : null;
	const baselineRight = rightId ? resolveBaselineVisual(baseline, rightId) : null;

	const dynamicLeft = leftVisual ? panelForOut(leftVisual, fps, 'OUT', false) : gapPanel('OUT');
	const dynamicRight = rightVisual ? panelForIn(rightVisual, fps, 'IN', false) : gapPanel('IN');
	const staticLeft = baselineLeft
		? panelForOut(baselineLeft, fps, 'OUT', true)
		: gapPanel('OUT', true);
	const staticRight = baselineRight
		? panelForIn(baselineRight, fps, 'IN', true)
		: gapPanel('IN', true);
	return [dynamicLeft, dynamicRight, staticLeft, staticRight];
}

export function createFittedVirtualItem(
	item: TimelineItem,
	canvasWidth: number,
	canvasHeight: number
): TimelineItem {
	const fittedTransform = {
		x: 0,
		y: 0,
		width: canvasWidth,
		height: canvasHeight,
		anchorX: canvasWidth / 2,
		anchorY: canvasHeight / 2,
		rotation: 0,
		opacity: 1
	};
	return {
		...item,
		transform: fittedTransform
	};
}

export function formatPanelTimecode(panel: EditPreviewPanel): string {
	if (panel.isGap || panel.timecode === null) return panel.label;
	return `${panel.label} ${panel.timecode}`;
}
