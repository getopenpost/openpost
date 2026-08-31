import { describe, expect, it, vi } from 'vitest';
import {
	deriveSystemAudioStatus,
	detectRecordingCapabilities,
	isSystemAudioActive,
	readActualCursor,
	resolveCursorConstraint
} from './capture-capabilities';
import {
	capabilitiesFixture,
	capabilitiesWithoutCursor,
	createTestStream,
	createTestTrack,
	createTrackWithCursor
} from './test-fixtures';

describe('capture capabilities', () => {
	it('detects display media and cursor support from getSupportedConstraints', () => {
		vi.stubGlobal('navigator', {
			mediaDevices: {
				getDisplayMedia: vi.fn(),
				getUserMedia: vi.fn(),
				getSupportedConstraints: () => ({ cursor: true, width: true }),
				enumerateDevices: vi.fn()
			}
		});
		const caps = detectRecordingCapabilities();
		expect(caps.hasDisplayMedia).toBe(true);
		expect(caps.cursor.supported).toBe(true);
		expect(caps.cursor.modes).toEqual(['always', 'motion', 'never']);
		vi.unstubAllGlobals();
	});

	it('resolves cursor constraint only when supported', () => {
		const supported = capabilitiesFixture({
			hasDisplayMedia: true,
			hasUserMedia: true,
			cursor: { supported: true, modes: ['always', 'motion', 'never'] },
			systemAudio: { canRequest: true }
		});
		const unsupported = capabilitiesWithoutCursor();
		expect(resolveCursorConstraint('motion', supported)).toBe('motion');
		expect(resolveCursorConstraint('never', unsupported)).toBeNull();
	});

	it('distinguishes system audio truth: active only when track exists', () => {
		const withAudio = createTestStream([createTestTrack('video'), createTestTrack('audio')]);
		const withoutAudio = createTestStream([createTestTrack('video')]);
		expect(isSystemAudioActive(withAudio)).toBe(true);
		expect(isSystemAudioActive(withoutAudio)).toBe(false);
		expect(isSystemAudioActive(null)).toBe(false);
		const caps = capabilitiesFixture({ hasDisplayMedia: true });
		expect(
			deriveSystemAudioStatus({ requested: false, stream: withAudio, capabilities: caps })
		).toBe('not-requested');
		expect(
			deriveSystemAudioStatus({ requested: true, stream: withAudio, capabilities: caps })
		).toBe('active');
		expect(
			deriveSystemAudioStatus({ requested: true, stream: withoutAudio, capabilities: caps })
		).toBe('inactive');
		expect(deriveSystemAudioStatus({ requested: true, stream: null, capabilities: caps })).toBe(
			'unavailable'
		);
		expect(
			deriveSystemAudioStatus({
				requested: true,
				stream: null,
				error: new DOMException('', 'NotAllowedError'),
				capabilities: caps
			})
		).toBe('denied');
	});

	it('reads actual cursor from track settings and never mirrors requested when unreported', () => {
		const supportedCaps = capabilitiesFixture({
			hasDisplayMedia: true,
			cursor: { supported: true, modes: ['always', 'motion', 'never'] }
		});
		const unsupportedCaps = capabilitiesWithoutCursor();
		const streamAlways = createTestStream([createTrackWithCursor('video', 'always')]);
		expect(readActualCursor(streamAlways, supportedCaps)).toBe('always');
		const streamUnknown = createTestStream([createTestTrack('video')]);
		expect(readActualCursor(streamUnknown, supportedCaps)).toBe('unknown');
		expect(readActualCursor(streamUnknown, unsupportedCaps)).toBe('unsupported');
	});
});
