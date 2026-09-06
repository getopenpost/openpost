import type {
	ResolvedTranscriptionEngine,
	TranscriptionModel,
	TranscriptionQuantization
} from './types';

export const DEFAULT_TRANSCRIPTION_MODEL: TranscriptionModel = 'parakeet-tdt-v3';
export const PARAKEET_FALLBACK_MODEL: TranscriptionModel = 'whisper-base';

export const TRANSCRIPTION_MODEL_OPTIONS = [
	{
		value: 'parakeet-tdt-v3',
		label: 'Parakeet (fast)',
		description: 'Fastest for 25 European languages. Requires WebGPU.',
		license: 'CC-BY-4.0'
	},
	{
		value: 'whisper-base',
		label: 'Whisper Base',
		description: 'Good speed and broad language coverage.',
		license: 'MIT'
	},
	{
		value: 'whisper-small',
		label: 'Whisper Small',
		description: 'More accurate, with a larger download.',
		license: 'MIT'
	},
	{
		value: 'whisper-large',
		label: 'Whisper Large v3 Turbo',
		description: 'Highest quality and highest memory use.',
		license: 'MIT'
	},
	{
		value: 'whisper-tiny',
		label: 'Whisper Tiny',
		description: 'Smallest download for quick drafts.',
		license: 'MIT'
	}
] as const satisfies ReadonlyArray<{
	value: TranscriptionModel;
	label: string;
	description: string;
	license: string;
}>;

export const TRANSCRIPTION_QUANTIZATION_OPTIONS = [
	{ value: 'hybrid', label: 'Balanced' },
	{ value: 'fp16', label: 'FP16' },
	{ value: 'q8', label: 'Q8' },
	{ value: 'q4', label: 'Q4' },
	{ value: 'fp32', label: 'FP32' }
] as const satisfies ReadonlyArray<{ value: TranscriptionQuantization; label: string }>;

export const PARAKEET_SUPPORTED_LANGUAGES: ReadonlySet<string> = new Set([
	'en',
	'es',
	'fr',
	'de',
	'bg',
	'hr',
	'cs',
	'da',
	'nl',
	'et',
	'fi',
	'el',
	'hu',
	'it',
	'lv',
	'lt',
	'mt',
	'pl',
	'pt',
	'ro',
	'sk',
	'sl',
	'sv',
	'ru',
	'uk'
]);

export const TRANSCRIPTION_LANGUAGE_OPTIONS = [
	{ value: '', label: 'Auto-detect' },
	{ value: 'en', label: 'English' },
	{ value: 'pt', label: 'Portuguese' },
	{ value: 'es', label: 'Spanish' },
	{ value: 'fr', label: 'French' },
	{ value: 'de', label: 'German' },
	{ value: 'it', label: 'Italian' },
	{ value: 'ja', label: 'Japanese' },
	{ value: 'ko', label: 'Korean' },
	{ value: 'zh', label: 'Chinese' },
	{ value: 'ru', label: 'Russian' },
	{ value: 'uk', label: 'Ukrainian' },
	{ value: 'nl', label: 'Dutch' },
	{ value: 'pl', label: 'Polish' }
] as const;

function hasWebGpu(): boolean {
	return typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu != null;
}

export function resolveTranscriptionEngine(
	model: TranscriptionModel,
	language: string | undefined,
	options: { webgpu?: boolean } = {}
): ResolvedTranscriptionEngine {
	if (model !== 'parakeet-tdt-v3') return { engine: 'whisper', model };
	const normalized = language?.trim().toLowerCase();
	if (normalized && !PARAKEET_SUPPORTED_LANGUAGES.has(normalized)) {
		return { engine: 'whisper', model: PARAKEET_FALLBACK_MODEL, fallbackReason: 'language' };
	}
	if (!(options.webgpu ?? hasWebGpu())) {
		return { engine: 'whisper', model: PARAKEET_FALLBACK_MODEL, fallbackReason: 'no-webgpu' };
	}
	return { engine: 'parakeet', model };
}

export function transcriptionModelLabel(model: TranscriptionModel): string {
	return TRANSCRIPTION_MODEL_OPTIONS.find((option) => option.value === model)?.label ?? model;
}
