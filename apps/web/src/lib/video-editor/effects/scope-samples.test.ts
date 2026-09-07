import { describe, expect, it } from 'vitest';
import {
	resolveScopeSampleSize,
	SCOPE_CAPTURE_INTERVAL_PAUSED_MS,
	SCOPE_CAPTURE_INTERVAL_PLAYING_MS,
	scopeCaptureDue
} from './scope-samples.svelte';

describe('scope capture cadence', () => {
	it('uses the small sample while playing and the large sample while paused', () => {
		expect(resolveScopeSampleSize(true)).toEqual({ width: 256, height: 144 });
		expect(resolveScopeSampleSize(false)).toEqual({ width: 384, height: 216 });
	});

	it('throttles playing captures to ~15fps and paused captures to 220ms', () => {
		expect(scopeCaptureDue(0, SCOPE_CAPTURE_INTERVAL_PLAYING_MS - 1, true)).toBe(false);
		expect(scopeCaptureDue(0, SCOPE_CAPTURE_INTERVAL_PLAYING_MS, true)).toBe(true);
		expect(scopeCaptureDue(0, SCOPE_CAPTURE_INTERVAL_PAUSED_MS - 1, false)).toBe(false);
		expect(scopeCaptureDue(0, SCOPE_CAPTURE_INTERVAL_PAUSED_MS, false)).toBe(true);
	});
});
