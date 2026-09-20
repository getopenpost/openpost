import { beforeEach, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ voices: vi.fn(), phonemize: vi.fn() }));
vi.mock('phonemizer', () => ({ list_voices: runtime.voices, phonemize: runtime.phonemize }));

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	runtime.phonemize.mockResolvedValue(['ready']);
});

it('checks the required pronunciation data once while ignoring malformed catalogue entries', async () => {
	runtime.voices.mockResolvedValue([null, { languages: [{ name: 'en-us' }] }]);
	const { ensureKokoroPhonemizer } = await import('./kokoro-phonemizer');
	await Promise.all([ensureKokoroPhonemizer(), ensureKokoroPhonemizer()]);
	expect(runtime.voices).toHaveBeenCalledTimes(1);
	expect(runtime.phonemize).toHaveBeenCalledWith('Ready.', 'en-us');
});

it('rejects missing pronunciation data and allows a later recovery attempt', async () => {
	runtime.voices.mockResolvedValueOnce([{ languages: [{ name: 'fr-fr' }] }]);
	const { ensureKokoroPhonemizer } = await import('./kokoro-phonemizer');
	await expect(ensureKokoroPhonemizer()).rejects.toThrow('American English');
	expect(runtime.phonemize).not.toHaveBeenCalled();
	runtime.voices.mockResolvedValueOnce([{ languages: [{ name: 'en-us' }] }]);
	await expect(ensureKokoroPhonemizer()).resolves.toBeUndefined();
	expect(runtime.voices).toHaveBeenCalledTimes(2);
});
