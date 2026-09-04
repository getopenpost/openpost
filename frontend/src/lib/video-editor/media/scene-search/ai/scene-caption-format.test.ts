// @vitest-environment node
// Ported from FreeCut (MIT).

import { describe, expect, it } from 'vitest';
import {
	formatSceneCaption,
	formatSceneCaptionFromData,
	normalizeShotVocabulary,
	normalizeSceneCaptionData,
	parseSceneCaptionResponse
} from './scene-caption-format';

describe('normalizeShotVocabulary', () => {
	it('drops uncertain time-of-day or weather clauses instead of persisting guesses', () => {
		expect(formatSceneCaption('Close up of a woman indoors, possibly at dusk')).toBe(
			'Close-up of a woman indoors.'
		);
		expect(formatSceneCaption('A wide shot of a street, maybe rainy')).toBe(
			'Wide shot of a street.'
		);
	});
});

describe('formatSceneCaptionFromData', () => {
	it('parses JSON responses and preserves structured scene data', () => {
		expect(
			parseSceneCaptionResponse(
				'{"caption":"A woman in a red coat walks through a rainy city street at dusk.","shotType":"wide shot","subjects":["woman"],"action":"walking through the street","setting":"city street","lighting":"dim evening light","timeOfDay":"dusk","weather":"rainy"}'
			)
		).toEqual({
			text: 'A woman in a red coat walks through a rainy city street at dusk.',
			sceneData: {
				caption: 'A woman in a red coat walks through a rainy city street at dusk.',
				shotType: 'wide shot',
				subjects: ['woman'],
				action: 'walking through the street',
				setting: 'city street',
				lighting: 'dim evening light',
				timeOfDay: 'dusk',
				weather: 'rainy'
			}
		});
	});

	it('accepts fenced JSON and falls back to the structured fields when caption is missing', () => {
		expect(
			parseSceneCaptionResponse(
				'```json\n{"shotType":"medium close up","subjects":["singer"],"action":"singing into a microphone","setting":"stage","timeOfDay":null,"weather":null}\n```'
			)
		).toEqual({
			text: 'Medium close-up of singer singing into a microphone in stage.',
			sceneData: {
				caption: 'Medium close-up of singer singing into a microphone in stage.',
				shotType: 'medium close-up',
				subjects: ['singer'],
				action: 'singing into a microphone',
				setting: 'stage'
			}
		});
	});

	it('falls back to freeform text formatting when JSON parsing fails', () => {
		expect(
			parseSceneCaptionResponse('This image shows a close up of a hand holding a glass')
		).toEqual({
			text: 'Close-up of a hand holding a glass.'
		});
	});
});
