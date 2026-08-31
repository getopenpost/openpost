import { z } from 'zod';
import {
	PROJECT_SNAPSHOT_EXTENSION,
	PROJECT_SNAPSHOT_VERSION,
	type JsonValue,
	type ProjectSnapshot,
	type SnapshotValidationResult
} from './snapshot-types';
import { TIMELINE_ITEM_KINDS } from '../project/types';

const nonNegativeNumber = z.number().finite().nonnegative();
const positiveNumber = z.number().finite().positive();
const shortText = z.string().max(4_096);
const requiredText = z.string().min(1).max(4_096);
const collection = <T extends z.ZodType>(schema: T) => z.array(schema).max(100_000);

const trackSchema = z.looseObject({
	id: requiredText,
	name: shortText,
	kind: z.enum(['video', 'audio']).optional(),
	height: nonNegativeNumber,
	locked: z.boolean(),
	visible: z.boolean(),
	muted: z.boolean(),
	solo: z.boolean(),
	order: z.number().finite()
});

const itemSchema = z.looseObject({
	id: requiredText,
	trackId: requiredText,
	from: nonNegativeNumber,
	durationInFrames: nonNegativeNumber,
	label: shortText,
	type: z.enum(TIMELINE_ITEM_KINDS)
});

const transitionSchema = z
	.looseObject({
		id: requiredText,
		type: z.enum(['crossfade', 'fade-black']),
		durationInFrames: nonNegativeNumber,
		fromItemId: requiredText.optional(),
		toItemId: requiredText.optional(),
		leftClipId: requiredText.optional(),
		rightClipId: requiredText.optional(),
		trackId: requiredText.optional()
	})
	.refine(
		(value) =>
			(Boolean(value.fromItemId) && Boolean(value.toItemId)) ||
			(Boolean(value.leftClipId) && Boolean(value.rightClipId)),
		{ message: 'A transition must identify both clips.' }
	);

const markerSchema = z.looseObject({
	id: requiredText,
	frame: nonNegativeNumber,
	color: shortText
});

const compositionSchema = z.looseObject({
	id: requiredText,
	name: shortText,
	items: collection(itemSchema),
	tracks: collection(trackSchema),
	transitions: collection(transitionSchema),
	fps: positiveNumber,
	width: positiveNumber,
	height: positiveNumber,
	durationInFrames: nonNegativeNumber,
	markers: collection(markerSchema).optional()
});

const timelineSchema = z.looseObject({
	tracks: collection(trackSchema),
	items: collection(itemSchema),
	markers: collection(markerSchema).optional(),
	transitions: collection(transitionSchema).optional(),
	topLevelSequenceIds: collection(requiredText).optional(),
	compositions: collection(compositionSchema).optional()
});

const projectSchema = z.looseObject({
	id: requiredText,
	name: requiredText,
	description: z.string().max(262_144),
	createdAt: z.number().finite(),
	updatedAt: z.number().finite(),
	duration: nonNegativeNumber,
	schemaVersion: z.number().int().positive().optional(),
	metadata: z.looseObject({
		width: positiveNumber,
		height: positiveNumber,
		fps: positiveNumber,
		backgroundColor: shortText.optional()
	}),
	timeline: timelineSchema.optional(),
	animationPresets: collection(z.looseObject({ id: requiredText })).optional()
});

const mediaReferenceSchema = z.object({
	id: requiredText,
	fileName: requiredText,
	fileSize: nonNegativeNumber,
	mimeType: requiredText,
	contentHash: requiredText.optional(),
	duration: nonNegativeNumber,
	width: nonNegativeNumber,
	height: nonNegativeNumber,
	fps: nonNegativeNumber
});

const snapshotSchema = z.object({
	version: z.literal(PROJECT_SNAPSHOT_VERSION),
	exportedAt: z.iso.datetime(),
	editorVersion: shortText,
	project: projectSchema,
	mediaReferences: collection(mediaReferenceSchema),
	checksum: requiredText.optional()
});

export function validateProjectSnapshot(
	value: ProjectSnapshot | JsonValue
): SnapshotValidationResult {
	const result = snapshotSchema.safeParse(value);
	if (!result.success) {
		return {
			errors: result.error.issues.map((issue) => {
				const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
				return `${path}${issue.message}`;
			})
		};
	}
	// SAFETY: Zod validated the stored project and media boundary while loose objects preserved typed optional fields.
	return { snapshot: result.data as ProjectSnapshot, errors: [] };
}

export async function computeSnapshotChecksum(snapshot: ProjectSnapshot): Promise<string> {
	const { checksum: _checksum, ...unsigned } = snapshot;
	const bytes = new TextEncoder().encode(JSON.stringify(unsigned));
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifySnapshotChecksum(snapshot: ProjectSnapshot): Promise<boolean> {
	return !snapshot.checksum || snapshot.checksum === (await computeSnapshotChecksum(snapshot));
}

export function sanitizeSnapshotFileName(name: string): string {
	const base = name
		// eslint-disable-next-line no-control-regex -- filesystem control characters must not reach downloads
		.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
		.replace(/[. ]+$/g, '')
		.trim()
		.slice(0, 180);
	return `${base || 'project'}${PROJECT_SNAPSHOT_EXTENSION}`;
}
