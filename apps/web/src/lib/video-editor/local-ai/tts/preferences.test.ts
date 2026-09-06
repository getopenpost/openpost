import { describe, expect, it, vi } from 'vitest';
import {
	LOCAL_TTS_ENGINE_STORAGE_KEY,
	getStoredLocalTtsEngine,
	setStoredLocalTtsEngine
} from './preferences';

describe('TTS engine preferences', () => {
	it('loads only a known engine and falls back to Kokoro', () => {
		expect(getStoredLocalTtsEngine({ getItem: () => 'supertonic', setItem: vi.fn() })).toBe(
			'supertonic'
		);
		expect(getStoredLocalTtsEngine({ getItem: () => 'remote-api', setItem: vi.fn() })).toBe(
			'kokoro'
		);
	});
});
