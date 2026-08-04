import {
	createBlankVideoProject,
	defaultClipAudio,
	defaultVideoPresentation,
	type PrimarySequenceClip,
	type StockMediaProvenance,
	type VideoProjectDocumentV1,
	type VideoSource,
	type VideoSourceKind
} from '@openpost/video-project';
import { probeVideo } from '$lib/video/prepare';
import {
	calculateStorageBudget,
	createLocalVideoProject,
	deleteLocalVideoProject,
	indexProjectAsset,
	readProjectFile,
	saveLocalVideoProject,
	writeProjectFile
} from './storage';
import type { LocalVideoProject, StorageBudget } from './types';
import type { RecordingManifest } from './types';

const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const SUPPORTED_AUDIO_TYPES = new Set([
	'audio/mpeg',
	'audio/mp4',
	'audio/aac',
	'audio/wav',
	'audio/webm',
	'audio/ogg'
]);

export async function createBlankLocalVideoProject(
	title = 'Untitled video',
	editingMode: 'quick-cut' | 'editor' = 'editor'
): Promise<LocalVideoProject> {
	return await createLocalVideoProject(
		`local_video_${crypto.randomUUID()}`,
		createBlankVideoProject(title, editingMode)
	);
}

export async function createLocalVideoProjectFromFiles(
	files: File[],
	title?: string,
	signal?: AbortSignal,
	editingMode: 'quick-cut' | 'editor' = 'editor'
): Promise<LocalVideoProject> {
	if (files.length === 0) return await createBlankLocalVideoProject(title, editingMode);
	const required = files.reduce((total, file) => total + file.size, 0);
	const estimate = await navigator.storage?.estimate?.();
	const budget = calculateStorageBudget(estimate?.usage ?? 0, estimate?.quota ?? 0, required);
	if (!budget.can_continue) throw storageBudgetError(budget);

	const projectID = `local_video_${crypto.randomUUID()}`;
	const document = createBlankVideoProject(
		title ?? files[0].name.replace(/\.[^.]+$/u, '') ?? 'Untitled video',
		editingMode
	);
	const project = await createLocalVideoProject(projectID, document);
	try {
		for (const file of files) await addFileToProject(project, file, signal);
		return await saveLocalVideoProject(project);
	} catch (cause) {
		await deleteLocalVideoProject(projectID);
		throw cause;
	}
}

export async function addFileToProject(
	project: LocalVideoProject,
	file: File,
	signal?: AbortSignal,
	options: {
		kind?: VideoSourceKind;
		addToPrimary?: boolean;
		provenance?: StockMediaProvenance;
	} = {}
): Promise<VideoSource> {
	signal?.throwIfAborted();
	const sourceID = `source_${crypto.randomUUID()}`;
	const extension = file.name.match(/\.[a-zA-Z0-9]{1,8}$/u)?.[0]?.toLowerCase() ?? '';
	const storedName = `${sourceID}${extension}`;
	const metadata = await inspectSource(file, signal);
	if (metadata.duration_us > 2 * 60 * 60 * 1_000_000) {
		throw new Error(`${file.name} is longer than the 2-hour project limit.`);
	}
	const stored = await writeProjectFile(project.id, 'sources', storedName, file);
	const source: VideoSource = {
		id: sourceID,
		kind: options.kind ?? metadata.kind,
		locator: { type: 'local-opfs', path: stored.path },
		original_name: file.name || storedName,
		mime_type: file.type || metadata.mime_type,
		size_bytes: stored.size,
		duration_us: metadata.duration_us,
		width: metadata.width,
		height: metadata.height,
		rotation: 0,
		video_codec: metadata.video_codec,
		audio_codec: metadata.audio_codec,
		...(options.provenance ? { provenance: structuredClone(options.provenance) } : {})
	};
	project.document.sources[sourceID] = source;
	if (
		options.addToPrimary !== false &&
		(source.kind === 'video' || source.kind === 'recording-screen')
	) {
		project.document.primary_sequence.push(primaryClip(source));
		project.cover_source_id ??= sourceID;
	}
	await indexProjectAsset({
		id: `${project.id}:${sourceID}`,
		project_id: project.id,
		source_id: sourceID,
		path: stored.path,
		kind: 'source',
		size_bytes: stored.size,
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		disposable: false
	});
	if (typeof window !== 'undefined') {
		void import('./artifacts')
			.then(({ ensureSourceArtifacts }) =>
				ensureSourceArtifacts(project.id, source, {
					profile: 'index',
					signal
				})
			)
			.catch(() => undefined);
	}
	return source;
}

