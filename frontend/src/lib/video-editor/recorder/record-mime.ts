// Pure MIME and estimate helpers for recorder - no Svelte runes, safe for node tests
export const VIDEO_MIME_CANDIDATES = [
	'video/webm;codecs=vp9,opus',
	'video/webm;codecs=vp8,opus',
	'video/webm'
] as const;

export const AUDIO_MIME_CANDIDATES = [
	'audio/webm;codecs=opus',
	'audio/webm',
	'audio/ogg;codecs=opus'
] as const;

export type RecorderVideoResolution = '720p' | '1080p' | '2160p';
export type RecorderVideoFrameRate = 24 | 30 | 60;
export type RecorderCameraFacingMode = 'default' | 'user' | 'environment';

export interface RecorderCaptureQuality {
	videoResolution?: RecorderVideoResolution;
	videoFrameRate?: RecorderVideoFrameRate;
	includeSystemAudio?: boolean;
}

export const RECORDER_AUDIO_BITS_PER_SECOND = 128_000;

const VIDEO_BITS_PER_SECOND = {
	'720p': { standard: 4_000_000, highFrameRate: 6_000_000 },
	'1080p': { standard: 8_000_000, highFrameRate: 12_000_000 },
	'2160p': { standard: 24_000_000, highFrameRate: 40_000_000 }
} as const satisfies Record<RecorderVideoResolution, { standard: number; highFrameRate: number }>;

export function pickVideoMimeType(): string {
	if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
	for (const candidate of VIDEO_MIME_CANDIDATES) {
		if (MediaRecorder.isTypeSupported(candidate)) return candidate;
	}
	return '';
}

export function pickAudioMimeType(): string {
	if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
	for (const candidate of AUDIO_MIME_CANDIDATES) {
		if (MediaRecorder.isTypeSupported(candidate)) return candidate;
	}
	return '';
}

export function recorderMimeType(includeVideo: boolean): string {
	return includeVideo ? pickVideoMimeType() : pickAudioMimeType();
}

export function recorderVideoBitsPerSecond(quality: RecorderCaptureQuality): number | undefined {
	const resolution = quality.videoResolution;
	if (!resolution) return undefined;
	const rates = VIDEO_BITS_PER_SECOND[resolution];
	return quality.videoFrameRate === 60 ? rates.highFrameRate : rates.standard;
}

export function estimateBytesPerMinute(
	selection: { screen: boolean; camera: boolean; microphone: boolean },
	quality: RecorderCaptureQuality = {}
): number {
	const selectedVideoBitsPerSecond = recorderVideoBitsPerSecond(quality);
	let bytes = 0;
	if (selection.screen) {
		bytes += ((selectedVideoBitsPerSecond ?? 8_000_000) * 60) / 8;
		if (quality.includeSystemAudio !== false) bytes += (RECORDER_AUDIO_BITS_PER_SECOND * 60) / 8;
	}
	if (selection.camera) {
		bytes += ((selectedVideoBitsPerSecond ?? 8_000_000) * 60) / 8;
	}
	if (selection.microphone) bytes += (RECORDER_AUDIO_BITS_PER_SECOND * 60) / 8;
	return bytes;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type RecorderErrorCode =
	| 'permission-denied'
	| 'no-device'
	| 'device-busy'
	| 'storage-full'
	| 'unsupported'
	| 'start-failed'
	| 'stop-timeout'
	| 'unknown';

export function mapRecorderError(cause: unknown): RecorderErrorCode {
	const name = cause instanceof DOMException ? cause.name : '';
	if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission-denied';
	if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-device';
	if (name === 'NotReadableError' || name === 'AbortError') return 'device-busy';
	if (name === 'QuotaExceededError') return 'storage-full';
	if (cause instanceof Error && cause.message.includes('not supported')) return 'unsupported';
	if (cause instanceof Error && cause.message.toLowerCase().includes('timeout'))
		return 'stop-timeout';
	if (name === 'NotSupportedError') return 'unsupported';
	return 'start-failed';
}
