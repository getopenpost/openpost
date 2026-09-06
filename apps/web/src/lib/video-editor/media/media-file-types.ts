import { assertSafeSvg } from '$lib/media/safe-svg';
import { isSVGFile, rasterizeSVGToPNG } from '$lib/media/svg-rasterize';

const EXTENSION_MIME_TYPES = new Map([
	['.aac', 'audio/aac'],
	['.flac', 'audio/flac'],
	['.gif', 'image/gif'],
	['.jpeg', 'image/jpeg'],
	['.jpg', 'image/jpeg'],
	['.m4a', 'audio/mp4'],
	['.m4v', 'video/mp4'],
	['.mkv', 'video/x-matroska'],
	['.mov', 'video/quicktime'],
	['.mp3', 'audio/mpeg'],
	['.mp4', 'video/mp4'],
	['.ogg', 'audio/ogg'],
	['.opus', 'audio/ogg'],
	['.png', 'image/png'],
	['.svg', 'image/svg+xml'],
	['.wav', 'audio/wav'],
	['.webm', 'video/webm'],
	['.webp', 'image/webp']
]);

const GENERIC_MIME_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream']);
const EXTENSION_PREFERRED = new Set(['.m4a', '.mkv', '.svg']);

export function inferredMediaMimeType(file: Pick<File, 'name' | 'type'>): string {
	const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
	const inferred = EXTENSION_MIME_TYPES.get(extension);
	if (inferred && (GENERIC_MIME_TYPES.has(file.type) || EXTENSION_PREFERRED.has(extension))) {
		return inferred;
	}
	return file.type || inferred || 'application/octet-stream';
}

export function fileWithInferredMediaType(file: File): File {
	const type = inferredMediaMimeType(file);
	return type === file.type
		? file
		: new File([file], file.name, { type, lastModified: file.lastModified });
}

export async function prepareMediaImportFile(file: File): Promise<File> {
	const typed = fileWithInferredMediaType(file);
	if (!isSVGFile(typed)) return typed;
	await assertSafeSvg(typed);
	return rasterizeSVGToPNG(typed);
}

export function effectiveMediaStorageMode(
	requested: 'copy' | 'link',
	original: Pick<File, 'name'>,
	prepared: Pick<File, 'name'>
): 'copy' | 'link' {
	return requested === 'link' && prepared.name !== original.name ? 'copy' : requested;
}
