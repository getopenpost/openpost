import { isAc3AudioCodec } from './ac3-decoder';

const UNSUPPORTED_AUDIO_CODECS = ['dts', 'dtsc', 'dtse', 'dtsh', 'dtsl', 'truehd', 'mlpa'];

export function isAudioCodecSupported(codec: string | null | undefined): boolean {
	if (!codec || isAc3AudioCodec(codec)) return true;
	const normalized = codec.trim().toLowerCase();
	return !UNSUPPORTED_AUDIO_CODECS.some((unsupported) => normalized.includes(unsupported));
}
