import { z } from 'zod';
import {
	readJson,
	writeJsonAtomic,
	removeEntry
} from '$lib/video-editor/workspace-fs/fs-primitives';
import { requireWorkspaceRoot, getWorkspaceRoot } from '$lib/video-editor/workspace-fs/root';
import { saveHandle, getHandle } from '$lib/video-editor/workspace-fs/handles-db';
import { quickCutProjectPath } from './paths';
import type { QuickCutProject, QuickCutSourceMetadata, QuickCutSegment } from './types';
import type { QuickCutSource } from './types';
import { createHash } from './fingerprint';

const MAX_SOURCES = 64;
const MAX_SEGMENTS = 200;
const MAX_KEYFRAMES = 20000;
const MAX_NAME_LENGTH = 100;

const videoStreamSchema = z.object({
	index: z.number().min(0).max(32),
	codec: z.string().nullable(),
	width: z.number().min(0).max(8192),
	height: z.number().min(0).max(8192),
	rotation: z.number(),
	fps: z.number().nullable(),
	keyframeTimestamps: z.array(z.number()).max(MAX_KEYFRAMES).optional(),
	keyframeState: z.enum(['known', 'unknown']).optional()
});

const audioStreamSchema = z.object({
	index: z.number().min(0).max(64),
	codec: z.string().nullable(),
	sampleRate: z.number().nullable(),
	channels: z.number().nullable()
});

const sourceMetaSchema = z.object({
	id: z.string().min(1).max(64),
	name: z.string().min(1).max(MAX_NAME_LENGTH),
	size: z
		.number()
		.min(0)
		.max(100 * 1024 * 1024 * 1024),
	mimeType: z.string().min(1).max(100),
	duration: z
		.number()
		.min(0)
		.max(24 * 3600),
	width: z.number().min(0).max(8192),
	height: z.number().min(0).max(8192),
	videoCodec: z.string().nullable(),
	audioCodec: z.string().nullable(),
	sampleRate: z.number().nullable(),
	channels: z.number().nullable(),
	rotation: z.number(),
	fps: z.number().nullable(),
	keyframeTimestamps: z.array(z.number()).max(MAX_KEYFRAMES),
	keyframeState: z.enum(['known', 'unknown', 'audio-only']),
	lastModified: z.number().optional(),
	contentFingerprint: z.string().optional(),
	videoStreams: z.array(videoStreamSchema).max(32).optional(),
	audioStreams: z.array(audioStreamSchema).max(64).optional(),
	selectedVideoTrackIndex: z.number().min(0).max(32).nullable().optional(),
	selectedAudioTrackIndices: z.array(z.number().min(0).max(64)).max(16).optional()
});

const segmentSchema = z.object({
	id: z.string().min(1),
	sourceId: z.string().min(1),
	start: z.number().min(0),
	end: z.number().min(0),
	name: z.string().max(MAX_NAME_LENGTH).optional(),
	enabled: z.boolean().optional(),
	cutMode: z.enum(['nearestKeyframe', 'exact']).optional()
});

const projectSchema = z.object({
	version: z.literal(1),
	id: z.string().min(1),
	name: z.string().min(1).max(MAX_NAME_LENGTH),
	sources: z.array(sourceMetaSchema).min(1).max(MAX_SOURCES),
	segments: z.array(segmentSchema).max(MAX_SEGMENTS),
	cutMode: z.enum(['nearestKeyframe', 'exact']),
	merge: z.boolean(),
	removeMarkedRanges: z.boolean().default(false),
	createdAt: z.number(),
	updatedAt: z.number()
});

const legacySegmentSchema = z
	.object({
		id: z.unknown(),
		start: z.unknown(),
		end: z.unknown(),
		name: z.unknown(),
		enabled: z.unknown()
	})
	.passthrough();

const legacyProjectSchema = z.object({
	version: z.number().optional(),
	id: z.unknown(),
	name: z.unknown(),
	sourceFileName: z.string(),
	sourceFileSize: z.number().optional(),
	sourceMimeType: z.string().optional(),
	duration: z.number().optional(),
	segments: z.array(legacySegmentSchema).optional(),
	cutMode: z.enum(['nearestKeyframe', 'exact']).optional(),
	merge: z.boolean().optional(),
	removeMarkedRanges: z.boolean().optional(),
	createdAt: z.number().optional(),
	updatedAt: z.number().optional()
});

