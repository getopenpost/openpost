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

	it('picks first supported video and audio MIME in priority order', () => {
		class FakeRecorder {
			static isTypeSupported(type: string): boolean {
				return type === 'video/webm;codecs=vp9,opus' || type === 'audio/webm;codecs=opus';
			}
		}
		vi.stubGlobal('MediaRecorder', FakeRecorder);
		expect(pickVideoMimeType()).toBe('video/webm;codecs=vp9,opus');
		expect(pickAudioMimeType()).toBe('audio/webm;codecs=opus');
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
