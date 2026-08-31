import { describe, expect, it } from 'vitest';
import {
	DEFAULT_TRANSCRIPTION_MODEL,
	PARAKEET_SUPPORTED_LANGUAGES,
	resolveTranscriptionEngine,
	transcriptionModelLabel
} from './models';

describe('transcription model registry', () => {
	it('uses Parakeet as the default and labels model choices', () => {
		expect(DEFAULT_TRANSCRIPTION_MODEL).toBe('parakeet-tdt-v3');
		expect(transcriptionModelLabel('whisper-large')).toBe('Whisper Large v3 Turbo');
	});

	it('uses Parakeet for supported languages with WebGPU', () => {
		expect(PARAKEET_SUPPORTED_LANGUAGES.has('pt')).toBe(true);
		expect(resolveTranscriptionEngine('parakeet-tdt-v3', ' PT ', { webgpu: true })).toEqual({
			engine: 'parakeet',
			model: 'parakeet-tdt-v3'
		});
	});

	it('falls back to Whisper Base for unsupported languages', () => {
		expect(resolveTranscriptionEngine('parakeet-tdt-v3', 'ja', { webgpu: true })).toEqual({
			engine: 'whisper',
			model: 'whisper-base',
			fallbackReason: 'language'
		});
	});

	it('falls back to Whisper Base without WebGPU', () => {
		expect(resolveTranscriptionEngine('parakeet-tdt-v3', 'en', { webgpu: false })).toEqual({
			engine: 'whisper',
			model: 'whisper-base',
			fallbackReason: 'no-webgpu'
		});
	});

	it('keeps explicit Whisper choices on Whisper', () => {
		expect(resolveTranscriptionEngine('whisper-small', 'zh', { webgpu: false })).toEqual({
			engine: 'whisper',
			model: 'whisper-small'
		});
	});
});
