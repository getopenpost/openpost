import type { GeneratedAudio, LocalGenerationProgress } from '../types';
import { KOKORO_TTS_VOICE_OPTIONS, kokoroTtsService, type KokoroTtsVoice } from './kokoro-service';
import { MOSS_TTS_VOICE_OPTIONS, mossTtsService, type MossTtsVoice } from './moss-service';
import {
	SUPERTONIC_TTS_EXPRESSIVE_TAG_OPTIONS,
	SUPERTONIC_TTS_LANGUAGE_OPTIONS,
	SUPERTONIC_TTS_VOICE_OPTIONS,
	supertonicTtsService,
	type SupertonicTtsLanguageSelection,
	type SupertonicTtsVoice
} from './supertonic-service';

export type LocalTtsEngine = 'kokoro' | 'moss' | 'supertonic';

export interface LocalTtsGenerateOptions {
	engine: LocalTtsEngine;
	text: string;
	voice: string;
	language?: string;
	speed: number;
	signal?: AbortSignal;
	onProgress?: (progress: LocalGenerationProgress) => void;
}

export const LOCAL_TTS_ENGINE_OPTIONS = [
	{
		value: 'kokoro',
		label: 'Kokoro'
	},
	{
		value: 'moss',
		label: 'MOSS Nano'
	},
	{
		value: 'supertonic',
		label: 'Supertonic 3'
	}
] as const;

export function localTtsVoiceOptions(engine: LocalTtsEngine) {
	if (engine === 'kokoro') return KOKORO_TTS_VOICE_OPTIONS;
	if (engine === 'moss') return MOSS_TTS_VOICE_OPTIONS;
	return SUPERTONIC_TTS_VOICE_OPTIONS;
}

export const LOCAL_TTS_LANGUAGE_OPTIONS = SUPERTONIC_TTS_LANGUAGE_OPTIONS;
export const LOCAL_TTS_EXPRESSIVE_TAG_OPTIONS = SUPERTONIC_TTS_EXPRESSIVE_TAG_OPTIONS;

export function defaultLocalTtsVoice(engine: LocalTtsEngine): string {
	if (engine === 'kokoro') return 'af_heart';
	if (engine === 'moss') return 'Xiaoyu';
	return 'M3';
}

export function localTtsSpeedRange(engine: LocalTtsEngine): { min: number; max: number } {
	return engine === 'supertonic' ? { min: 0.8, max: 1.3 } : { min: 0.5, max: 2 };
}

export function isLocalTtsSupported(engine: LocalTtsEngine): boolean {
	if (engine === 'kokoro') return kokoroTtsService.isSupported();
	if (engine === 'moss') return mossTtsService.isSupported();
	return supertonicTtsService.isSupported();
}

export function localTtsTags(engine: LocalTtsEngine, voice: string): string[] {
	return ['tts', `${engine}-tts`, `tts-engine:${engine}`, `${engine}-voice:${voice.toLowerCase()}`];
}

function kokoroVoice(value: string): KokoroTtsVoice {
	return KOKORO_TTS_VOICE_OPTIONS.find((option) => option.value === value)?.value ?? 'af_heart';
}

function mossVoice(value: string): MossTtsVoice {
	return MOSS_TTS_VOICE_OPTIONS.find((option) => option.value === value)?.value ?? 'Xiaoyu';
}

function supertonicVoice(value: string): SupertonicTtsVoice {
	return SUPERTONIC_TTS_VOICE_OPTIONS.find((option) => option.value === value)?.value ?? 'M3';
}

function supertonicLanguage(value: string | undefined): SupertonicTtsLanguageSelection {
	return LOCAL_TTS_LANGUAGE_OPTIONS.find((option) => option.value === value)?.value ?? 'auto';
}

export function generateLocalSpeech(options: LocalTtsGenerateOptions): Promise<GeneratedAudio> {
	if (options.engine === 'kokoro') {
		return kokoroTtsService.generateSpeechFile({
			text: options.text,
			voice: kokoroVoice(options.voice),
			speed: options.speed,
			signal: options.signal,
			onProgress: options.onProgress
		});
	}
	if (options.engine === 'moss') {
		return mossTtsService.generateSpeechFile({
			text: options.text,
			voice: mossVoice(options.voice),
			speed: options.speed,
			signal: options.signal,
			onProgress: options.onProgress
		});
	}
	return supertonicTtsService.generateSpeechFile({
		text: options.text,
		voice: supertonicVoice(options.voice),
		language: supertonicLanguage(options.language),
		speed: options.speed,
		signal: options.signal,
		onProgress: options.onProgress
	});
}
