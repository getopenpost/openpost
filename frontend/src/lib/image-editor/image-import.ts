import { rasterizeSVGToPNG, isSVGFile } from '$lib/media/svg-rasterize';
import { IMAGE_EDITOR_LIMITS } from './types';

export const IMAGE_EDITOR_IMPORT_LIMITS = {
	maxFileBytes: 50 * 1024 * 1024,
	maxDimension: IMAGE_EDITOR_LIMITS.maxDimension * 2,
	maxPixels: IMAGE_EDITOR_LIMITS.maxPixels,
	maxBatchDecodedBytes: 256 * 1024 * 1024
} as const;

export type ImageEditorImportErrorCode =
	| 'unsupported_type'
	| 'file_too_large'
	| 'unsafe_svg'
	| 'decode_failed'
	| 'dimensions_too_large'
	| 'batch_memory_limit'
	| 'layer_limit';

export class ImageEditorImportError extends Error {
	readonly code: ImageEditorImportErrorCode;

	constructor(code: ImageEditorImportErrorCode) {
		super(code);
		this.name = 'ImageEditorImportError';
		this.code = code;
	}
}

export interface PreparedImageEditorImport {
	file: File;
	width: number;
	height: number;
	decodedBytes: number;
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
	avif: 'image/avif',
	gif: 'image/gif',
	jpeg: 'image/jpeg',
	jpg: 'image/jpeg',
	png: 'image/png',
	svg: 'image/svg+xml',
	webp: 'image/webp'
};
const ALLOWED_MIMES = new Set(Object.values(MIME_BY_EXTENSION));
const RASTER_GUEST_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function imageEditorImportMIME(file: Pick<File, 'name' | 'type'>): string | null {
	const declared = file.type.trim().toLowerCase();
	if (ALLOWED_MIMES.has(declared)) return declared;
	if (declared && declared !== 'application/octet-stream') return null;
	const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
	return MIME_BY_EXTENSION[extension] ?? null;
}

export function availableImageEditorImportSlots(layerCount: number): number {
	return Math.max(0, IMAGE_EDITOR_LIMITS.maxLayersPerPage - Math.max(0, layerCount));
}

export function assertImageEditorImportAdmission(
	file: Pick<File, 'name' | 'type' | 'size'>
): string {
	const mime = imageEditorImportMIME(file);
	if (!mime) throw new ImageEditorImportError('unsupported_type');
	if (file.size <= 0 || file.size > IMAGE_EDITOR_IMPORT_LIMITS.maxFileBytes) {
		throw new ImageEditorImportError('file_too_large');
	}
	return mime;
}

export async function prepareImageEditorImport(
	file: File,
	options: { guestMode: boolean }
): Promise<PreparedImageEditorImport> {
	const mime = assertImageEditorImportAdmission(file);
	let prepared = file;
	if (isSVGFile(file)) {
		await assertSafeImageEditorSVG(file);
		try {
			prepared = await rasterizeSVGToPNG(file);
		} catch {
			throw new ImageEditorImportError('decode_failed');
		}
	}

	let dimensions = await decodeImageEditorImportDimensions(prepared);
	assertImageEditorImportDimensions(dimensions.width, dimensions.height);
	if (options.guestMode && !RASTER_GUEST_MIMES.has(prepared.type || mime)) {
		prepared = await rasterizeImageEditorImport(prepared, dimensions.width, dimensions.height);
		dimensions = await decodeImageEditorImportDimensions(prepared);
	}

	return {
		file: prepared,
		width: dimensions.width,
		height: dimensions.height,
		decodedBytes: dimensions.width * dimensions.height * 4
	};
}

export function assertImageEditorImportDimensions(width: number, height: number): void {
	if (
		!Number.isInteger(width) ||
		!Number.isInteger(height) ||
		width < 1 ||
		height < 1 ||
		width > IMAGE_EDITOR_IMPORT_LIMITS.maxDimension ||
		height > IMAGE_EDITOR_IMPORT_LIMITS.maxDimension ||
		width * height > IMAGE_EDITOR_IMPORT_LIMITS.maxPixels
	) {
		throw new ImageEditorImportError('dimensions_too_large');
	}
}

