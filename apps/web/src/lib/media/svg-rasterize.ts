const MAX_RASTER_DIMENSION = 4096;
const MAX_RASTER_PIXELS = 16_777_216;

export function isSVGFile(file: File): boolean {
	return file.type.toLowerCase() === 'image/svg+xml' || /\.svg$/i.test(file.name);
}

export async function rasterizeSVGToPNG(file: File): Promise<File> {
	if (!isSVGFile(file)) return file;
	if (!globalThis.document) {
		throw new Error('SVG conversion requires a browser');
	}

	const objectURL = URL.createObjectURL(file);
	try {
		const image = new Image();
		image.decoding = 'async';
		image.src = objectURL;
		await image.decode();

		const sourceWidth = image.naturalWidth;
		const sourceHeight = image.naturalHeight;
		if (sourceWidth <= 0 || sourceHeight <= 0) {
			throw new Error('SVG has no drawable size');
		}

		const scale = Math.min(
			1,
			MAX_RASTER_DIMENSION / sourceWidth,
			MAX_RASTER_DIMENSION / sourceHeight,
			Math.sqrt(MAX_RASTER_PIXELS / (sourceWidth * sourceHeight))
		);
		const width = Math.max(1, Math.round(sourceWidth * scale));
		const height = Math.max(1, Math.round(sourceHeight * scale));
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext('2d');
		if (!context) throw new Error('PNG canvas is unavailable');
		context.drawImage(image, 0, 0, width, height);

		const png = await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(
				(blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))),
				'image/png'
			);
		});
		const filename = /\.svg$/i.test(file.name)
			? file.name.replace(/\.svg$/i, '.png')
			: `${file.name || 'image'}.png`;
		return new File([png], filename, { type: 'image/png', lastModified: file.lastModified });
	} finally {
		URL.revokeObjectURL(objectURL);
	}
}
