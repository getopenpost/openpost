import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../project/types';
import type { MediaMetadata } from './types';
import {
	automaticOrphanMatches,
	compatibleRecoveryMedia,
	orphanedTimelineClips
} from './media-recovery';

function item(id: string, type: TimelineItem['type'], mediaId?: string): TimelineItem {
	return {
		id,
		trackId: type === 'audio' ? 'audio-track' : 'video-track',
		from: 0,
		durationInFrames: 90,
		label: mediaId ? `${mediaId}.mp4` : id,
		type,
		mediaId
	};
}

function media(id: string, kind: 'video' | 'audio' | 'image'): MediaMetadata {
	return {
		id,
		storageType: 'workspace',
		fileName: `${id}.mp4`,
		fileSize: 100,
		mimeType: kind === 'audio' ? 'audio/wav' : kind === 'image' ? 'image/png' : 'video/mp4',
		duration: 3,
		width: kind === 'audio' ? 0 : 1920,
		height: kind === 'audio' ? 0 : 1080,
		fps: kind === 'video' ? 30 : 0,
		codec: kind === 'video' ? 'avc' : '',
		bitrate: 1_000_000,
		tags: [kind]
	};
}

describe('media recovery analysis', () => {
	it('reports only material timeline clips whose media record is gone', () => {
		const clips = [
			item('video', 'video', 'missing'),
			item('audio', 'audio', 'known'),
			item('caption', 'subtitle', 'missing'),
			item('text', 'text')
		];

		expect(orphanedTimelineClips(clips, [media('known', 'audio')])).toEqual([
			expect.objectContaining({ itemId: 'video', mediaId: 'missing', itemType: 'video' })
		]);
	});

	it('matches one exact compatible filename and rejects ambiguous or wrong-kind assets', () => {
		const orphan = orphanedTimelineClips([item('video', 'video', 'launch')], [])[0];
		if (!orphan) throw new Error('Expected one orphaned clip.');
		const sources = [
			media('launch', 'video'),
			{ ...media('wrong-kind', 'audio'), fileName: 'launch.mp4' }
		];

		expect(compatibleRecoveryMedia(orphan, sources).map((entry) => entry.id)).toEqual(['launch']);
		expect(automaticOrphanMatches([orphan], sources)).toEqual(new Map([['video', 'launch']]));
		expect(
			automaticOrphanMatches(
				[orphan],
				[media('launch', 'video'), { ...media('duplicate', 'video'), fileName: 'launch.mp4' }]
			)
		).toEqual(new Map());
	});

	it('offers a video with audio as a replacement for its audio companion', () => {
		const orphan = orphanedTimelineClips([item('audio', 'audio', 'launch')], [])[0];
		if (!orphan) throw new Error('Expected one orphaned clip.');
		const videoWithAudio = { ...media('launch', 'video'), audioCodec: 'aac' };

		expect(
			compatibleRecoveryMedia(orphan, [videoWithAudio, media('silent', 'video')]).map(
				(entry) => entry.id
			)
		).toEqual(['launch']);
	});
});