export async function addRecordingToProject(
	project: LocalVideoProject,
	manifest: RecordingManifest,
	options: {
		cameraLayout?: 'circle' | 'rounded' | 'portrait' | 'side-by-side' | 'full';
	} = {}
): Promise<void> {
	const tracks = [...manifest.tracks].sort(
		(left, right) => left.start_offset_us - right.start_offset_us
	);
	for (const track of tracks) {
		const stored = await readProjectFile(track.path);
		if (!stored || stored.size === 0) continue;
		const file = new File([stored], `${track.kind}.webm`, {
			type: track.mime_type,
			lastModified: stored.lastModified
		});
		const kind: VideoSourceKind =
			track.kind === 'screen'
				? 'recording-screen'
				: track.kind === 'camera'
					? 'recording-camera'
					: track.kind === 'microphone'
						? 'recording-microphone'
						: 'recording-system-audio';
		const source = await addStoredRecordingToProject(
			project,
			file,
			track.path,
			kind,
			track.duration_us
		);
		if (track.kind === 'camera') {
			const cameraPresentation = recordingCameraPresentation(options.cameraLayout ?? 'circle');
			project.document.visual_tracks[0] ??= {
				id: `visual_${crypto.randomUUID()}`,
				name: 'Camera',
				locked: false,
				hidden: false,
				items: []
			};
			project.document.visual_tracks[0].items.push({
				id: `camera_${crypto.randomUUID()}`,
				type: 'camera',
				source_id: source.id,
				source_in_us: 0,
				timeline_start_us: track.start_offset_us,
				duration_us: source.duration_us,
				speed: 1,
				visible: true,
				presentation: cameraPresentation
			});
		}
		if (track.kind === 'microphone' || track.kind === 'system-audio') {
			const role = track.kind === 'microphone' ? 'voice' : 'system';
			project.document.audio_tracks.push({
				id: `audio_${crypto.randomUUID()}`,
				name: track.kind === 'microphone' ? 'Microphone' : 'System audio',
				role,
				muted: false,
				items: [
					{
						id: `audio_item_${crypto.randomUUID()}`,
						source_id: source.id,
						timeline_start_us: track.start_offset_us,
						source_in_us: 0,
						duration_us: source.duration_us,
						speed: 1,
						gain_db: 0,
						fade_in_us: 0,
						fade_out_us: 0,
						muted: false,
						duck_others: track.kind === 'microphone'
					}
				]
			});
		}
	}
}

export function recordingCameraPresentation(
	layout: 'circle' | 'rounded' | 'portrait' | 'side-by-side' | 'full'
): ReturnType<typeof defaultVideoPresentation> {
	const base = defaultVideoPresentation();
	switch (layout) {
		case 'rounded':
			return {
				...base,
				position_x: 0.8,
				position_y: 0.77,
				scale: 0.28,
				corner_radius: 0.12,
				border_width: 3,
				shadow_blur: 18,
				shadow_opacity: 0.28
			};
		case 'portrait':
			return {
				...base,
				position_x: 0.79,
				position_y: 0.68,
				scale: 0.38,
				crop: { x: 0.15, y: 0, width: 0.7, height: 1 },
				corner_radius: 0.08,
				border_width: 3,
				shadow_blur: 20,
				shadow_opacity: 0.3
			};
		case 'side-by-side':
			return {
				...base,
				position_x: 0.75,
				position_y: 0.5,
				scale: 0.5,
				crop: { x: 0, y: 0, width: 0.5, height: 1 }
			};
		case 'full':
			return base;
		case 'circle':
		default:
			return {
				...base,
				position_x: 0.82,
				position_y: 0.78,
				scale: 0.24,
				corner_radius: 0.5,
				border_width: 3,
				shadow_blur: 18,
				shadow_opacity: 0.28
			};
	}
}

