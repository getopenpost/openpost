import { describe, expect, it, vi } from 'vitest';
import {
	deriveSystemAudioStatus,
	detectRecordingCapabilities,
	isSystemAudioActive,
	readActualCursor,
	resolveCursorConstraint
} from './capture-capabilities';

class FakeTrack {
	enabled = true;
	muted = false;
	readyState: MediaStreamTrackState = 'live';
	stop = vi.fn();
	getSettings = () => ({});
	constructor(public kind: 'audio' | 'video') {}
}

class FakeStream {
	constructor(public tracks: FakeTrack[]) {}
	getAudioTracks(): FakeTrack[] {
		return this.tracks.filter((t) => t.kind === 'audio') as unknown as MediaStreamTrack[];
	}
	getVideoTracks(): FakeTrack[] {
		return this.tracks.filter((t) => t.kind === 'video') as unknown as MediaStreamTrack[];
	}
	getTracks(): FakeTrack[] {
		return this.tracks as unknown as MediaStreamTrack[];
	}
}

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
		const supported = {
			hasDisplayMedia: true,
			hasUserMedia: true,
			cursor: { supported: true, modes: ['always', 'motion', 'never'] as const },
			systemAudio: { canRequest: true }
		} as any;
		const unsupported = {
			hasDisplayMedia: true,
			hasUserMedia: true,
			cursor: { supported: false, modes: [] },
			systemAudio: { canRequest: true }
		} as any;
		expect(resolveCursorConstraint('motion', supported)).toBe('motion');
		expect(resolveCursorConstraint('never', unsupported)).toBeNull();
	});

	it('distinguishes system audio truth: active only when track exists', () => {
		const withAudio = new FakeStream([
			new FakeTrack('video'),
			new FakeTrack('audio')
		]) as unknown as MediaStream;
		const withoutAudio = new FakeStream([new FakeTrack('video')]) as unknown as MediaStream;
		expect(isSystemAudioActive(withAudio)).toBe(true);
		expect(isSystemAudioActive(withoutAudio)).toBe(false);
		expect(isSystemAudioActive(null)).toBe(false);
		const caps = { hasDisplayMedia: true } as any;
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
		const supportedCaps = {
			hasDisplayMedia: true,
			cursor: { supported: true, modes: ['always', 'motion', 'never'] }
		} as unknown as ReturnType<typeof detectRecordingCapabilities>;
		const unsupportedCaps = {
			hasDisplayMedia: true,
			cursor: { supported: false, modes: [] }
		} as unknown as ReturnType<typeof detectRecordingCapabilities>;
		const trackAlways = new FakeTrack('video');
		trackAlways.getSettings = () => ({ cursor: 'always' }) as unknown as MediaTrackSettings;
		const streamAlways = new FakeStream([trackAlways]) as unknown as MediaStream;
		expect(readActualCursor(streamAlways, supportedCaps)).toBe('always');
		const trackUnknown = new FakeTrack('video');
		trackUnknown.getSettings = () => ({}) as unknown as MediaTrackSettings;
		const streamUnknown = new FakeStream([trackUnknown]) as unknown as MediaStream;
		expect(readActualCursor(streamUnknown, supportedCaps)).toBe('unknown');
		expect(readActualCursor(streamUnknown, unsupportedCaps)).toBe('unsupported');
	});
});
