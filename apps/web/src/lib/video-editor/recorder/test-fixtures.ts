import { vi } from 'vitest';
import type { RecordingCapabilities } from './capture-capabilities';

class FakeTrack<K extends 'audio' | 'video'> extends EventTarget implements MediaStreamTrack {
	contentHint = '';
	enabled = true;
	readonly id = crypto.randomUUID();
	readonly kind: K;
	readonly label = '';
	muted = false;
	onended = null;
	onmute = null;
	onunmute = null;
	readyState: MediaStreamTrackState = 'live';
	stop = vi.fn();
	getSettings: () => MediaTrackSettings = () => ({});

	constructor(
		kind: K,
		overrides: Partial<Pick<FakeTrack<K>, 'enabled' | 'muted' | 'readyState' | 'getSettings'>>
	) {
		super();
		this.kind = kind;
		Object.assign(this, overrides);
	}

	async applyConstraints(): Promise<void> {}
	clone(): FakeTrack<K> {
		return new FakeTrack(this.kind, {
			enabled: this.enabled,
			muted: this.muted,
			readyState: this.readyState,
			getSettings: this.getSettings
		});
	}
	getCapabilities(): MediaTrackCapabilities {
		return {};
	}
	getConstraints(): MediaTrackConstraints {
		return {};
	}
}

export type TestTrack = FakeTrack<'audio'> | FakeTrack<'video'>;

export function createTestTrack(
	kind: 'audio' | 'video',
	overrides: Partial<Pick<TestTrack, 'enabled' | 'muted' | 'readyState' | 'getSettings'>> = {}
): TestTrack {
	if (kind === 'audio') return new FakeTrack<'audio'>('audio', overrides);
	return new FakeTrack<'video'>('video', overrides);
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
	return new FakeStream(tracks);
}

class FakeStream extends EventTarget implements MediaStream {
	readonly id = crypto.randomUUID();
	onaddtrack = null;
	onremovetrack = null;
	private tracks: MediaStreamTrack[];

	constructor(tracks: MediaStreamTrack[]) {
		super();
		this.tracks = [...tracks];
	}

	get active(): boolean {
		return this.tracks.some((track) => track.readyState === 'live');
	}
	addTrack(track: MediaStreamTrack): void {
		this.tracks.push(track);
	}
	clone(): MediaStream {
		return new FakeStream(this.tracks.map((track) => track.clone()));
	}
	getAudioTracks(): MediaStreamAudioTrack[] {
		return this.tracks.filter((track): track is MediaStreamAudioTrack => track.kind === 'audio');
	}
	getTrackById(id: string): MediaStreamTrack | null {
		return this.tracks.find((track) => track.id === id) ?? null;
	}
	getTracks(): MediaStreamTrack[] {
		return [...this.tracks];
	}
	getVideoTracks(): MediaStreamVideoTrack[] {
		return this.tracks.filter((track): track is MediaStreamVideoTrack => track.kind === 'video');
	}
	removeTrack(track: MediaStreamTrack): void {
		this.tracks = this.tracks.filter((candidate) => candidate !== track);
	}
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
