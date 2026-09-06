export type ScopeCanvasSource = HTMLCanvasElement | OffscreenCanvas;

export const SEQUENCE_SCOPE_SAMPLE_ID = 'sequence-output';

export interface ScopeSample {
	itemId: string;
	source: ScopeCanvasSource | null;
	image: ImageData | null;
}

let sample = $state<ScopeSample | null>(null);

function readImage(target: ScopeSample): ImageData | null {
	if (target.image) return target.image;
	const source = target.source;
	if (!source) return null;
	try {
		// SAFETY: Both allowed source types expose a 2D context with getImageData.
		const context = source.getContext('2d', { willReadFrequently: true }) as
			| CanvasRenderingContext2D
			| OffscreenCanvasRenderingContext2D
			| null;
		if (!context) return null;
		target.image = context.getImageData(0, 0, source.width, source.height);
		return target.image;
	} catch {
		return null;
	}
}

export const scopeSamples = {
	get current() {
		return sample;
	},
	publish(itemId: string, image: ImageData): void {
		sample = { itemId, image, source: null };
	},
	publishCanvas(itemId: string, source: ScopeCanvasSource, image: ImageData | null = null): void {
		sample = { itemId, image, source };
	},
	readImage(target: ScopeSample): ImageData | null {
		return readImage(target);
	},
	clear(itemId: string): void {
		if (sample?.itemId === itemId) sample = null;
	}
};
