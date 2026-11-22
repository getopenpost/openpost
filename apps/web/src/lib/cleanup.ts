/**
 * Best-effort disposal helper for teardown paths (WebGL resources, codecs,
 * MediaStreams, scratch files) where cleanup errors must not mask the
 * primary result or error.
 */
export function ignoreCleanupError(fn: () => void): void {
	try {
		fn();
	} catch {
		// Disposal errors during teardown are intentionally ignored.
	}
}

/**
 * Best-effort async disposal helper for teardown paths (WritableStream,
 * OPFS handles, media encoders/decoders).
 */
export async function ignoreAsyncCleanupError(fn: () => Promise<void>): Promise<void> {
	try {
		await fn();
	} catch {
		// Disposal errors during teardown are intentionally ignored.
	}
}