function normalizeSourceStreams(source: QuickCutSourceMetadata): QuickCutSourceMetadata {
	let videoStreams = source.videoStreams ?? [];
	let audioStreams = source.audioStreams ?? [];
	if (videoStreams.length === 0 && source.videoCodec !== null) {
		videoStreams = [
			{
				index: 0,
				codec: source.videoCodec,
				width: source.width,
				height: source.height,
				rotation: source.rotation,
				fps: source.fps,
				keyframeTimestamps: source.keyframeTimestamps ?? [],
				keyframeState: source.keyframeState === 'known' ? 'known' : 'unknown'
			}
		];
	} else {
		videoStreams = videoStreams.map((vs, idx) => {
			if (vs.keyframeTimestamps !== undefined && vs.keyframeState !== undefined) return vs;
			if (idx === 0 && source.keyframeTimestamps && source.keyframeState !== 'audio-only') {
				return {
					...vs,
					keyframeTimestamps: source.keyframeTimestamps,
					keyframeState: source.keyframeState === 'known' ? 'known' : 'unknown'
				};
			}
			return {
				...vs,
				keyframeTimestamps: vs.keyframeTimestamps ?? [],
				keyframeState: vs.keyframeState ?? 'unknown'
			};
		});
	}
	if (audioStreams.length === 0 && source.audioCodec !== null) {
		audioStreams = [
			{
				index: 0,
				codec: source.audioCodec,
				sampleRate: source.sampleRate,
				channels: source.channels
			}
		];
	}
	const normalized: QuickCutSourceMetadata = {
		...source,
		videoStreams,
		audioStreams,
		selectedVideoTrackIndex: source.selectedVideoTrackIndex,
		selectedAudioTrackIndices: source.selectedAudioTrackIndices
	};
	return normalized;
}

function validateProject(data: QuickCutProject): QuickCutProject {
	const sourceIds = new Set(data.sources.map((s) => s.id));
	for (const seg of data.segments) {
		if (!sourceIds.has(seg.sourceId))
			throw new Error(`Segment ${seg.id} references missing source`);
		if (seg.end <= seg.start) throw new Error(`Segment ${seg.id} has invalid time`);
		if (seg.end - seg.start < 0.05) throw new Error(`Segment ${seg.id} too short`);
		const src = data.sources.find((s) => s.id === seg.sourceId);
		if (!src) throw new Error(`Segment ${seg.id} missing source`);
		if (seg.end > src.duration + 0.001) throw new Error(`Segment ${seg.id} beyond source duration`);
	}
	if (new Set(data.sources.map((s) => s.id)).size !== data.sources.length)
		throw new Error('Duplicate source id');
	for (const src of data.sources) {
		if (
			src.selectedVideoTrackIndex !== undefined &&
			src.selectedVideoTrackIndex !== null &&
			!src.videoStreams.some((s) => s.index === src.selectedVideoTrackIndex)
		) {
			throw new Error(
				`Source ${src.id} selected video track ${src.selectedVideoTrackIndex} does not exist`
			);
		}
		if (src.selectedAudioTrackIndices) {
			for (const idx of src.selectedAudioTrackIndices) {
				if (!src.audioStreams.some((s) => s.index === idx))
					throw new Error(`Source ${src.id} selected audio track ${idx} does not exist`);
			}
			if (new Set(src.selectedAudioTrackIndices).size !== src.selectedAudioTrackIndices.length)
				throw new Error(`Source ${src.id} has duplicate audio track selections`);
		}
		// Legacy sources may have empty stream catalogs; fall back to codec fields for validation
		const hasVideoStreams = src.videoStreams.length > 0;
		const hasAudioStreams = src.audioStreams.length > 0;
		const hasVideo = (() => {
			if (!hasVideoStreams && !hasAudioStreams) {
				// Legacy project without stream catalogs: infer from codec
				if (src.videoCodec !== null) return src.selectedVideoTrackIndex !== null;
				return false;
			}
			if (src.videoStreams.length === 0) return false;
			if (src.selectedVideoTrackIndex === null) return false;
			if (src.selectedVideoTrackIndex === undefined) return src.videoStreams.length > 0;
			return src.videoStreams.some((s) => s.index === src.selectedVideoTrackIndex);
		})();
		const hasAudio = (() => {
			if (!hasVideoStreams && !hasAudioStreams) {
				if (src.audioCodec !== null) {
					if (src.selectedAudioTrackIndices === undefined) return true;
					return src.selectedAudioTrackIndices.length > 0;
				}
				return false;
			}
			if (src.audioStreams.length === 0) return false;
			if (src.selectedAudioTrackIndices === undefined) return src.audioStreams.length > 0;
			return src.selectedAudioTrackIndices.length > 0;
		})();
		if (!hasVideo && !hasAudio) throw new Error(`Source ${src.id} has no tracks selected`);
	}
	return data;
}