async function addStoredRecordingToProject(
	project: LocalVideoProject,
	file: File,
	path: string,
	kind: VideoSourceKind,
	manifestDurationUS: number
): Promise<VideoSource> {
	const metadata = await inspectSource(file);
	const durationUS =
		metadata.duration_us > 0 ? metadata.duration_us : Math.max(1, Math.round(manifestDurationUS));
	const sourceID = `source_${crypto.randomUUID()}`;
	const source: VideoSource = {
		id: sourceID,
		kind,
		locator: { type: 'local-opfs', path },
		original_name: file.name,
		mime_type: file.type || metadata.mime_type,
		size_bytes: file.size,
		duration_us: durationUS,
		width: metadata.width,
		height: metadata.height,
		rotation: 0,
		video_codec: metadata.video_codec,
		audio_codec: metadata.audio_codec
	};
	project.document.sources[sourceID] = source;
	if (kind === 'recording-screen') {
		project.document.primary_sequence.push(primaryClip(source));
		project.cover_source_id ??= sourceID;
	}
	const now = new Date().toISOString();
	await indexProjectAsset({
		id: `${project.id}:${sourceID}`,
		project_id: project.id,
		source_id: sourceID,
		path,
		kind: 'recording',
		size_bytes: file.size,
		created_at: now,
		updated_at: now,
		disposable: false
	});
	return source;
}

export function primaryClip(source: VideoSource): PrimarySequenceClip {
	return {
		id: `clip_${crypto.randomUUID()}`,
		source_id: source.id,
		mode: 'source',
		source_in_us: 0,
		source_out_us: source.duration_us,
		speed: 1,
		video: defaultVideoPresentation(),
		audio: defaultClipAudio(),
		effects: []
	};
}

export function storageBudgetError(budget: StorageBudget): Error {
	const required = formatBytes(budget.required_bytes + budget.headroom_bytes);
	const available = formatBytes(budget.available_bytes);
	return new Error(
		`This project needs about ${required} of local space, including export headroom. ${available} is available.`
	);
}

export function formatBytes(value: number): string {
	if (value < 1_024) return `${Math.round(value)} B`;
	if (value < 1_024 ** 2) return `${(value / 1_024).toFixed(1)} KB`;
	if (value < 1_024 ** 3) return `${(value / 1_024 ** 2).toFixed(1)} MB`;
	return `${(value / 1_024 ** 3).toFixed(1)} GB`;
}

async function inspectSource(
	file: File,
	signal?: AbortSignal
): Promise<{
	kind: VideoSourceKind;
	mime_type: string;
	duration_us: number;
	width: number;
	height: number;
	video_codec?: string;
	audio_codec?: string;
}> {
	if (file.type.startsWith('video/')) {
		const metadata = await probeVideo(file, signal);
		if (!metadata.hasVideoTrack) throw new Error(`${file.name} does not contain a video track.`);
		if (!metadata.canDecode)
			throw new Error(`${file.name} uses a video codec this browser cannot decode.`);
		return {
			kind: 'video',
			mime_type: metadata.mimeType,
			duration_us: Math.round(metadata.durationSeconds * 1_000_000),
			width: metadata.width,
			height: metadata.height,
			video_codec: metadata.videoCodec ?? undefined,
			audio_codec: metadata.audioCodec ?? undefined
		};
	}
	if (SUPPORTED_IMAGE_TYPES.has(file.type)) {
		const bitmap = await createImageBitmap(file);
		try {
			return {
				kind: 'image',
				mime_type: file.type,
				duration_us: 5_000_000,
				width: bitmap.width,
				height: bitmap.height
			};
		} finally {
			bitmap.close();
		}
	}
	if (file.type.startsWith('audio/') || SUPPORTED_AUDIO_TYPES.has(file.type)) {
		const duration = await audioDuration(file);
		return {
			kind: 'audio',
			mime_type: file.type,
			duration_us: Math.round(duration * 1_000_000),
			width: 0,
			height: 0
		};
	}
	throw new Error(`${file.name} is not a supported video, audio, image, or GIF file.`);
}

async function audioDuration(file: File): Promise<number> {
	const url = URL.createObjectURL(file);
	try {
		return await new Promise<number>((resolve, reject) => {
			const audio = new Audio();
			audio.preload = 'metadata';
			audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? audio.duration : 0);
			audio.onerror = () => reject(new Error(`${file.name} could not be read as audio.`));
			audio.src = url;
		});
	} finally {
		URL.revokeObjectURL(url);
	}
}

export function cloneProjectDocument(document: VideoProjectDocumentV1): VideoProjectDocumentV1 {
	return structuredClone(document);
}
