import {
	readScopeImage,
	type ScopeSample,
	type ScopeCanvasSource
} from '$lib/editor-color-grade/scopes';
export * from '$lib/editor-color-grade/scopes';
let sample = $state<ScopeSample | null>(null);

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
		return readScopeImage(target);
	},
	clear(itemId: string): void {
		if (sample?.itemId === itemId) sample = null;
	}
};
