import type { VideoProjectDocumentV1 } from '@openpost/video-project';

export const VIDEO_EDITOR_DB_NAME = 'openpost-video-editor';
export const VIDEO_EDITOR_DB_VERSION = 2;
export const VIDEO_EDITOR_ROOT = 'openpost-video-editor';

export const VIDEO_EDITOR_STORES = [
	'projects',
	'project-revisions',
	'asset-index',
	'recording-manifests',
	'analysis-results',
	'model-cache-metadata',
	'export-jobs'
] as const;

export type VideoEditorStore = (typeof VIDEO_EDITOR_STORES)[number];
export type LocalProjectState = 'local' | 'syncing' | 'cloud';

export interface LocalVideoProject {
	id: string;
	revision: number;
	created_at: string;
	updated_at: string;
	last_opened_at: string;
	cloud_project_id?: string;
	cloud_revision?: number;
	cloud_source_map: Record<string, string>;
	unsynced_source_ids: string[];
	state: LocalProjectState;
	cover_source_id?: string;
	document: VideoProjectDocumentV1;
}

export interface LocalProjectRevision {
	id: string;
	project_id: string;
	revision: number;
	kind: 'autosave' | 'checkpoint' | 'journal' | 'migration-backup';
	name?: string;
	created_at: string;
	document?: VideoProjectDocumentV1;
	raw_document?: unknown;
	operations?: VideoProjectOperation[];
}

export interface VideoProjectOperation {
	id: string;
	at: string;
	type: string;
	payload: Record<string, unknown>;
}

export interface LocalAssetIndex {
	id: string;
	project_id: string;
	source_id: string;
	path: string;
	kind:
		'source' | 'recording' | 'proxy' | 'thumbnail' | 'waveform' | 'analysis' | 'export' | 'temp';
	size_bytes: number;
	content_hash?: string;
	created_at: string;
	updated_at: string;
	disposable: boolean;
}

export interface RecordingTrackManifest {
	id: string;
	kind: 'screen' | 'camera' | 'microphone' | 'system-audio';
	path: string;
	mime_type: string;
	session_start_offset_us: number;
	start_offset_us: number;
	duration_us: number;
	bytes_written: number;
	verified_byte_length: number;
	last_chunk_index: number;
	last_chunk_timestamp_us: number;
	chunks: RecordingChunkManifest[];
	segments: RecordingTrackSegmentManifest[];
	state: 'recording' | 'complete' | 'interrupted' | 'failed';
	error?: string;
}

export interface RecordingChunkManifest {
	index: number;
	timestamp_us: number;
	position: number;
	size_bytes: number;
	sha256: string;
	media_start_us: number;
	media_end_us: number;
	session_start_us: number;
	session_end_us: number;
	flush_sequence: number;
}

export interface RecordingTrackSegmentManifest {
	id: string;
	path: string;
	mime_type: string;
	session_start_us: number;
	session_end_us?: number;
	media_start_us: number;
	media_end_us?: number;
	reason_started: 'session-start' | 'device-switch' | 'recovery';
	reason_ended?: 'session-stop' | 'device-switch' | 'device-loss' | 'external-stop' | 'storage';
}

export interface RecordingSessionEvent {
	type:
		| 'pause'
		| 'resume'
		| 'sleep-gap'
		| 'device-switch'
		| 'device-loss'
		| 'external-stop'
		| 'storage-stop';
	session_time_us: number;
	track_id?: string;
	duration_us?: number;
	detail?: string;
}

export interface RecordingManifest {
	manifest_version: 2;
	id: string;
	project_id: string;
	created_at: string;
	updated_at: string;
	session_epoch_ms: number;
	session_started_at: number;
	last_flushed_at: number;
	flush_sequence: number;
	finalization_state: 'open' | 'finalizing' | 'complete' | 'recoverable' | 'failed';
	state: 'recording' | 'complete' | 'recoverable' | 'failed';
	tracks: RecordingTrackManifest[];
	events: RecordingSessionEvent[];
}

export interface AnalysisResult {
	id: string;
	project_id: string;
	source_id: string;
	source_hash: string;
	timeline_fingerprint: string;
	kind: 'transcript' | 'silence' | 'filler' | 'reframe' | 'focus-zoom';
	algorithm_version: string;
	settings: Record<string, unknown>;
	result: unknown;
	review_status: 'unreviewed' | 'partly-applied' | 'applied' | 'dismissed';
	created_at: string;
}

export interface ModelCacheMetadata {
	id: string;
	kind: 'transcription' | 'vad' | 'reframing';
	version: string;
	size_bytes: number;
	sha256: string;
	cached_at: string;
	last_used_at: string;
}

export interface ExportJob {
	id: string;
	project_id: string;
	variant_id: string;
	state: 'queued' | 'rendering' | 'complete' | 'cancelled' | 'failed';
	progress: number;
	output_path?: string;
	error?: string;
	created_at: string;
	updated_at: string;
}

export interface VideoEditorCapabilities {
	supported: boolean;
	editorMode: 'full' | 'compact' | 'preview';
	desktopTimeline: boolean;
	webCodecs: boolean;
	videoDecoder: boolean;
	videoEncoder: boolean;
	h264Encoder: boolean;
	aacEncoder: boolean;
	webgl2: boolean;
	offscreenCanvas: boolean;
	audioWorklet: boolean;
	opfs: boolean;
	filePicker: boolean;
	screenCapture: boolean;
	mediaRecorder: boolean;
	webGPU: boolean;
	reasons: string[];
}

export interface StorageBudget {
	usage_bytes: number;
	quota_bytes: number;
	available_bytes: number;
	required_bytes: number;
	headroom_bytes: number;
	can_continue: boolean;
}
