import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	RECORDER_AUDIO_BITS_PER_SECOND,
	estimateBytesPerMinute,
	formatBytes,
	mapRecorderError,
	pickAudioMimeType,
	pickVideoMimeType,
	recorderVideoBitsPerSecond
} from './record-mime';

describe('record-mime helpers', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('returns empty when no MIME is supported', () => {
		class FakeRecorder {
			static isTypeSupported(): boolean {
				return false;
			}
		}
		vi.stubGlobal('MediaRecorder', FakeRecorder);
		expect(pickVideoMimeType()).toBe('');
		expect(pickAudioMimeType()).toBe('');
	});

	it('records when the browser supports MP4 but not WebM', () => {
		vi.stubGlobal('MediaRecorder', {
			isTypeSupported: (type: string) => type === 'video/mp4' || type === 'audio/mp4'
		});
		expect(pickVideoMimeType()).toBe('video/mp4');
		expect(pickAudioMimeType()).toBe('audio/mp4');
	});

	it('maps DOMException names to stable error codes', () => {
		expect(mapRecorderError(new DOMException('', 'NotAllowedError'))).toBe('permission-denied');
		expect(mapRecorderError(new DOMException('', 'NotFoundError'))).toBe('no-device');
		expect(mapRecorderError(new DOMException('', 'NotReadableError'))).toBe('device-busy');
		expect(mapRecorderError(new DOMException('', 'QuotaExceededError'))).toBe('storage-full');
		expect(mapRecorderError(new DOMException('', 'NotSupportedError'))).toBe('unsupported');
		expect(mapRecorderError(new Error('not supported'))).toBe('unsupported');
		expect(mapRecorderError(new Error('timeout'))).toBe('stop-timeout');
	});
});
