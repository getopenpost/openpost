/** OPFS filmstrip persistence with ImageBitmap and object-URL hydration. */
import { readOpfsBlob, writeOpfsBlob } from './opfs-cache';

export interface PersistedFilmstripFrame {
	index: number;
	url: string;
	bitmap?: ImageBitmap;
}

export async function saveFilmstripFrame(
	mediaId: string,
	index: number,
	blob: Blob
): Promise<void> {
	await writeOpfsBlob('filmstrips', mediaId, `${index}.frame`, blob);
}

export async function saveFilmstripIndex(mediaId: string, indices: number[]): Promise<void> {
	await writeOpfsBlob(
		'filmstrips',
		mediaId,
		'index.json',
		new Blob([JSON.stringify({ version: 1, indices })], { type: 'application/json' })
	);
}

export async function loadFilmstrip(mediaId: string): Promise<PersistedFilmstripFrame[]> {
	const indexBlob = await readOpfsBlob('filmstrips', mediaId, 'index.json');
	if (!indexBlob) return [];
	let indices: number[];
	try {
		const parsed = JSON.parse(await indexBlob.text());
		indices = Array.isArray(parsed.indices) ? parsed.indices.filter(Number.isInteger) : [];
	} catch {
		return [];
	}
	const frames = await Promise.all(
		indices.map(async (index) => {
			const blob = await readOpfsBlob('filmstrips', mediaId, `${index}.frame`);
			if (!blob) return null;
			let bitmap: ImageBitmap | undefined;
			try {
				bitmap = await createImageBitmap(blob);
			} catch {
				bitmap = undefined;
			}
			return { index, url: URL.createObjectURL(blob), bitmap };
		})
	);
	const restored: PersistedFilmstripFrame[] = [];
	for (const frame of frames) {
		if (frame) restored.push(frame);
	}
	return restored;
}
