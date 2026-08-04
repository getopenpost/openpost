import { sha256 } from '@noble/hashes/sha256';
import { BUNDLED_AUDIO_MANIFEST } from './bundled-audio.generated';

export type BundledAudioItem = (typeof BUNDLED_AUDIO_MANIFEST.assets)[number];
export const BUNDLED_AUDIO_ITEMS: readonly BundledAudioItem[] = BUNDLED_AUDIO_MANIFEST.assets;

export async function loadBundledAudio(
	item: BundledAudioItem,
	signal?: AbortSignal
): Promise<File> {
	const response = await fetch(item.path, { signal });
	if (!response.ok) throw new Error(`The bundled audio asset ${item.name} could not be loaded.`);
	const bytes = new Uint8Array(await response.arrayBuffer());
	const digest = Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
	if (bytes.byteLength !== item.size_bytes || digest !== item.sha256) {
		throw new Error(`The bundled audio asset ${item.name} failed its integrity check.`);
	}
	return new File([bytes], `${item.id}.wav`, {
		type: item.mime_type,
		lastModified: 0
	});
}
