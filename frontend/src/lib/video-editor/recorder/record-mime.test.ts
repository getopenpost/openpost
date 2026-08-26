import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
	estimateBytesPerMinute,
	formatBytes,
	mapRecorderError,
	pickAudioMimeType,
	pickVideoMimeType
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
		expect(mapRecorderError(new DOMException('', 'NotSupportedError'))).toBe('unsupported');
		expect(mapRecorderError(new Error('not supported'))).toBe('unsupported');
		expect(mapRecorderError(new Error('timeout'))).toBe('stop-timeout');
	});

	it('estimates bytes with 20% headroom and formats correctly', () => {
		const perMin = estimateBytesPerMinute({ screen: true, camera: true, microphone: true });
		const perMinMic = estimateBytesPerMinute({ screen: false, camera: false, microphone: true });
		expect(perMin).toBeGreaterThan(perMinMic);
		expect(formatBytes(500)).toBe('500 B');
		expect(formatBytes(2048)).toBe('2.0 KB');
		expect(formatBytes(6 * 1024 * 1024)).toBe('6.0 MB');
		const withHeadroom = Math.ceil(perMin * 5 * 1.2);
		expect(withHeadroom).toBeGreaterThan(perMin * 5);
	});
});
