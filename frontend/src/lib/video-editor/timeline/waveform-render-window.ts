export const TIMELINE_WAVEFORM_OVERSCAN_PX = 600;
export const TIMELINE_WAVEFORM_HEIGHT = 80;
// Avoid rebuilding thousands of SVG coordinates for every scroll pixel.
const TIMELINE_WAVEFORM_RENDER_QUANTUM_PX = 128;

export interface TimelineWaveformRenderWindow {
	clipWidthPx: number;
	leftPx: number;
	widthPx: number;
	startSourceFrame: number;
	endSourceFrame: number;
	reverseColumns: boolean;
}

export function planTimelineWaveformRenderWindow(args: {
	clipFromFrame: number;
	clipDurationFrames: number;
	sourceStartFrame: number;
	sourceEndFrame: number;
	pixelsPerFrame: number;
	scrollLeft: number;
	viewportWidth: number;
	headerWidth: number;
	reversed: boolean;
	overscanPx?: number;
}): TimelineWaveformRenderWindow | null {
	const values = [
		args.clipFromFrame,
		args.clipDurationFrames,
		args.sourceStartFrame,
		args.sourceEndFrame,
		args.pixelsPerFrame,
		args.scrollLeft,
		args.viewportWidth,
		args.headerWidth,
		args.overscanPx ?? TIMELINE_WAVEFORM_OVERSCAN_PX
	];
	if (values.some((value) => !Number.isFinite(value))) return null;
	if (args.clipDurationFrames <= 0 || args.pixelsPerFrame <= 0 || args.viewportWidth <= 0)
		return null;

	const overscanPx = Math.max(0, args.overscanPx ?? TIMELINE_WAVEFORM_OVERSCAN_PX);
	const clipWidthPx = Math.max(1, args.clipDurationFrames * args.pixelsPerFrame);
	const clipLeftPx = args.headerWidth + args.clipFromFrame * args.pixelsPerFrame;
	const viewportStartPx = args.scrollLeft + args.headerWidth;
	const viewportEndPx = args.scrollLeft + args.viewportWidth;
	const renderQuantumPx = overscanPx > 0 ? TIMELINE_WAVEFORM_RENDER_QUANTUM_PX : 1;
	const leftPx = Math.max(
		0,
		Math.floor((viewportStartPx - overscanPx - clipLeftPx) / renderQuantumPx) * renderQuantumPx
	);
	const rightPx = Math.min(
		clipWidthPx,
		Math.ceil((viewportEndPx + overscanPx - clipLeftPx) / renderQuantumPx) * renderQuantumPx
	);
	if (rightPx <= leftPx) return null;

	const widthPx = Math.max(1, rightPx - leftPx);
	const startRatio = leftPx / clipWidthPx;
	const endRatio = (leftPx + widthPx) / clipWidthPx;
	const sourceSpanFrames = Math.max(0, args.sourceEndFrame - args.sourceStartFrame);
	const startSourceFrame = args.reversed
		? args.sourceEndFrame - endRatio * sourceSpanFrames
		: args.sourceStartFrame + startRatio * sourceSpanFrames;
	const endSourceFrame = args.reversed
		? args.sourceEndFrame - startRatio * sourceSpanFrames
		: args.sourceStartFrame + endRatio * sourceSpanFrames;

	return {
		clipWidthPx,
		leftPx,
		widthPx,
		startSourceFrame,
		endSourceFrame,
		reverseColumns: args.reversed
	};
}

/** Source-frame boundaries for only the waveform columns inside a rendered timeline window. */
export function mappedTimelineWaveformSourceBoundaries(args: {
	window: Pick<TimelineWaveformRenderWindow, 'clipWidthPx' | 'leftPx' | 'widthPx'>;
	clipDurationFrames: number;
	sourceFrameAtTimelineOffset: (timelineOffset: number) => number;
}): Float64Array {
	const columns = Math.max(1, Math.floor(args.window.widthPx));
	return Float64Array.from({ length: columns + 1 }, (_, column) => {
		const clipRatio =
			(args.window.leftPx + (column / columns) * args.window.widthPx) / args.window.clipWidthPx;
		return args.sourceFrameAtTimelineOffset(clipRatio * args.clipDurationFrames);
	});
}

export function waveformPolyline(
	columns: Float32Array,
	height = TIMELINE_WAVEFORM_HEIGHT,
	reverseColumns = false
): string {
	const center = height / 2;
	const pointPairs: string[] = [];
	const columnCount = Math.floor(columns.length / 2);
	for (let column = 0; column < columnCount; column += 1) {
		const sourceColumn = (reverseColumns ? columnCount - column - 1 : column) * 2;
		const min = Math.max(-1, Math.min(1, columns[sourceColumn] ?? 0));
		const max = Math.max(-1, Math.min(1, columns[sourceColumn + 1] ?? 0));
		const x = column + 0.5;
		pointPairs.push(
			`${x},${(center + min * center).toFixed(1)} ${x},${(center + max * center).toFixed(1)}`
		);
	}
	return pointPairs.join(' ');
}
