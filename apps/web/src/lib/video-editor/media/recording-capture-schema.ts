import { z } from 'zod';
import type {
	RecorderCursorMode,
	RecordingCaptureMetadata,
	RecordingSystemAudioStatus
} from '@openpost/editor-shared/media';

const recorderCursorModeSchema = z.enum(['always', 'motion', 'never', 'unsupported', 'unknown']);

const recordingSystemAudioStatusSchema = z.enum([
	'not-requested',
	'active',
	'inactive',
	'unavailable',
	'denied'
]);

const baseCaptureSchema = z.object({
	version: z.literal(1),
	kind: z.enum(['screen', 'camera', 'microphone']),
	capturedAt: z.string()
});

const cursorSchema = z.object({
	requested: recorderCursorModeSchema,
	actual: recorderCursorModeSchema,
	supported: z.boolean()
});

const systemAudioSchema = z.object({
	requested: z.boolean(),
	active: z.boolean(),
	status: recordingSystemAudioStatusSchema
});

export const recordingCaptureMetadataSchema: z.ZodType<RecordingCaptureMetadata> = z.object({
	version: z.literal(1),
	kind: z.enum(['screen', 'camera', 'microphone']),
	capturedAt: z.string(),
	cursor: cursorSchema.optional(),
	systemAudio: systemAudioSchema.optional()
});

export function normalizeRecordingCaptureMetadata(
	// oxlint-disable-next-line anti-slop/no-unknown-parameters -- I/O boundary parser for persisted JSON, validated via zod safeParse
	value: unknown
): RecordingCaptureMetadata | undefined {
	const base = baseCaptureSchema.safeParse(value);
	if (!base.success) return undefined;
	const result: RecordingCaptureMetadata = {
		version: 1,
		kind: base.data.kind,
		capturedAt: base.data.capturedAt
	};
	// SAFETY: value is verified object with version/kind/capturedAt, safe to read optional cursor/systemAudio as unknown
	const raw = value as { cursor?: unknown; systemAudio?: unknown };
	const cursorParsed = cursorSchema.safeParse(raw.cursor);
	if (cursorParsed.success) result.cursor = cursorParsed.data;
	const audioParsed = systemAudioSchema.safeParse(raw.systemAudio);
	if (audioParsed.success) result.systemAudio = audioParsed.data;
	return result;
}

export interface ReconciledSystemAudio {
	active: boolean;
	status: RecordingSystemAudioStatus;
}

export function reconcileSystemAudioWithProbe(
	capture: { requested: boolean; active: boolean; status: RecordingSystemAudioStatus },
	hasAudio: boolean
): ReconciledSystemAudio {
	// A screen file can contain microphone audio without any shared system audio.
	// The probe can disprove an observed track, but cannot establish its origin.
	const active = capture.active && hasAudio;
	const status = capture.status === 'active' && !hasAudio ? 'inactive' : capture.status;
	return { active, status } satisfies ReconciledSystemAudio;
}
