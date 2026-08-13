import { describe, expect, it } from 'vitest';
import { stockMediaKindsForProvider, stockMediaKindsForProviders } from './stock-media-kinds';

describe('stockMediaKindsForProvider', () => {
	it('does not advertise video for a photo-only provider such as Unsplash', () => {
		expect(stockMediaKindsForProvider({ photos: true, videos: false }, 'both')).toEqual(['photo']);
	});

	it('keeps both choices for providers that actually support both', () => {
		expect(stockMediaKindsForProvider({ photos: true, videos: true }, 'both')).toEqual([
			'photo',
			'video'
		]);
	});

	it('respects the media type accepted by the calling surface', () => {
		expect(stockMediaKindsForProvider({ photos: true, videos: true }, 'video')).toEqual(['video']);
	});

	it('keeps the global type selector when another provider supports videos', () => {
		expect(
			stockMediaKindsForProviders(
				[
					{ photos: true, videos: false },
					{ photos: true, videos: true }
				],
				'both'
			)
		).toEqual(['photo', 'video']);
	});
});
