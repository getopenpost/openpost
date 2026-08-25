/** Single boundary for bounded streaming thresholds and capability checks. */

export const IN_MEMORY_OUTPUT_LIMIT = 2 * 1024 ** 3;
export const STREAMING_THRESHOLD_BYTES = 50 * 1024 * 1024;
export const CHUNKED_SAVE_THRESHOLD_BYTES = 20 * 1024 * 1024;
export const SAVE_CHUNK_SIZE = 4 * 1024 * 1024;
export const RESERVED_HEADROOM_BYTES = 512 * 1024 * 1024;
export const STREAMING_TEMP_DIRECTORY = 'openpost-video-streams';

export function isStreamingAvailable(): boolean {
	try {
		return !!globalThis.navigator?.storage?.getDirectory;
	} catch {
		return false;
	}
}

export function shouldStreamForBytes(estimatedBytes: number): boolean {
	if (!Number.isFinite(estimatedBytes) || estimatedBytes <= 0) return false;
	return estimatedBytes > STREAMING_THRESHOLD_BYTES;
}

export function isStorageEstimateAvailable(): boolean {
	try {
		// oxlint-disable-next-line anti-slop/no-runtime-typeof -- Optional platform API feature detection.
		return typeof globalThis.navigator?.storage?.estimate === 'function';
	} catch {
		return false;
	}
}

export async function estimateAvailableStorageBytes(): Promise<number | null> {
	try {
		const est = await globalThis.navigator.storage.estimate();
		// oxlint-disable-next-line anti-slop/no-runtime-typeof -- Storage estimate shape is untrusted JSON.
		if (typeof est.quota === 'number' && typeof est.usage === 'number') {
			const available = est.quota - est.usage - RESERVED_HEADROOM_BYTES;
			return Math.max(0, available);
		}
		// oxlint-disable-next-line anti-slop/no-runtime-typeof -- Storage estimate shape is untrusted JSON.
		if (typeof est.quota === 'number') {
			return Math.max(0, est.quota - RESERVED_HEADROOM_BYTES);
		}
		return null;
	} catch {
		return null;
	}
}
