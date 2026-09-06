export interface VirtualRowLayout {
	offsets: number[];
	sizes: number[];
	totalSize: number;
}

export interface VirtualRowWindow {
	startIndex: number;
	endIndex: number;
	beforeSize: number;
	afterSize: number;
}

function positiveSize(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function buildVirtualRowLayout(
	keys: string[],
	measuredSizes: ReadonlyMap<string, number>,
	estimatedSize: number
): VirtualRowLayout {
	const fallback = positiveSize(estimatedSize, 1);
	const offsets: number[] = [];
	const sizes: number[] = [];
	let offset = 0;
	for (const key of keys) {
		offsets.push(offset);
		const size = positiveSize(measuredSizes.get(key), fallback);
		sizes.push(size);
		offset += size;
	}
	return { offsets, sizes, totalSize: offset };
}

function firstRowEndingAfter(layout: VirtualRowLayout, boundary: number): number {
	let low = 0;
	let high = layout.offsets.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		const end = (layout.offsets[middle] ?? 0) + (layout.sizes[middle] ?? 0);
		if (end <= boundary) low = middle + 1;
		else high = middle;
	}
	return low;
}

function firstRowStartingAtOrAfter(layout: VirtualRowLayout, boundary: number): number {
	let low = 0;
	let high = layout.offsets.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if ((layout.offsets[middle] ?? 0) < boundary) low = middle + 1;
		else high = middle;
	}
	return low;
}

export function queryVirtualRowLayout(
	layout: VirtualRowLayout,
	scrollOffset: number,
	viewportSize: number,
	overscan: number
): VirtualRowWindow {
	const count = layout.offsets.length;
	if (count === 0) {
		return { startIndex: 0, endIndex: 0, beforeSize: 0, afterSize: 0 };
	}
	const safeOffset = Math.max(0, Number.isFinite(scrollOffset) ? scrollOffset : 0);
	const safeViewport = Math.max(1, Number.isFinite(viewportSize) ? viewportSize : 1);
	const safeOverscan = Math.max(0, Number.isFinite(overscan) ? overscan : 0);
	const startBoundary = Math.max(0, safeOffset - safeOverscan);
	const endBoundary = Math.min(layout.totalSize, safeOffset + safeViewport + safeOverscan);
	const startIndex = Math.min(count - 1, firstRowEndingAfter(layout, startBoundary));
	const endIndex = Math.max(
		startIndex + 1,
		Math.min(count, firstRowStartingAtOrAfter(layout, endBoundary))
	);
	const beforeSize = layout.offsets[startIndex] ?? 0;
	const renderedEnd =
		endIndex >= count
			? layout.totalSize
			: (layout.offsets[endIndex - 1] ?? 0) + (layout.sizes[endIndex - 1] ?? 0);
	return {
		startIndex,
		endIndex,
		beforeSize,
		afterSize: Math.max(0, layout.totalSize - renderedEnd)
	};
}
