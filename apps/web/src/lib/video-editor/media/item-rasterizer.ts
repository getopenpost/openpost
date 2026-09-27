import type { TimelineItem } from '../project/types';
import { renderShapeItemRaster } from '../shapes/render';
import { isTextMotionActive } from '../timeline/text-motion-eval';
import { activeWordIndexAtFrame } from '../transcript/karaoke';
import type { StackLayerSource } from './canvas-stack-compositor';
import { selectCuesAtFrame } from './render-plan';
import {
	renderSubtitleCueRaster,
	renderSubtitleRaster,
	renderTextItemRaster,
	textRasterFontKey
} from './text-raster';

const MAX_RASTER_BYTES = 32 * 1024 * 1024;
const MAX_RASTERS = 16;
const BYTES_PER_PIXEL = 4;

interface Raster {
	canvas: OffscreenCanvas;
	key: string;
}

/** Owns borrowed sources until compositing finishes, including both transition branches. */
export class ItemRasterizer {
	private readonly rasters = new Map<string, Raster>();
	private bytes = 0;

	constructor(
		private readonly width: number,
		private readonly height: number,
		private readonly fps: number
	) {}

	render(item: TimelineItem, frame: number): StackLayerSource | null {
		const cue = item.type === 'subtitle' ? selectCuesAtFrame(item.cues ?? [], frame)[0] : undefined;
		if (item.type === 'subtitle' && !cue) return null;
		const width = Math.max(1, Math.round(item.transform?.width ?? this.width));
		const height = Math.max(1, Math.round(item.transform?.height ?? this.height));
		const karaoke = item.captionHighlightMode === 'karaoke' && !!cue?.words?.length;
		const animated =
			item.type === 'text' &&
			(item.timer ||
				(item.textMotion &&
					isTextMotionActive(item.textMotion, frame - item.from, item.durationInFrames)));
		// Animation has already resolved these properties. Effects and placement run
		// after rasterization; exclude large LUTs and the inactive subtitle cue list.
		const key = JSON.stringify([
			{
				...item,
				effects: undefined,
				keyframes: undefined,
				cues: undefined,
				transform: { aspectRatioLocked: item.transform?.aspectRatioLocked }
			},
			width,
			height,
			cue,
			animated ? frame : undefined,
			karaoke ? activeWordIndexAtFrame(cue?.words, frame) : undefined,
			item.type === 'shape' ? undefined : textRasterFontKey()
		]);
		let raster = this.rasters.get(item.id);
		this.rasters.delete(item.id);
		if (!raster) raster = { canvas: new OffscreenCanvas(width, height), key: '' };
		else this.bytes -= raster.canvas.width * raster.canvas.height * BYTES_PER_PIXEL;
		this.rasters.set(item.id, raster);
		this.bytes += width * height * BYTES_PER_PIXEL;
		if (raster.key !== key) {
			if (raster.canvas.width !== width) raster.canvas.width = width;
			if (raster.canvas.height !== height) raster.canvas.height = height;
			const context = raster.canvas.getContext('2d');
			if (!context) throw new Error('Failed to create the item raster context.');
			// Match a fresh canvas even if a prior painter left text or clipping state behind.
			context.reset();
			if (item.type === 'shape') renderShapeItemRaster(context, item, width, height);
			else if (cue && karaoke) renderSubtitleCueRaster(context, cue, item, width, height, frame);
			else if (cue) renderSubtitleRaster(context, cue.text, item, width, height);
			else
				renderTextItemRaster(context, item, width, height, { absoluteFrame: frame, fps: this.fps });
			raster.key = key;
		}
		return { source: raster.canvas, width, height };
	}

	/** Call after consuming the borrowed sources, never between transition participants. */
	release(): void {
		for (const [id, raster] of this.rasters) {
			if (this.bytes <= MAX_RASTER_BYTES && this.rasters.size <= MAX_RASTERS) break;
			this.bytes -= raster.canvas.width * raster.canvas.height * BYTES_PER_PIXEL;
			raster.canvas.width = 0;
			raster.canvas.height = 0;
			this.rasters.delete(id);
		}
	}

	dispose(): void {
		for (const raster of this.rasters.values()) {
			raster.canvas.width = 0;
			raster.canvas.height = 0;
		}
		this.rasters.clear();
		this.bytes = 0;
	}
}
