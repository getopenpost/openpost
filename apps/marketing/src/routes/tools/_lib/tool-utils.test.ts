import { describe, expect, it } from 'vitest';
import { COUNTER_PLATFORMS, platformTextCount, splitSmartThread } from './tool-utils';

describe('public text tools', () => {
	it('uses the publishing count rules for platform text', () => {
		expect(platformTextCount('é', 'threads')).toBe(2);
		expect(platformTextCount('example.com', 'x')).toBe(23);
		expect(platformTextCount('https://example.com.', 'x')).toBe(24);
		expect(platformTextCount('👨‍👩‍👧‍👦', 'bluesky')).toBe(1);
		expect(platformTextCount('👨‍👩‍👧‍👦', 'mastodon')).toBe(7);
	});

	it('splits Threads text without exceeding the platform byte limit', () => {
		const limit = COUNTER_PLATFORMS.find((item) => item.key === 'threads')!.limit;
		const parts = splitSmartThread('é'.repeat(260), 'threads', limit, true);
		expect(parts.length).toBeGreaterThan(1);
		expect(parts.every((part) => new TextEncoder().encode(part.text).length <= limit)).toBe(true);
	});
});
