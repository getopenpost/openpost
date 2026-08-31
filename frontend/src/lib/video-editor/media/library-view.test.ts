import { describe, expect, it } from 'vitest';
import {
	filterAndSortMedia,
	formatMediaBitrate,
	formatMediaBytes,
	formatMediaDuration,
	formatMediaListSummary,
	groupMediaByKind,
	mediaLibraryGridTemplate,
	mediaLibraryKind
} from './library-view';
import type { MediaMetadata } from './types';

function media(
	id: string,
	fileName: string,
	tags: string[],
	options: Partial<MediaMetadata> = {}
): MediaMetadata {
	return {
		id,
		storageType: 'workspace',
		fileName,
		fileSize: 100,
		mimeType: tags.includes('audio') ? 'audio/wav' : 'video/mp4',
		duration: 2,
		width: 1920,
		height: 1080,
		fps: 30,
		codec: 'avc',
		bitrate: 1_000_000,
		tags,
		...options
	};
}

describe('media library view', () => {
	it('searches useful metadata and keeps stable sort choices', () => {
		const sources = [
			media('one', 'B-roll 10.mp4', ['video'], { fileSize: 300, duration: 3 }),
			media('two', 'B-roll 2.mp4', ['video'], { fileSize: 200, duration: 8 }),
			media('three', 'Voice.wav', ['audio'], { audioCodec: 'opus', fileSize: 400 })
		];

		expect(filterAndSortMedia(sources, '', 'all', 'added').map((item) => item.id)).toEqual([
			'three',
			'two',
			'one'
		]);
		expect(filterAndSortMedia(sources, '', 'video', 'name').map((item) => item.id)).toEqual([
			'two',
			'one'
		]);
		expect(filterAndSortMedia(sources, 'OPUS', 'all', 'size').map((item) => item.id)).toEqual([
			'three'
		]);
		expect(filterAndSortMedia(sources, '', 'all', 'duration')[0]?.id).toBe('two');
	});

	it('groups animations apart from generic images and formats media facts', () => {
		const sources = [
			media('image', 'still.png', ['image'], { mimeType: 'image/png' }),
			media('animation', 'intro.lottie', ['image', 'lottie'], {
				mimeType: 'application/zip'
			}),
			media('audio', 'voice.wav', ['audio'])
		];

		expect(mediaLibraryKind(sources[1]!)).toBe('lottie');
		expect(groupMediaByKind(sources).map((group) => group.kind)).toEqual([
			'audio',
			'image',
			'lottie'
		]);
		expect(formatMediaDuration(3_661.9)).toBe('1:01:01');
		expect(formatMediaBytes(1_572_864)).toBe('1.5 MB');
		expect(formatMediaBitrate(7_300_000)).toBe('7.3 Mbps');
		expect(formatMediaListSummary(sources[0]!)).toBe('0:02');
		expect(formatMediaListSummary({ ...sources[0]!, duration: 0 })).toBe('1920 × 1080');
	});

	it('maps every grid density to its stable responsive card width', () => {
		expect([1, 2, 3, 4, 5].map(mediaLibraryGridTemplate)).toEqual([
			'repeat(auto-fill, minmax(min(80px, 100%), 1fr))',
			'repeat(auto-fill, minmax(min(110px, 100%), 1fr))',
			'repeat(auto-fill, minmax(min(140px, 100%), 1fr))',
			'repeat(auto-fill, minmax(min(200px, 100%), 1fr))',
			'repeat(auto-fill, minmax(min(280px, 100%), 1fr))'
		]);
		expect(mediaLibraryGridTemplate(Number.NaN)).toContain('110px');
	});
});
