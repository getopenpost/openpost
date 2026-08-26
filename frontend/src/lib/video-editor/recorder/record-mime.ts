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

export function estimateBytesPerMinute(selection: {
	screen: boolean;
	camera: boolean;
	microphone: boolean;
}): number {
	let bytes = 0;
	if (selection.screen) bytes += 6 * 1024 * 1024;
	if (selection.camera) bytes += 4 * 1024 * 1024;
	if (selection.microphone) bytes += 0.6 * 1024 * 1024;
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
