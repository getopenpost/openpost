import noise from './noise-data.json';

let pixels: Uint8Array | undefined;

/** Exact Paper noise texture, decoded without Image, a network request, or a DOM. */
export function paperNoisePixels() {
	if (!pixels) {
		const palette = atob(noise.palette);
		const indices = atob(noise.pixels);
		pixels = new Uint8Array(indices.length * 4);
		for (let i = 0; i < indices.length; i++) {
			const index = indices.charCodeAt(i) * 3;
			pixels.set(
				[
					palette.charCodeAt(index),
					palette.charCodeAt(index + 1),
					palette.charCodeAt(index + 2),
					255
				],
				i * 4
			);
		}
	}
	return { width: noise.width, height: noise.height, data: pixels };
}
