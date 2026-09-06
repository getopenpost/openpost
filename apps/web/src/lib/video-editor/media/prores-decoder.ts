/**
 * Lazily register Mediabunny's TurboRes-backed ProRes decoder in this JS realm.
 *
 * Decoder registration is realm-local, so every worker or main-thread module that
 * creates a video sample sink must call this after it identifies a ProRes track.
 * Ordinary browser-decodable media never downloads the decoder chunk.
 */

let registration: Promise<void> | null = null;

export function isProResCodec(codec: string | null | undefined): boolean {
	return codec?.trim().toLowerCase() === 'prores';
}

export function ensureProResDecoderForCodec(codec: string | null | undefined): Promise<void> {
	if (!isProResCodec(codec)) return Promise.resolve();
	if (!registration) {
		registration = (async () => {
			try {
				const { registerProresDecoder } = await import('@mediabunny/prores');
				registerProresDecoder();
			} catch (error) {
				registration = null;
				throw error;
			}
		})();
	}
	return registration;
}
