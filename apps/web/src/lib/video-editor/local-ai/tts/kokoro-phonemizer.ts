import { list_voices, phonemize } from 'phonemizer';

let readiness: Promise<void> | null = null;

interface PhonemizerVoice {
	languages: Array<{ name: string }>;
}

function isPhonemizerVoice(value: unknown): value is PhonemizerVoice {
	if (!value || typeof value !== 'object' || !('languages' in value)) return false;
	const { languages } = value as { languages: unknown };
	return (
		Array.isArray(languages) &&
		languages.every(
			(language) =>
				Boolean(language) &&
				typeof language === 'object' &&
				'name' in language &&
				typeof language.name === 'string'
		)
	);
}

async function verifyRuntime(): Promise<void> {
	const voiceResult: unknown = await list_voices('en-us');
	const voices = Array.isArray(voiceResult) ? voiceResult.filter(isPhonemizerVoice) : [];
	const hasAmericanEnglish = voices.some((voice) =>
		voice.languages.some((language) => language.name.toLowerCase() === 'en-us')
	);
	if (!hasAmericanEnglish) {
		throw new Error('Kokoro could not load its American English pronunciation data.');
	}
	const phonemes = await phonemize('Ready.', 'en-us');
	if (phonemes.length === 0) {
		throw new Error('Kokoro loaded its pronunciation data but could not produce speech input.');
	}
}

export function ensureKokoroPhonemizer(): Promise<void> {
	readiness ??= verifyRuntime().catch((error) => {
		readiness = null;
		throw error;
	});
	return readiness;
}