export function parseProject(json: string): QuickCutProject {
	let parsed: z.infer<ReturnType<typeof z.json>>;
	try {
		parsed = z.json().parse(JSON.parse(json));
	} catch {
		throw new Error('Invalid JSON');
	}
	const current = projectSchema.safeParse(parsed);
	if (current.success) {
		const normalizedSources = current.data.sources.map(normalizeSourceStreams);
		return validateProject({ ...current.data, sources: normalizedSources });
	}
	const legacy = legacyProjectSchema.safeParse(parsed);
	if (legacy.success) {
		const o = legacy.data;
		const hasSources = z.object({ sources: z.unknown() }).passthrough().safeParse(parsed).success;
		if (!hasSources) {
			const legacyId = crypto.randomUUID();
			const legacySources: QuickCutSourceMetadata[] = [
				{
					id: legacyId,
					name: o.sourceFileName,
					size: o.sourceFileSize ?? 0,
					mimeType: o.sourceMimeType ?? 'video/mp4',
					duration: o.duration ?? 0,
					width: 0,
					height: 0,
					videoCodec: null,
					audioCodec: null,
					sampleRate: null,
					channels: null,
					rotation: 0,
					fps: null,
					keyframeTimestamps: [],
					keyframeState: 'unknown',
					lastModified: undefined,
					contentFingerprint: undefined,
					videoStreams: [],
					audioStreams: []
				}
			];
			const segs = o.segments ?? [];
			const migratedSegments: QuickCutSegment[] = segs.map((s) => {
				const id = isString(s.id) ? s.id : crypto.randomUUID();
				const start = isNumber(s.start) ? s.start : 0;
				const end = isNumber(s.end) ? s.end : 0;
				const name = isString(s.name) ? s.name : undefined;
				const enabled = isBoolean(s.enabled) ? s.enabled : true;
				return { id, sourceId: legacyId, start, end, name, enabled };
			});
			const migrated = {
				version: 1 as const,
				id: isString(o.id) ? o.id : crypto.randomUUID(),
				name: isString(o.name) ? o.name : 'Quick Cut',
				sources: legacySources,
				segments: migratedSegments,
				cutMode: o.cutMode ?? 'nearestKeyframe',
				merge: o.merge ?? false,
				removeMarkedRanges: o.removeMarkedRanges ?? false,
				createdAt: o.createdAt ?? Date.now(),
				updatedAt: o.updatedAt ?? Date.now()
			};
			return validateProject(projectSchema.parse(migrated));
		}
	}
	throw new Error(`Invalid project: ${current.error.issues[0]?.message ?? 'schema error'}`);
}

export function reconcileSourceAfterProbe(oldMeta: QuickCutSourceMetadata, probed: QuickCutSource) {
	let didMigrate = false;
	let videoWasValid = true;
	let audioWasValid = true;
	let newSelectedVideoTrackIndex: number | null | undefined = oldMeta.selectedVideoTrackIndex;
	let newSelectedAudioTrackIndices: number[] | undefined = oldMeta.selectedAudioTrackIndices;
	if (oldMeta.selectedVideoTrackIndex === undefined) {
		didMigrate = true;
		if (probed.videoStreams.length > 0) newSelectedVideoTrackIndex = probed.videoStreams[0]!.index;
		else newSelectedVideoTrackIndex = null;
	} else if (oldMeta.selectedVideoTrackIndex !== null) {
		const exists = probed.videoStreams.some((vs) => vs.index === oldMeta.selectedVideoTrackIndex);
		if (!exists) {
			videoWasValid = false;
			newSelectedVideoTrackIndex = null;
		}
	}
	if (oldMeta.selectedAudioTrackIndices === undefined) {
		didMigrate = true;
		if (probed.audioStreams.length > 0)
			newSelectedAudioTrackIndices = [probed.audioStreams[0]!.index];
		else newSelectedAudioTrackIndices = [];
	} else {
		const allExist = oldMeta.selectedAudioTrackIndices.every((idx) =>
			probed.audioStreams.some((as) => as.index === idx)
		);
		if (!allExist) {
			audioWasValid = false;
			newSelectedAudioTrackIndices = [];
		}
	}
	const reconciled: QuickCutSourceMetadata = {
		...oldMeta,
		name: probed.name,
		size: probed.size,
		mimeType: probed.mimeType,
		duration: probed.duration,
		width: probed.width,
		height: probed.height,
		videoCodec: probed.videoCodec,
		audioCodec: probed.audioCodec,
		sampleRate: probed.sampleRate,
		channels: probed.channels,
		rotation: probed.rotation,
		fps: probed.fps,
		keyframeTimestamps: probed.keyframeTimestamps,
		keyframeState: probed.keyframeState,
		lastModified: probed.lastModified,
		contentFingerprint: probed.contentFingerprint,
		videoStreams: probed.videoStreams,
		audioStreams: probed.audioStreams,
		selectedVideoTrackIndex: newSelectedVideoTrackIndex,
		selectedAudioTrackIndices: newSelectedAudioTrackIndices
	};
	return { reconciled, videoWasValid, audioWasValid, didMigrate };
}

