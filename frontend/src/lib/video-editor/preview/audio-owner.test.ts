import { describe, expect, it } from 'vitest';
import { resolveAudioOwner } from './audio-owner';
import type { MediaPoolEntry } from '../media/pool.svelte';
import type { TimelineItem, TimelineTrack } from '../project/types';

function makeMediaEntry(
	overrides: Partial<MediaPoolEntry['media']> & { status?: MediaPoolEntry['status'] } = {}
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
	it('returns none for non-audio/video types', () => {
		const entry = makeMediaEntry();
		const nonMediaTypes: TimelineItem['type'][] = [
			'image',
			'text',
			'shape',
			'composition',
			'subtitle',
			'lottie'
		];
		for (const type of nonMediaTypes) {
			const owner = resolveAudioOwner({
				item: makeItem({ type, mediaId: undefined }),
				tracks: [makeTrack()],
				allItems: [],
				mediaEntry: entry,
				usesSeparateProxyAudio: false,
				usesProcessedAudio: false
			});
			expect(owner).toBe('none');
		}
	});

	it('returns none when media entry is missing or not ready', () => {
		const item = makeItem();
		expect(
			resolveAudioOwner({
				item,
				tracks: [makeTrack()],
				allItems: [],
				mediaEntry: null,
				usesSeparateProxyAudio: false,
				usesProcessedAudio: false
			})
		).toBe('none');
		expect(
			resolveAudioOwner({
				item,
				tracks: [makeTrack()],
				allItems: [],
				mediaEntry: makeMediaEntry({ status: 'importing' }),
				usesSeparateProxyAudio: false,
				usesProcessedAudio: false
			})
		).toBe('none');
		expect(
			resolveAudioOwner({
				item,
				tracks: [makeTrack()],
				allItems: [],
				mediaEntry: makeMediaEntry({ status: 'failed' }),
				usesSeparateProxyAudio: false,
				usesProcessedAudio: false
			})
		).toBe('none');
	});

	it('returns unsupported when audio codec is not supported', () => {
		const item = makeItem({ type: 'video' });
		const entry = makeMediaEntry({ audioCodecSupported: false });
		expect(
			resolveAudioOwner({
				item,
				tracks: [makeTrack()],
				allItems: [],
				mediaEntry: entry,
				usesSeparateProxyAudio: false,
				usesProcessedAudio: false
			})
		).toBe('unsupported');
		const audioItem = makeItem({ type: 'audio' });
		expect(
			resolveAudioOwner({
				item: audioItem,
				tracks: [makeTrack({ kind: 'audio' })],
				allItems: [],
				mediaEntry: entry,
				usesSeparateProxyAudio: false,
				usesProcessedAudio: false
			})
		).toBe('unsupported');
	});

	it('returns muted when track is muted and codec is supported', () => {
		const entry = makeMediaEntry();
		const mutedTrack = makeTrack({ muted: true });
		expect(
			resolveAudioOwner({
				item: makeItem(),
				tracks: [mutedTrack],
				allItems: [],
				mediaEntry: entry,
				usesSeparateProxyAudio: false,
				usesProcessedAudio: false
			})
		).toBe('muted');
	});

	it('returns linkedCompanion when hasLinkedAudioCompanion', () => {
		const entry = makeMediaEntry();
		const videoItem = makeItem({ id: 'v1', type: 'video', linkedGroupId: 'g1' });
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

	it('returns processed when usesProcessedAudio', () => {
		const entry = makeMediaEntry();
		expect(
			resolveAudioOwner({
				item: makeItem(),
				tracks: [makeTrack()],
				allItems: [],
				mediaEntry: entry,
				usesSeparateProxyAudio: false,
				usesProcessedAudio: true
			})
		).toBe('processed');
	});

	it('returns separateProxy when usesSeparateProxyAudio and not processed', () => {
		const entry = makeMediaEntry();
		expect(
			resolveAudioOwner({
				item: makeItem(),
				tracks: [makeTrack()],
				allItems: [],
				mediaEntry: entry,
				usesSeparateProxyAudio: true,
				usesProcessedAudio: false
			})
		).toBe('separateProxy');
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

	it('returns none for video without audio codec', () => {
		const entry = makeMediaEntry({ audioCodec: undefined });
		expect(
			resolveAudioOwner({
				item: makeItem({ type: 'video' }),
				tracks: [makeTrack()],
				allItems: [],
				mediaEntry: entry,
				usesSeparateProxyAudio: false,
				usesProcessedAudio: false
			})
		).toBe('none');
	});

	it('returns embedded for audio type', () => {
		const entry = makeMediaEntry({ audioCodec: 'aac' });
		expect(
			resolveAudioOwner({
				item: makeItem({ type: 'audio', mediaId: 'm1' }),
				tracks: [makeTrack({ kind: 'audio' })],
				allItems: [],
				mediaEntry: entry,
				usesSeparateProxyAudio: false,
				usesProcessedAudio: false
			})
		).toBe('embedded');
	});

	it('precedence: unsupported wins over muted', () => {
		const entry = makeMediaEntry({ audioCodecSupported: false });
		expect(
			resolveAudioOwner({
				item: makeItem(),
				tracks: [makeTrack({ muted: true })],
				allItems: [],
				mediaEntry: entry,
				usesSeparateProxyAudio: false,
				usesProcessedAudio: false
			})
		).toBe('unsupported');
	});

	it('precedence: muted wins over linkedCompanion when track muted', () => {
		const entry = makeMediaEntry();
		const videoItem = makeItem({ id: 'v1', linkedGroupId: 'g1' });
		const audioCompanion = makeItem({
			id: 'a1',
			type: 'audio',
			linkedGroupId: 'g1',
			trackId: 'track2'
		});
		expect(
			resolveAudioOwner({
				item: videoItem,
				tracks: [makeTrack({ muted: true })],
				allItems: [videoItem, audioCompanion],
				mediaEntry: entry,
				usesSeparateProxyAudio: false,
				usesProcessedAudio: false
			})
		).toBe('muted');
	});

	it('precedence: linkedCompanion wins over processed and separateProxy', () => {
		const entry = makeMediaEntry();
		const videoItem = makeItem({ id: 'v1', linkedGroupId: 'g1' });
		const audioCompanion = makeItem({ id: 'a1', type: 'audio', linkedGroupId: 'g1' });
		expect(
			resolveAudioOwner({
				item: videoItem,
				tracks: [makeTrack()],
				allItems: [videoItem, audioCompanion],
				mediaEntry: entry,
				usesSeparateProxyAudio: true,
				usesProcessedAudio: true
			})
		).toBe('linkedCompanion');
	});
});
