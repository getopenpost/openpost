import { PARAKEET_FILES, PARAKEET_FILE_BYTES } from './parakeet-model';
import type { TranscriptionModel, TranscriptionQuantization } from './types';

/**
 * First-download size estimates for the local transcription models, ported from
 * FreeCut's `runtime-estimates.ts` (MIT). Shown next to the model picker so users
 * can weigh quality against download size and memory before transcribing.
 */
const MIB = 1024 * 1024;

const WHISPER_MODEL_BASE_ESTIMATES_MIB = {
	// Parakeet is sized by backend via estimateParakeetRuntimeBytes(); this entry
	// only satisfies the exhaustive map and is never scaled by quantization.
	'parakeet-tdt-v3': 1270,
	'whisper-tiny': 220,
	'whisper-base': 420,
	'whisper-small': 900,
	'whisper-large': 2600
} satisfies Record<TranscriptionModel, number>;

const QUANTIZATION_MULTIPLIER = {
	hybrid: 0.65,
	fp32: 1,
	fp16: 0.62,
	q8: 0.58,
	q4: 0.38
} satisfies Record<TranscriptionQuantization, number>;

export function estimateTranscriptionModelBytes(
	model: TranscriptionModel,
	quantization: TranscriptionQuantization
): number {
	return Math.round(
		WHISPER_MODEL_BASE_ESTIMATES_MIB[model] * QUANTIZATION_MULTIPLIER[quantization] * MIB
	);
}

export function estimateParakeetRuntimeBytes(backend: 'webgpu' | 'wasm'): number {
	return (
		PARAKEET_FILE_BYTES[
			backend === 'webgpu' ? PARAKEET_FILES.encoderFp16 : PARAKEET_FILES.encoderInt8
		] +
		PARAKEET_FILE_BYTES[PARAKEET_FILES.decoder] +
		PARAKEET_FILE_BYTES[PARAKEET_FILES.preprocessor] +
		PARAKEET_FILE_BYTES[PARAKEET_FILES.vocabulary]
	);
}

export function formatModelBytes(bytes: number): string {
	if (bytes < MIB) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	const mib = bytes / MIB;
	if (mib < 1024) return `${mib >= 100 ? Math.round(mib) : mib.toFixed(1)} MB`;
	return `${(mib / 1024).toFixed(1)} GB`;
}