export function assertImageEditorBatchMemory(currentBytes: number, nextBytes: number): number {
	const total = currentBytes + nextBytes;
	if (total > IMAGE_EDITOR_IMPORT_LIMITS.maxBatchDecodedBytes) {
		throw new ImageEditorImportError('batch_memory_limit');
	}
	return total;
}

export async function assertSafeImageEditorSVG(file: Blob): Promise<void> {
	let source = '';
	try {
		source = await file.text();
	} catch {
		throw new ImageEditorImportError('unsafe_svg');
	}
	if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source)) {
		throw new ImageEditorImportError('unsafe_svg');
	}
	if (
		!/<svg\b/i.test(source) ||
		/<(?:script|foreignObject|iframe|object|embed|audio|video)\b/i.test(source) ||
		/\son[a-z]+\s*=/i.test(source)
	) {
		throw new ImageEditorImportError('unsafe_svg');
	}
	for (const match of source.matchAll(/(?:href|xlink:href)\s*=\s*(['"])(.*?)\1/gi)) {
		if (!safeSVGReference(match[2]?.trim() ?? '')) {
			throw new ImageEditorImportError('unsafe_svg');
		}
	}
	if (unsafeSVGStyle(source)) throw new ImageEditorImportError('unsafe_svg');
	if (typeof DOMParser === 'undefined') return;
	const parser = new DOMParser();
	const document = parser.parseFromString(source, 'image/svg+xml');
	if (
		document.querySelector('parsererror') ||
		document.documentElement.localName.toLowerCase() !== 'svg' ||
		document.querySelector('script, foreignObject, iframe, object, embed, audio, video')
	) {
		throw new ImageEditorImportError('unsafe_svg');
	}
	for (const element of document.querySelectorAll('*')) {
		for (const attribute of [...element.attributes]) {
			const name = attribute.name.toLowerCase();
			const value = attribute.value.trim();
			if (name.startsWith('on')) throw new ImageEditorImportError('unsafe_svg');
			if ((name === 'href' || name.endsWith(':href')) && !safeSVGReference(value)) {
				throw new ImageEditorImportError('unsafe_svg');
			}
			if (name === 'style' && unsafeSVGStyle(value)) {
				throw new ImageEditorImportError('unsafe_svg');
			}
		}
	}
	for (const style of document.querySelectorAll('style')) {
		if (unsafeSVGStyle(style.textContent ?? '')) throw new ImageEditorImportError('unsafe_svg');
	}
}

function safeSVGReference(value: string): boolean {
	if (!value || value.startsWith('#')) return true;
	return /^data:image\/(?:png|jpeg|webp);base64,/i.test(value);
}

function unsafeSVGStyle(value: string): boolean {
	if (/@import/i.test(value)) return true;
	return [...value.matchAll(/url\(([^)]+)\)/gi)].some((match) => {
		const reference = match[1]?.trim().replace(/^['"]|['"]$/g, '') ?? '';
		return !reference.startsWith('#');
	});
}

async function decodeImageEditorImportDimensions(
	file: Blob
): Promise<{ width: number; height: number }> {
	try {
		if (typeof createImageBitmap === 'function') {
			const bitmap = await createImageBitmap(file);
			const dimensions = { width: bitmap.width, height: bitmap.height };
			bitmap.close();
			return dimensions;
		}
		const objectURL = URL.createObjectURL(file);
		try {
			const image = new Image();
			image.decoding = 'async';
			image.src = objectURL;
			await image.decode();
			return { width: image.naturalWidth, height: image.naturalHeight };
		} finally {
			URL.revokeObjectURL(objectURL);
		}
	} catch {
		throw new ImageEditorImportError('decode_failed');
	}
}

async function rasterizeImageEditorImport(
	file: File,
	width: number,
	height: number
): Promise<File> {
	try {
		const bitmap = await createImageBitmap(file);
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Canvas unavailable');
		context.drawImage(bitmap, 0, 0);
		bitmap.close();
		const blob = await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(
				(value) => (value ? resolve(value) : reject(new Error('PNG encoding failed'))),
				'image/png'
			);
		});
		return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'image'}.png`, {
			type: 'image/png',
			lastModified: file.lastModified
		});
	} catch {
		throw new ImageEditorImportError('decode_failed');
	}
}
