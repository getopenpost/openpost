import { describe, expect, it } from 'vitest';
import { effectiveVideoConstraints, formatBytes, isCanonicalPlatformVideo } from './constraints';
import type { VideoConstraint, VideoMetadata } from './types';

function constraint(overrides: Partial<VideoConstraint> = {}): VideoConstraint {
	return {
		min_count: 1,
		max_count: 1,
		allowed_mimes: ['video/mp4'],
		requires_https_fetchable: false,
		requires_public_url: false,
		...overrides
	};
}

describe('video constraints', () => {
	it('uses the strictest selected destination limits', () => {
		const result = effectiveVideoConstraints([
			constraint({
				max_size_bytes: 512 * 1024 * 1024,
				max_duration_seconds: 140,
				aspect_ratios: ['16:9', '1:1']
			}),
			constraint({
				max_size_bytes: 100 * 1024 * 1024,
				max_duration_seconds: 180,
				aspect_ratios: ['9:16', '1:1']
			})
		]);

		expect(result.maxBytes).toBe(100 * 1024 * 1024);
		expect(result.maxDurationSeconds).toBe(140);
		expect(result.allowedMIMEs).toEqual(['video/mp4']);
		expect(result.aspectRatios).toEqual(['1:1']);
	});

	it('recognizes the common provider-ready MP4 profile', () => {
		const metadata: VideoMetadata = {
			sizeBytes: 1024,
			mimeType: 'video/mp4',
			durationSeconds: 10,
			width: 1920,
			height: 1080,
			videoCodec: 'avc',
			audioCodec: 'aac',
			hasVideoTrack: true,
			canDecode: true
		};

		expect(isCanonicalPlatformVideo(metadata)).toBe(true);
		expect(isCanonicalPlatformVideo({ ...metadata, videoCodec: 'hevc' })).toBe(false);
		expect(isCanonicalPlatformVideo({ ...metadata, audioCodec: 'opus' })).toBe(false);
	});

	it('keeps small file sizes meaningful in upload queues', () => {
		expect(formatBytes(70)).toBe('70 B');
		expect(formatBytes(1536)).toBe('1.5 KB');
		expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
		expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.0 GB');
	});
});
