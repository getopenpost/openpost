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
	try {
		const parsed: unknown = JSON.parse(await metaBlob.text());
		const meta = parseAnimatedImageMeta(parsed);
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
		// SAFETY: every entry was null-checked above.
		return {
			frames: frames as ImageBitmap[],
			durationsMs: meta.durationsMs,
			width: meta.width,
			height: meta.height
		};
	} catch {
		return null;
	}
}

/** Validate untrusted meta.json bytes into the persisted-meta contract. */
function parseAnimatedImageMeta(input: unknown): AnimatedImageMeta | null {
	/* oxlint-disable anti-slop/no-unsafe-dictionary-type, anti-slop/require-safety-comment-for-type-assertion -- Untrusted OPFS JSON is field-validated here before any domain use. */
	const record = input as { [key: string]: unknown } | null;
	/* oxlint-enable anti-slop/no-unsafe-dictionary-type, anti-slop/require-safety-comment-for-type-assertion */
	if (!record || record.version !== 1) return null;
	const durations = record.durationsMs;
	if (
		!Array.isArray(durations) ||
		!durations.every((value) => Number.isInteger(value) && value >= 0)
	) {
		return null;
	}
	// SAFETY: Number.isInteger(record.frameCount) is proven true on this line.
	if (!Number.isInteger(record.frameCount) || (record.frameCount as number) <= 0) return null;
	// SAFETY: the Array.isArray/Number.isInteger checks above establish every
	// numeric contract used by these narrowing assertions.
	return {
		version: 1,
		durationsMs: durations as number[],
		width: Number.isInteger(record.width) ? (record.width as number) : 0,
		height: Number.isInteger(record.height) ? (record.height as number) : 0,
		frameCount: record.frameCount as number
	};
}

export async function removeAnimatedImage(mediaId: string): Promise<void> {
	await removeOpfsEntry(STORE, mediaId);
}
