import { list_voices, phonemize } from 'phonemizer';
import { z } from 'zod';

let readiness: Promise<void> | null = null;

const voiceSchema = z.object({ languages: z.array(z.object({ name: z.string() })) });

async function verifyRuntime(): Promise<void> {
	const voiceResult: unknown = await list_voices('en-us');
	const voices = Array.isArray(voiceResult)
		? voiceResult.flatMap((voice) => {
				const parsed = voiceSchema.safeParse(voice);
				return parsed.success ? [parsed.data] : [];
			})
		: [];
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
