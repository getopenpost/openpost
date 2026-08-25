/** OPFS animated-image frame persistence with ImageBitmap hydration. */
import { readOpfsBlob, removeOpfsEntry, writeOpfsBlob } from './opfs-cache';

export interface PersistedAnimatedImage {
	durationsMs: number[];
	width: number;
	height: number;
	frames: ImageBitmap[];
}

interface AnimatedImageMeta {
	version: 1;
	durationsMs: number[];
	width: number;
	height: number;
	frameCount: number;
}

const STORE = 'animated-images';

export async function saveAnimatedImageFrame(
	mediaId: string,
	index: number,
	blob: Blob
): Promise<void> {
	await writeOpfsBlob(STORE, mediaId, `${index}.frame`, blob);
}

export async function saveAnimatedImageMeta(
	mediaId: string,
	meta: Omit<AnimatedImageMeta, 'version'>
): Promise<void> {
	await writeOpfsBlob(
		STORE,
		mediaId,
		'meta.json',
		new Blob([JSON.stringify({ version: 1, ...meta })], { type: 'application/json' })
	);
}

export async function loadAnimatedImage(mediaId: string): Promise<PersistedAnimatedImage | null> {
	const metaBlob = await readOpfsBlob(STORE, mediaId, 'meta.json');
	if (!metaBlob) return null;
	let meta: AnimatedImageMeta | null = null;
	try {
		const parsed = JSON.parse(await metaBlob.text()) as Partial<AnimatedImageMeta>;
		if (
			parsed.version === 1 &&
			Array.isArray(parsed.durationsMs) &&
			parsed.durationsMs.every((value) => typeof value === 'number' && value >= 0) &&
			typeof parsed.frameCount === 'number' &&
			parsed.frameCount > 0
		) {
			meta = {
				version: 1,
				durationsMs: parsed.durationsMs,
				width: parsed.width ?? 0,
				height: parsed.height ?? 0,
				frameCount: parsed.frameCount
			};
		}
	} catch {
		return null;
	}
	if (!meta || meta.durationsMs.length !== meta.frameCount) return null;

	const frames = await Promise.all(
		meta.durationsMs.map(async (_, index) => {
			const blob = await readOpfsBlob(STORE, mediaId, `${index}.frame`);
			if (!blob) return null;
			try {
				return await createImageBitmap(blob);
			} catch {
				return null;
			}
		})
	);
	if (frames.some((frame) => frame === null)) {
		for (const frame of frames) frame?.close();
		return null;
	}
	return {
		// SAFETY: every entry was null-checked above.
		frames: frames as ImageBitmap[],
		durationsMs: meta.durationsMs,
		width: meta.width,
		height: meta.height
	};
}

export async function removeAnimatedImage(mediaId: string): Promise<void> {
	await removeOpfsEntry(STORE, mediaId);
}