export function createNewProject(
	sources: QuickCutSourceMetadata[] | string,
	cutMode: QuickCutProject['cutMode'] = 'nearestKeyframe'
): QuickCutProject {
	const now = Date.now();
	let srcArray: QuickCutSourceMetadata[];
	if (Array.isArray(sources)) {
		srcArray = sources.map(normalizeSourceStreams);
	} else {
		srcArray = [
			{
				id: crypto.randomUUID(),
				name: sources,
				size: 0,
				mimeType: 'video/mp4',
				duration: 0,
				width: 0,
				height: 0,
				videoCodec: null,
				audioCodec: null,
				sampleRate: null,
				channels: null,
				rotation: 0,
				fps: null,
				keyframeTimestamps: [],
				keyframeState: 'unknown',
				lastModified: undefined,
				contentFingerprint: undefined,
				videoStreams: [],
				audioStreams: []
			}
		];
	}
	const name = srcArray[0]?.name.replace(/\.[^.]+$/, '') || 'Quick Cut';
	return {
		version: 1,
		id: crypto.randomUUID(),
		name,
		sources: srcArray,
		segments: [],
		cutMode,
		merge: false,
		removeMarkedRanges: false,
		createdAt: now,
		updatedAt: now
	};
}

export async function saveProjectToWorkspace(project: QuickCutProject): Promise<void> {
	const root = requireWorkspaceRoot();
	project.updatedAt = Date.now();
	await writeJsonAtomic(root, quickCutProjectPath(project.id), project);
}

export async function loadProjectFromWorkspace(id: string): Promise<QuickCutProject | null> {
	const root = getWorkspaceRoot();
	if (!root) return null;
	try {
		const raw = await readJson<unknown>(root, quickCutProjectPath(id));
		if (!raw) return null;
		return parseProject(JSON.stringify(raw));
	} catch {
		return null;
	}
}

export async function deleteProjectFromWorkspace(id: string): Promise<void> {
	const root = requireWorkspaceRoot();
	await removeEntry(root, quickCutProjectPath(id));
}

export async function persistSourceHandles(sources: QuickCutSource[]): Promise<void> {
	for (const s of sources) {
		if (s.handle) {
			await saveHandle({
				kind: 'media',
				id: `quick-cut:${s.id}`,
				handle: s.handle,
				name: s.name,
				pickedAt: Date.now(),
				lastSeenSize: s.size
			});
		}
	}
}

export async function restoreSourceHandles(
	metas: QuickCutSourceMetadata[]
): Promise<Map<string, FileSystemFileHandle | null>> {
	const map = new Map<string, FileSystemFileHandle | null>();
	for (const m of metas) {
		const rec = await getHandle('media', `quick-cut:${m.id}`);
		if (rec) {
			// SAFETY: handle was saved as FileSystemFileHandle for quick-cut source via saveHandle with kind 'media'
			const handle = rec.handle as FileSystemFileHandle;
			try {
				const file = await handle.getFile();
				const sizeOk = file.size === m.size;
				const nameOk = file.name === m.name;
				const lastModifiedOk = m.lastModified === undefined || file.lastModified === m.lastModified;
				let fingerprintOk = true;
				if (m.contentFingerprint) {
					const fp = await createHash(file);
					fingerprintOk = fp === m.contentFingerprint;
				}
				if (!sizeOk || !nameOk || !lastModifiedOk || !fingerprintOk) {
					map.set(m.id, null);
					continue;
				}
				map.set(m.id, handle);
			} catch {
				map.set(m.id, null);
			}
		} else map.set(m.id, null);
	}
	return map;
}

export function serializeProject(project: QuickCutProject): string {
	return JSON.stringify(project, null, '\t');
}

export function deserializeProject(json: string): QuickCutProject {
	return parseProject(json);
}

export function snapshotProject(project: QuickCutProject): QuickCutProject {
	return deserializeProject(serializeProject(project));
}

export function projectFileName(project: QuickCutProject): string {
	const safe = (project.name || 'quick-cut').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 32);
	return `${safe}-${project.id.slice(0, 8)}.llc.json`;
}
