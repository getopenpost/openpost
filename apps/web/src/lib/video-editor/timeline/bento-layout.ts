/** Pure Bento layout math adapted from FreeCut (MIT). */
import type { ItemTransform, TimelineItem, TimelineTransition } from '../project/types';

export type BentoLayoutPreset = 'auto' | 'row' | 'column' | 'pip' | 'focus-sidebar' | 'grid';

export interface BentoLayoutConfig {
	preset: BentoLayoutPreset;
	cols?: number;
	rows?: number;
	gap?: number;
	padding?: number;
}

export interface BentoLayoutItem {
	id: string;
	sourceWidth: number;
	sourceHeight: number;
}

export interface BentoGridDimensions {
	cols: number;
	rows: number;
}

export interface BentoSourceSize {
	sourceWidth: number;
	sourceHeight: number;
}

interface BentoFittedSize {
	width: number;
	height: number;
}

interface LayoutFrame {
	result: Map<string, ItemTransform>;
	gap: number;
	padding: number;
	availableWidth: number;
	availableHeight: number;
	canvasCenterX: number;
	canvasCenterY: number;
}

function finitePositive(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function clampedInteger(value: number | undefined, fallback: number, max: number): number {
	return Math.max(1, Math.min(max, Math.round(finitePositive(value, fallback))));
}

export function computeGridDimensions(count: number): BentoGridDimensions {
	if (count <= 0) return { cols: 0, rows: 0 };
	const cols = Math.ceil(Math.sqrt(count));
	return { cols, rows: Math.ceil(count / cols) };
}

function fitContain(
	sourceWidth: number,
	sourceHeight: number,
	cellWidth: number,
	cellHeight: number
): BentoFittedSize {
	const safeWidth = finitePositive(sourceWidth, 1);
	const safeHeight = finitePositive(sourceHeight, 1);
	const scale = Math.max(
		1 / Math.max(safeWidth, safeHeight),
		Math.min(cellWidth / safeWidth, cellHeight / safeHeight)
	);
	return {
		width: Math.max(1, Math.round(safeWidth * scale)),
		height: Math.max(1, Math.round(safeHeight * scale))
	};
}

function createLayoutFrame(
	items: readonly BentoLayoutItem[],
	canvasWidth: number,
	canvasHeight: number,
	config: BentoLayoutConfig
): LayoutFrame | null {
	if (items.length === 0) return null;
	const width = finitePositive(canvasWidth, 1920);
	const height = finitePositive(canvasHeight, 1080);
	const maxPadding = Math.max(0, Math.min(width, height) / 2 - 1);
	const padding = Math.max(
		0,
		Math.min(maxPadding, Number.isFinite(config.padding) ? (config.padding ?? 0) : 0)
	);
	const gap = Math.max(
		0,
		Math.min(Math.min(width, height), Number.isFinite(config.gap) ? (config.gap ?? 0) : 0)
	);
	return {
		result: new Map(),
		gap,
		padding,
		availableWidth: Math.max(1, width - padding * 2),
		availableHeight: Math.max(1, height - padding * 2),
		canvasCenterX: width / 2,
		canvasCenterY: height / 2
	};
}

function computeGridLayout(
	items: readonly BentoLayoutItem[],
	config: BentoLayoutConfig,
	frame: LayoutFrame
): Map<string, ItemTransform> {
	let cols: number;
	let rows: number;
	if (config.preset === 'row') {
		cols = items.length;
		rows = 1;
	} else if (config.preset === 'column') {
		cols = 1;
		rows = items.length;
	} else if (config.preset === 'grid') {
		cols = clampedInteger(config.cols, 2, items.length);
		rows = Math.max(clampedInteger(config.rows, 2, items.length), Math.ceil(items.length / cols));
	} else {
		({ cols, rows } = computeGridDimensions(items.length));
	}

	const horizontalGapLimit =
		cols > 1 ? Math.max(0, (frame.availableWidth - cols) / (cols - 1)) : frame.gap;
	const verticalGapLimit =
		rows > 1 ? Math.max(0, (frame.availableHeight - rows) / (rows - 1)) : frame.gap;
	const gap = Math.min(frame.gap, horizontalGapLimit, verticalGapLimit);
	const totalHorizontalGap = gap * Math.max(0, cols - 1);
	const totalVerticalGap = gap * Math.max(0, rows - 1);
	const cellWidth = Math.max(1, (frame.availableWidth - totalHorizontalGap) / cols);
	const cellHeight = Math.max(1, (frame.availableHeight - totalVerticalGap) / rows);
	for (const [index, item] of items.entries()) {
		const col = index % cols;
		const row = Math.floor(index / cols);
		const cellX = frame.padding + col * (cellWidth + gap);
		const cellY = frame.padding + row * (cellHeight + gap);
		const fit = fitContain(item.sourceWidth, item.sourceHeight, cellWidth, cellHeight);
		frame.result.set(item.id, {
			x: cellX + cellWidth / 2 - frame.canvasCenterX,
			y: cellY + cellHeight / 2 - frame.canvasCenterY,
			width: fit.width,
			height: fit.height,
			rotation: 0
		});
	}
	return frame.result;
}

function computePipLayout(
	items: readonly BentoLayoutItem[],
	frame: LayoutFrame
): Map<string, ItemTransform> {
	const main = items[0];
	if (!main) return frame.result;
	const mainFit = fitContain(
		main.sourceWidth,
		main.sourceHeight,
		frame.availableWidth,
		frame.availableHeight
	);
	frame.result.set(main.id, { x: 0, y: 0, ...mainFit, rotation: 0 });
	const pipItems = items.slice(1);
	if (pipItems.length === 0) return frame.result;

	const nominalWidth = frame.availableWidth / 4;
	const nominal = pipItems.map((item) =>
		fitContain(item.sourceWidth, item.sourceHeight, nominalWidth, nominalWidth)
	);
	const nominalHeight =
		nominal.reduce((total, fit) => total + fit.height, 0) + frame.gap * (pipItems.length + 1);
	const scale = Math.min(1, frame.availableHeight / Math.max(1, nominalHeight));
	const pipWidth = nominalWidth * scale;
	const rightEdge = frame.padding + frame.availableWidth;
	let currentBottom = frame.padding + frame.availableHeight;
	for (let index = pipItems.length - 1; index >= 0; index -= 1) {
		const item = pipItems[index];
		if (!item) continue;
		const fit = fitContain(item.sourceWidth, item.sourceHeight, pipWidth, pipWidth);
		const inset = frame.gap * scale;
		frame.result.set(item.id, {
			x: rightEdge - pipWidth / 2 - inset - frame.canvasCenterX,
			y: currentBottom - fit.height / 2 - inset - frame.canvasCenterY,
			width: fit.width,
			height: fit.height,
			rotation: 0
		});
		currentBottom -= fit.height + inset;
	}
	return frame.result;
}

function computeFocusSidebarLayout(
	items: readonly BentoLayoutItem[],
	frame: LayoutFrame
): Map<string, ItemTransform> {
	const main = items[0];
	if (!main) return frame.result;
	const horizontalGap = Math.min(frame.gap, Math.max(0, frame.availableWidth - 2));
	const focusWidth = Math.max(1, ((frame.availableWidth - horizontalGap) * 2) / 3);
	const fit = fitContain(main.sourceWidth, main.sourceHeight, focusWidth, frame.availableHeight);
	frame.result.set(main.id, {
		x: frame.padding + focusWidth / 2 - frame.canvasCenterX,
		y: frame.padding + frame.availableHeight / 2 - frame.canvasCenterY,
		width: fit.width,
		height: fit.height,
		rotation: 0
	});
	const sidebarItems = items.slice(1);
	if (sidebarItems.length === 0) return frame.result;
	const sidebarWidth = Math.max(1, (frame.availableWidth - horizontalGap) / 3);
	const sidebarX = frame.padding + focusWidth + horizontalGap;
	const sidebarGap = Math.min(
		frame.gap,
		sidebarItems.length > 1
			? Math.max(0, (frame.availableHeight - sidebarItems.length) / (sidebarItems.length - 1))
			: frame.gap
	);
	const cellHeight = Math.max(
		1,
		(frame.availableHeight - sidebarGap * Math.max(0, sidebarItems.length - 1)) /
			sidebarItems.length
	);
	for (const [index, item] of sidebarItems.entries()) {
		const itemFit = fitContain(item.sourceWidth, item.sourceHeight, sidebarWidth, cellHeight);
		frame.result.set(item.id, {
			x: sidebarX + sidebarWidth / 2 - frame.canvasCenterX,
			y: frame.padding + index * (cellHeight + sidebarGap) + cellHeight / 2 - frame.canvasCenterY,
			width: itemFit.width,
			height: itemFit.height,
			rotation: 0
		});
	}
	return frame.result;
}

export function computeBentoLayout(
	items: readonly BentoLayoutItem[],
	canvasWidth: number,
	canvasHeight: number,
	config: BentoLayoutConfig
): Map<string, ItemTransform> {
	const frame = createLayoutFrame(items, canvasWidth, canvasHeight, config);
	if (!frame) return new Map();
	if (config.preset === 'pip') return computePipLayout(items, frame);
	if (config.preset === 'focus-sidebar') return computeFocusSidebarLayout(items, frame);
	return computeGridLayout(items, config, frame);
}

export function buildBentoTransitionChains(
	itemIds: readonly string[],
	transitions: readonly TimelineTransition[]
): string[][] {
	const selected = new Set(itemIds);
	const incoming = new Map<string, string>();
	const outgoing = new Map<string, string>();
	for (const transition of transitions) {
		if (!selected.has(transition.fromItemId) || !selected.has(transition.toItemId)) continue;
		if (!outgoing.has(transition.fromItemId))
			outgoing.set(transition.fromItemId, transition.toItemId);
		if (!incoming.has(transition.toItemId))
			incoming.set(transition.toItemId, transition.fromItemId);
	}
	const visited = new Set<string>();
	const chains: string[][] = [];
	for (const id of itemIds) {
		if (visited.has(id)) continue;
		let start = id;
		const reverseSeen = new Set([id]);
		while (incoming.has(start)) {
			const previous = incoming.get(start);
			if (!previous || reverseSeen.has(previous) || visited.has(previous)) break;
			reverseSeen.add(previous);
			start = previous;
		}
		const chain: string[] = [];
		let current: string | undefined = start;
		while (current && selected.has(current) && !visited.has(current)) {
			visited.add(current);
			chain.push(current);
			current = outgoing.get(current);
		}
		if (chain.length > 0) chains.push(chain);
	}
	return chains;
}

export function bentoSourceSize(
	item: TimelineItem,
	canvasWidth: number,
	canvasHeight: number
): BentoSourceSize {
	const width = finitePositive(
		item.sourceWidth,
		finitePositive(item.transform?.width, canvasWidth)
	);
	const height = finitePositive(
		item.sourceHeight,
		finitePositive(item.transform?.height, canvasHeight)
	);
	const cropWidth = Math.max(0.001, 1 - (item.crop?.left ?? 0) - (item.crop?.right ?? 0));
	const cropHeight = Math.max(0.001, 1 - (item.crop?.top ?? 0) - (item.crop?.bottom ?? 0));
	return { sourceWidth: width * cropWidth, sourceHeight: height * cropHeight };
}
