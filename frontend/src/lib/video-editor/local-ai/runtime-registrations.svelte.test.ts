import { describe, expect, it } from 'vitest';
import './music/ace-step-service';
import './tts/kokoro-service';
import './tts/moss-service';
import './tts/supertonic-service';
import '../media/processing/interpolation/frame-interpolation-service.svelte';
import '../media/processing/upscale/upscale-service.svelte';
import '../media/scene-search/ai/caption-provider';
import '../media/scene-search/ai/clip-provider';
import '../media/scene-search/ai/embeddings-provider';
import '../transcript/engine/lib/transcription-worker-pool';
import '../transcript/filler-audio-confidence';
import '../agent/store.svelte';
import { inspectLocalAiRuntimes } from './runtime-registry';

describe('local AI runtime registrations', () => {
	it('covers every resident model runtime, including bundled video enhancement', () => {
		expect(
			inspectLocalAiRuntimes()
				.map((runtime) => runtime.id)
				.toSorted()
		).toEqual([
			'ace-step-music',
			'agent-gemma',
			'anime4k-upscale',
			'filler-audio-confidence',
			'kokoro-tts',
			'moss-tts',
			'parakeet',
			'rife-interpolation',
			'scene-captions',
			'semantic-search',
			'supertonic-tts',
			'visual-search',
			'whisper'
		]);
	});
});
