import { m } from '$lib/paraglide/messages';
import type { TranscriptionModel, TranscriptionQuantization } from './types';

export function transcriptionModelUiLabel(model: TranscriptionModel): string {
	if (model === 'parakeet-tdt-v3') return m.video_editor_transcribe_model_parakeet();
	if (model === 'whisper-base') return m.video_editor_transcribe_model_whisper_base();
	if (model === 'whisper-small') return m.video_editor_transcribe_model_whisper_small();
	if (model === 'whisper-large') return m.video_editor_transcribe_model_whisper_large();
	return m.video_editor_transcribe_model_whisper_tiny();
}

export function transcriptionModelUiDescription(model: TranscriptionModel): string {
	if (model === 'parakeet-tdt-v3') return m.video_editor_transcribe_model_parakeet_description();
	if (model === 'whisper-base') return m.video_editor_transcribe_model_whisper_base_description();
	if (model === 'whisper-small') return m.video_editor_transcribe_model_whisper_small_description();
	if (model === 'whisper-large') return m.video_editor_transcribe_model_whisper_large_description();
	return m.video_editor_transcribe_model_whisper_tiny_description();
}

export function transcriptionQuantizationUiLabel(value: TranscriptionQuantization): string {
	if (value === 'hybrid') return m.video_editor_transcribe_quality_balanced();
	return value.toUpperCase();
}

export function transcriptionLanguageUiLabel(value: string): string {
	switch (value) {
		case '':
			return m.video_editor_transcribe_language_auto();
		case 'en':
			return m.video_editor_transcribe_language_english();
		case 'pt':
			return m.video_editor_transcribe_language_portuguese();
		case 'es':
			return m.video_editor_transcribe_language_spanish();
		case 'fr':
			return m.video_editor_transcribe_language_french();
		case 'de':
			return m.video_editor_transcribe_language_german();
		case 'ar':
			return m.video_editor_transcribe_language_arabic();
		case 'bg':
			return m.video_editor_transcribe_language_bulgarian();
		case 'cs':
			return m.video_editor_transcribe_language_czech();
		case 'da':
			return m.video_editor_transcribe_language_danish();
		case 'el':
			return m.video_editor_transcribe_language_greek();
		case 'et':
			return m.video_editor_transcribe_language_estonian();
		case 'fi':
			return m.video_editor_transcribe_language_finnish();
		case 'hi':
			return m.video_editor_transcribe_language_hindi();
		case 'hr':
			return m.video_editor_transcribe_language_croatian();
		case 'hu':
			return m.video_editor_transcribe_language_hungarian();
		case 'id':
			return m.video_editor_transcribe_language_indonesian();
		case 'it':
			return m.video_editor_transcribe_language_italian();
		case 'ja':
			return m.video_editor_transcribe_language_japanese();
		case 'ko':
			return m.video_editor_transcribe_language_korean();
		case 'lt':
			return m.video_editor_transcribe_language_lithuanian();
		case 'lv':
			return m.video_editor_transcribe_language_latvian();
		case 'zh':
			return m.video_editor_transcribe_language_chinese();
		case 'ru':
			return m.video_editor_transcribe_language_russian();
		case 'uk':
			return m.video_editor_transcribe_language_ukrainian();
		case 'nl':
			return m.video_editor_transcribe_language_dutch();
		case 'pl':
			return m.video_editor_transcribe_language_polish();
		case 'ro':
			return m.video_editor_transcribe_language_romanian();
		case 'sk':
			return m.video_editor_transcribe_language_slovak();
		case 'sl':
			return m.video_editor_transcribe_language_slovenian();
		case 'sv':
			return m.video_editor_transcribe_language_swedish();
		case 'tr':
			return m.video_editor_transcribe_language_turkish();
		case 'vi':
			return m.video_editor_transcribe_language_vietnamese();
		default:
			return value;
	}
}
