/** Error classification shared by the local transcription queue and its tests. */

const OUT_OF_MEMORY_PATTERNS = [
	/out of memory/i,
	/\boom\b/i,
	/insufficient memory/i,
	/allocation failed/i,
	/failed to allocate/i,
	/cannot allocate/i,
	/memory allocation/i,
	/array buffer allocation/i,
	/device lost/i,
	/webgpu.*buffer/i,
	/createbuffer/i,
	/wasm memory/i,
	/maximum.*memory/i
];

/** Ported from FreeCut (MIT), shared/utils/transcription-cancellation.ts. */
export function isTranscriptionOutOfMemoryError(error: unknown): boolean {
	if (error instanceof RangeError) return true;
	if (typeof error === 'string') {
		return OUT_OF_MEMORY_PATTERNS.some((pattern) => pattern.test(error));
	}
	if (!(error instanceof Error)) return false;
	const message = `${error.message} ${error.name}`;
	return OUT_OF_MEMORY_PATTERNS.some((pattern) => pattern.test(message));
}
