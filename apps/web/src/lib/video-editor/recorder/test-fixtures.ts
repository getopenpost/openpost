import { vi } from 'vitest';
import type { RecordingCapabilities } from './capture-capabilities';

export interface TestTrack {
	kind: 'audio' | 'video';
	enabled: boolean;
	muted: boolean;
	readyState: MediaStreamTrackState;
	stop: ReturnType<typeof vi.fn>;
	getSettings: () => MediaTrackSettings;
	addEventListener: ReturnType<typeof vi.fn>;
	removeEventListener: ReturnType<typeof vi.fn>;
}

export function createTestTrack(
	kind: 'audio' | 'video',
	overrides: Partial<Pick<TestTrack, 'enabled' | 'muted' | 'readyState' | 'getSettings'>> = {}
): TestTrack {
	return {
		kind,
		enabled: true,
		muted: false,
		readyState: 'live',
		stop: vi.fn(),
		// SAFETY: test track getSettings returns empty settings, safe for capability probes
		getSettings: () => ({}) as MediaTrackSettings,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		...overrides
	};
}

export function createTrackWithCursor(
	kind: 'audio' | 'video',
	cursor: string | undefined
): TestTrack {
	return createTestTrack(kind, {
		getSettings: () => {
			// SAFETY: cursor string is verified test value for MediaTrackSettings
			return { cursor } as MediaTrackSettings;
		}
	});
}

export function createTestStream(tracks: TestTrack[]): MediaStream {
	const stream: Pick<MediaStream, 'getTracks' | 'getAudioTracks' | 'getVideoTracks'> = {
		// SAFETY: test tracks are verified TestTrack subset for capture logic
		getTracks: () => tracks as MediaStreamTrack[],
		getAudioTracks: () =>
			// SAFETY: filtered audio tracks are MediaStreamTrack subset
			tracks.filter((track) => track.kind === 'audio') as MediaStreamTrack[],
		getVideoTracks: () =>
			// SAFETY: filtered video tracks are MediaStreamTrack subset
			tracks.filter((track) => track.kind === 'video') as MediaStreamTrack[]
	};
	// SAFETY: test fixture provides only subset used by capture logic, verified by focused tests
	return stream as MediaStream;
}

export function capabilitiesFixture(
	overrides: Partial<RecordingCapabilities> = {}
): RecordingCapabilities {
	const base: RecordingCapabilities = {
		hasDisplayMedia: true,
		hasUserMedia: true,
		cursor: { supported: true, modes: ['always', 'motion', 'never'] },
		systemAudio: { canRequest: true }
	};
	return { ...base, ...overrides };
}

export function capabilitiesWithoutCursor(): RecordingCapabilities {
	return {
		hasDisplayMedia: true,
		hasUserMedia: true,
		cursor: { supported: false, modes: [] },
		systemAudio: { canRequest: true }
	};
}
