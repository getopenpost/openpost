import { describe, expect, it } from 'vitest';
import { resolveAudioOwner, resolveReverseShuttleAudioUrl } from './audio-owner';
import type { MediaPoolEntry } from '../media/pool.svelte';
import type { TimelineItem, TimelineTrack } from '../project/types';

function makeMediaEntry(
	overrides: Partial<MediaPoolEntry['media']> & {
		status?: MediaPoolEntry['status'];
	} = {}
): MediaPoolEntry {
	const { status = 'ready', ...mediaOverrides } = overrides;
	return {
		media: {
			id: 'm1',
			fileName: 'clip.mp4',
			fileSize: 1000,
			mimeType: 'video/mp4',
			duration: 10,
			width: 1920,
			height: 1080,
			fps: 30,
			codec: 'avc',
			bitrate: 5000,
			audioCodec: 'aac',
			audioCodecSupported: true,
			storageType: 'workspace',
			tags: [],
			...mediaOverrides
		},
		status,
		progress: 1
	};
}

function makeItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'item1',
		trackId: 'track1',
		from: 0,
		durationInFrames: 300,
		label: 'item',
		type: 'video',
		mediaId: 'm1',
		...overrides
	};
}

function makeTrack(overrides: Partial<TimelineTrack> = {}): TimelineTrack {
	return {
		id: 'track1',
		name: 'Track 1',
		height: 60,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order: 0,
		kind: 'video',
		...overrides
	};
}

describe('resolveAudioOwner', () => {
	it('returns linkedCompanion when hasLinkedAudioCompanion', () => {
		const entry = makeMediaEntry();
		const videoItem = makeItem({
			id: 'v1',
			type: 'video',
			linkedGroupId: 'g1'
		});
		const audioCompanion = makeItem({
			id: 'a1',
			type: 'audio',
			linkedGroupId: 'g1',
			trackId: 'track2'
		});
		// linkedCompanion detection requires finding a companion item with same linkedGroupId
		expect(
			resolveAudioOwner({
				item: videoItem,
				tracks: [makeTrack()],
				allItems: [videoItem, audioCompanion],
				mediaEntry: entry,
				usesSeparateProxyAudio: false,
				usesProcessedAudio: false
			})
		).toBe('linkedCompanion');
	});

	it('returns embedded for video with audio codec and no overrides', () => {
		const entry = makeMediaEntry({ audioCodec: 'aac' });
		expect(
			resolveAudioOwner({
				item: makeItem({ type: 'video' }),
				tracks: [makeTrack()],
				allItems: [],
				mediaEntry: entry,
				usesSeparateProxyAudio: false,
				usesProcessedAudio: false
			})
		).toBe('embedded');
	});
});

describe('resolveReverseShuttleAudioUrl', () => {
	it('uses the audio-bearing source when the visual preview is a video-only proxy', () => {
		expect(
			resolveReverseShuttleAudioUrl(
				makeItem({ type: 'video' }),
				'blob:video-only-proxy',
				'blob:original-with-audio'
			)
		).toBe('blob:original-with-audio');
	});
});
