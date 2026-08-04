import { describe, expect, it } from 'vitest';
import { proxyReason } from './proxy-policy';

describe('proxy policy', () => {
	it('keeps efficient portrait and landscape 1080p sources at original quality', () => {
		expect(proxyReason({ width: 1080, height: 1920, video_codec: 'avc' }, 30)).toBeNull();
		expect(proxyReason({ width: 1920, height: 1080, video_codec: 'avc' }, 29.97)).toBeNull();
	});

	it('proxies oversized, high-frame-rate, and difficult sources', () => {
		expect(proxyReason({ width: 3840, height: 2160, video_codec: 'avc' }, 30)).toBe('dimensions');
		expect(proxyReason({ width: 1920, height: 1080, video_codec: 'avc' }, 60)).toBe('frame-rate');
		expect(proxyReason({ width: 1920, height: 1080, video_codec: 'hevc' }, 30)).toBe('codec');
	});
});
