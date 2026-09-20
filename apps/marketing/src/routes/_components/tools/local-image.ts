export type LocalImageFormat = 'png' | 'jpeg' | 'webp';

export const LOCAL_IMAGE_MIME = {
	png: 'image/png',
	jpeg: 'image/jpeg',
	webp: 'image/webp'
} as const satisfies Record<LocalImageFormat, string>;

export const LOCAL_IMAGE_MAX_BYTES = 50 * 1024 * 1024;
export const LOCAL_IMAGE_MAX_DIMENSION = 16_384;
export const LOCAL_IMAGE_MAX_PIXELS = 64_000_000;

export class LocalImageError extends Error {
	constructor(readonly code: 'unsupported' | 'too_large' | 'decode' | 'dimensions' | 'encode') {
		super(code);
		this.name = 'LocalImageError';
	}
}

export function validateLocalImage(
	file: Pick<File, 'size' | 'type'>,
	maxBytes = LOCAL_IMAGE_MAX_BYTES
): void {
	if (!Object.values(LOCAL_IMAGE_MIME).some((mime) => mime === file.type.toLowerCase()))
		throw new LocalImageError('unsupported');
	if (file.size <= 0 || file.size > maxBytes) throw new LocalImageError('too_large');
}

export function firstClipboardImage(event: ClipboardEvent): File | null {
	for (const item of event.clipboardData?.items ?? []) {
		if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile();
	}
	return null;
}

export class ObjectURLSlot {
	#url: string | null = null;
	#setVersion = 0;

	set(blob: Blob) {
		this.clear();
		this.#url = URL.createObjectURL(blob);
		return { url: this.#url, version: ++this.#setVersion };
	}

	isCurrent(version: number): boolean {
		return version === this.#setVersion;
	}

	clear(): void {
		if (this.#url) URL.revokeObjectURL(this.#url);
		this.#url = null;
		this.#setVersion++;
	}
}

export async function decodeLocalImage(file: File): Promise<ImageBitmap> {
	validateLocalImage(file);
	try {
		const bitmap = await createImageBitmap(file);
		if (
			!bitmap.width ||
			!bitmap.height ||
			bitmap.width > LOCAL_IMAGE_MAX_DIMENSION ||
			bitmap.height > LOCAL_IMAGE_MAX_DIMENSION ||
			bitmap.width * bitmap.height > LOCAL_IMAGE_MAX_PIXELS
		) {
			bitmap.close();
			throw new LocalImageError('dimensions');
		}
		return bitmap;
	} catch (error) {
		if (error instanceof LocalImageError) throw error;
		throw new LocalImageError('decode');
	}
}

export function canvasFromBitmap(
	bitmap: CanvasImageSource,
	width: number,
	height: number,
	matte?: string
): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new LocalImageError('decode');
	if (matte) {
		context.fillStyle = matte;
		context.fillRect(0, 0, width, height);
	}
	context.drawImage(bitmap, 0, 0, width, height);
	return canvas;
}

export async function encodeCanvas(
	canvas: HTMLCanvasElement,
	format: LocalImageFormat,
	quality = 0.9
): Promise<Blob> {
	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, LOCAL_IMAGE_MIME[format], quality)
	);
	if (!blob || blob.type !== LOCAL_IMAGE_MIME[format]) throw new LocalImageError('encode');
	return blob;
}

export interface RGBAColor {
	r: number;
	g: number;
	b: number;
	a: number;
}

export function sampleCanvasPixel(
	context: CanvasRenderingContext2D,
	x: number,
	y: number
): RGBAColor {
	const safeX = Math.max(0, Math.min(context.canvas.width - 1, Math.round(x)));
	const safeY = Math.max(0, Math.min(context.canvas.height - 1, Math.round(y)));
	const [r, g, b, a] = context.getImageData(safeX, safeY, 1, 1).data;
	return { r: r!, g: g!, b: b!, a: a! / 255 };
}

export function mapRenderedPoint(
	clientX: number,
	clientY: number,
	rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
	imageWidth: number,
	imageHeight: number
) {
	return {
		x: Math.max(
			0,
			Math.min(imageWidth - 1, Math.floor(((clientX - rect.left) / rect.width) * imageWidth))
		),
		y: Math.max(
			0,
			Math.min(imageHeight - 1, Math.floor(((clientY - rect.top) / rect.height) * imageHeight))
		)
	};
}

export function rgbaToHex({ r, g, b, a }: RGBAColor): string {
	const channels = [r, g, b, ...(a < 1 ? [Math.round(a * 255)] : [])];
	return `#${channels.map((value) => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

export function extractPalette(
	context: CanvasRenderingContext2D,
	limit = 6,
	maxAnalysisPixels = 40_000
): RGBAColor[] {
	const { width, height } = context.canvas;
	const dimensions = boundedAnalysisDimensions(width, height, maxAnalysisPixels);
	const analysis = document.createElement('canvas');
	analysis.width = dimensions.width;
	analysis.height = dimensions.height;
	const analysisContext = analysis.getContext('2d', { willReadFrequently: true });
	if (!analysisContext) throw new LocalImageError('decode');
	analysisContext.drawImage(context.canvas, 0, 0, analysis.width, analysis.height);
	const pixels = analysisContext.getImageData(0, 0, analysis.width, analysis.height).data;
	const buckets = new Map<string, { color: RGBAColor; count: number }>();
	for (let y = 0; y < analysis.height; y++) {
		for (let x = 0; x < analysis.width; x++) {
			const index = (y * analysis.width + x) * 4;
			const a = pixels[index + 3]! / 255;
			if (a < 0.1) continue;
			const r = Math.round(pixels[index]! / 32) * 32;
			const g = Math.round(pixels[index + 1]! / 32) * 32;
			const b = Math.round(pixels[index + 2]! / 32) * 32;
			const key = `${r},${g},${b}`;
			const bucket = buckets.get(key);
			if (bucket) bucket.count++;
			else
				buckets.set(key, {
					color: { r: Math.min(r, 255), g: Math.min(g, 255), b: Math.min(b, 255), a: 1 },
					count: 1
				});
		}
	}
	return [...buckets.values()]
		.sort((a, b) => b.count - a.count)
		.slice(0, limit)
		.map(({ color }) => color);
}

export function boundedAnalysisDimensions(width: number, height: number, maxPixels: number) {
	const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
	return {
		width: Math.max(1, Math.floor(width * scale)),
		height: Math.max(1, Math.floor(height * scale))
	};
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Catch handlers pass unknown failures here; this boundary narrows them before reading domain fields.
export function localImageMessage(error: unknown): string {
	if (!(error instanceof LocalImageError))
		return 'The image could not be processed. Try another file.';
	if (error.code === 'unsupported') return 'Use a PNG, JPEG, or WebP image.';
	if (error.code === 'too_large') return 'Choose an image smaller than 50 MB.';
	if (error.code === 'dimensions')
		return 'This image is too large to process safely. Use one under 64 megapixels and 16,384 pixels per side.';
	if (error.code === 'decode')
		return 'This image is damaged or cannot be decoded. Try exporting it again.';
	return 'The browser could not create the image. Try another format.';
}
