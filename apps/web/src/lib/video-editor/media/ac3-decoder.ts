/** Lazily register Mediabunny's AC-3/E-AC-3 decoder in the current JS realm. */

const AC3_CODEC_PATTERN = /(^|[^a-z0-9])(ac-?3|ec-?3|e-?ac-?3|eac3)([^a-z0-9]|$)/i;

let registration: Promise<void> | null = null;

export function isAc3AudioCodec(codec: string | null | undefined): boolean {
	if (!codec) return false;
	const normalized = codec.trim().toLowerCase();
	if (AC3_CODEC_PATTERN.test(normalized)) return true;
	return normalized.replace(/[_-]+/g, ' ').includes('dolby digital');
}

export function ensureAc3DecoderForCodec(codec: string | null | undefined): Promise<void> {
	if (!isAc3AudioCodec(codec)) return Promise.resolve();
	if (!registration) {
		registration = (async () => {
			try {
				const { registerAc3Decoder } = await import('@mediabunny/ac3');
				registerAc3Decoder();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (!/already registered/i.test(message)) {
					registration = null;
					throw error;
				}
			}
		})();
	}
	return registration;
}
