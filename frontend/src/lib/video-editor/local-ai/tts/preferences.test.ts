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

	it('survives unavailable storage and saves the selected engine when possible', () => {
		const setItem = vi.fn();
		setStoredLocalTtsEngine('moss', { getItem: vi.fn(), setItem });
		expect(setItem).toHaveBeenCalledWith(LOCAL_TTS_ENGINE_STORAGE_KEY, 'moss');

		expect(
			getStoredLocalTtsEngine({
				getItem: () => {
					throw new Error('blocked');
				},
				setItem: vi.fn()
			})
		).toBe('kokoro');
		expect(() =>
			setStoredLocalTtsEngine('moss', {
				getItem: vi.fn(),
				setItem: () => {
					throw new Error('full');
				}
			})
		).not.toThrow();
	});
});
