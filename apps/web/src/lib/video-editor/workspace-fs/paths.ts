/**
 * Pure path builders for the workspace filesystem layout.
 *
 * Every file in the workspace is derived from ids via these helpers so the
 // SAFETY: the stored value satisfies the target type here.
 * layout is in one place and easy to audit. Keep these as arrays of segments
 * — consumers compose them with FS primitives rather than string-joining,
 * because File System Access API uses nested getDirectoryHandle calls, not
 * slash-separated paths.
 *
 * Layout reference:
 * ```
 * {workspace}/
 * ├── README.md
 * ├── .openpost-video-workspace.json
 * ├── index.json
 * ├── projects/
 * │   └── {id}/
 * │       ├── project.json
 * │       ├── thumbnail.jpg
 * │       ├── media-links.json
 * │       ├── render-queue.json
 * │       └── exports/
 * ├── media/
 * │   └── {id}/
 * │       ├── metadata.json
 * │       ├── {sanitized-name}.{ext}  |  source.link.json
 * │       ├── thumbnail.jpg
 * │       └── cache/
 * │           ├── filmstrip/{meta.json,N.jpg}
 * │           ├── waveform/{meta.json,multi-res.bin}
 * │           ├── decoded-audio/{left-N.bin,right-N.bin}
 * │           ├── preview-audio.wav
 * │           └── ai/{transcript,captions,scenes}.json
 * ├── recordings/                       # crash-safe recorder chunks + finished takes
 * └── content/proxies/{proxyKey}/       # shared proxies (keyed by content fingerprint)
 * ```
 *
 * Ported from FreeCut (MIT) — paths.ts, trimmed to OpenPost's v1 surface.
 */

export const WORKSPACE_SCHEMA_VERSION = '2.0';

export const README_FILENAME = 'README.md';
export const MARKER_FILENAME = '.openpost-video-workspace.json';
export const INDEX_FILENAME = 'index.json';

export const PROJECTS_DIR = 'projects';
export const MEDIA_DIR = 'media';
export const RECORDINGS_DIR = 'recordings';
export const CONTENT_DIR = 'content';
/**
 * Final render outputs land here (`{workspace}/exports/`) so they're easy to
 * find when browsing the workspace folder on disk.
 */
export const EXPORTS_DIR = 'exports';

const PROJECT_FILENAME = 'project.json';
const PROJECT_THUMBNAIL_FILENAME = 'thumbnail.jpg';
const PROJECT_MEDIA_LINKS_FILENAME = 'media-links.json';
/** Persisted render-queue jobs for a project (survives refresh). */
const PROJECT_RENDER_QUEUE_FILENAME = 'render-queue.json';

/**
 * Marker file present inside a project directory that has been soft-deleted.
 * Its presence hides the project from listings while preserving all content
 * for possible restore.
 */
const PROJECT_TRASHED_MARKER_FILENAME = '.openpost-trashed.json';

const MEDIA_METADATA_FILENAME = 'metadata.json';
export const MEDIA_THUMBNAIL_FILENAME = 'thumbnail.jpg';
const MEDIA_CACHE_DIR = 'cache';

const CACHE_WAVEFORM_DIR = 'waveform';
const CACHE_FILMSTRIP_DIR = 'filmstrip';
const CACHE_DECODED_AUDIO_DIR = 'decoded-audio';
const CACHE_AI_DIR = 'ai';
const CACHE_SCENE_THUMBS_DIR = 'scene-thumbs';
const CACHE_REVERSE_DIR = 'reverse';
const CACHE_EMBEDDED_SUBTITLES_FILENAME = 'embedded-subtitles.json';
/** Non-browser audio codecs are decoded once to WAV and reused for preview. */
const CACHE_PREVIEW_AUDIO_FILENAME = 'preview-audio.wav';
/** Header-indexed multi-res binary for timeline waveform rendering. */
const CACHE_WAVEFORM_MULTI_RES_FILENAME = 'multi-res.bin';
const CACHE_META_FILENAME = 'meta.json';

/* ------------------------------ Projects ------------------------------ */

/** Segments for `projects/{id}/`. */
export function projectDir(id: string): string[] {
	return [PROJECTS_DIR, id];
}

/** Segments for `projects/{id}/project.json`. */
export function projectJsonPath(id: string): string[] {
	return [...projectDir(id), PROJECT_FILENAME];
}

/** Segments for `projects/{id}/thumbnail.jpg`. */
export function projectThumbnailPath(id: string): string[] {
	return [...projectDir(id), PROJECT_THUMBNAIL_FILENAME];
}

/** Segments for `projects/{id}/media-links.json`. */
export function projectMediaLinksPath(id: string): string[] {
	return [...projectDir(id), PROJECT_MEDIA_LINKS_FILENAME];
}

/** Segments for `projects/{id}/render-queue.json`. */
export function projectRenderQueuePath(id: string): string[] {
	return [...projectDir(id), PROJECT_RENDER_QUEUE_FILENAME];
}

/** Segments for `projects/{id}/exports/` — a project's rendered output files. */
export function projectExportsDir(id: string): string[] {
	return [...projectDir(id), EXPORTS_DIR];
}

/** Segments for `projects/{id}/exports/{sanitizedName}`. */
export function projectExportFilePath(id: string, fileName: string): string[] {
	return [...projectExportsDir(id), sanitizeWorkspaceFileName(fileName)];
}

/** Segments for `projects/{id}/.openpost-trashed.json`. */
export function projectTrashedMarkerPath(id: string): string[] {
	return [...projectDir(id), PROJECT_TRASHED_MARKER_FILENAME];
}

/* ------------------------------- Media -------------------------------- */

/** Segments for `media/{id}/`. */
export function mediaDir(id: string): string[] {
	return [MEDIA_DIR, id];
}

/** Segments for `media/{id}/metadata.json`. */
export function mediaMetadataPath(id: string): string[] {
	return [...mediaDir(id), MEDIA_METADATA_FILENAME];
}

/** Segments for `media/{id}/thumbnail.jpg`. */
export function mediaThumbnailPath(id: string): string[] {
	return [...mediaDir(id), MEDIA_THUMBNAIL_FILENAME];
}

/** Segments for a fingerprinted reverse-conform preview in the media cache. */
export function mediaReversePreviewPath(id: string, key: string): string[] {
	return [...mediaDir(id), MEDIA_CACHE_DIR, CACHE_REVERSE_DIR, `${key}.webm`];
}

/** Parsed text subtitle tracks for one source fingerprint. */
export function mediaEmbeddedSubtitlesPath(id: string): string[] {
	return [...mediaDir(id), MEDIA_CACHE_DIR, CACHE_EMBEDDED_SUBTITLES_FILENAME];
}

/**
 * Segments for `media/{id}/{sanitizedName}` — preserves the user-visible
 * original filename inside the workspace folder so browsing on disk is
 * intelligible (`MyVacation.mp4` rather than `source.mp4`).
 */
export function mediaSourceByFileName(id: string, fileName: string): string[] {
	return [...mediaDir(id), sanitizeWorkspaceFileName(fileName)];
}

/** Never-allowed characters, per NTFS + ext4 intersection. */
// eslint-disable-next-line no-control-regex -- control chars are exactly what we strip
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001F]/g;

/** Names reserved by Windows; suffix with `_` to sidestep them. */
const WINDOWS_RESERVED_NAMES = new Set([
	'CON',
	'PRN',
	'AUX',
	'NUL',
	'COM1',
	'COM2',
	'COM3',
	'COM4',
	'COM5',
	'COM6',
	'COM7',
	'COM8',
	'COM9',
	'LPT1',
	'LPT2',
	'LPT3',
	'LPT4',
	'LPT5',
	'LPT6',
	'LPT7',
	'LPT8',
	'LPT9'
]);

const MAX_FILENAME_LENGTH = 200;

/**
 * Produce a cross-filesystem-safe variant of a user-supplied filename.
 * Falls back to `source.bin` for empty / all-invalid inputs.
 */
export function sanitizeWorkspaceFileName(fileName: string): string {
	const trimmed = (fileName ?? '').replace(/^\s+|[\s.]+$/g, '');
	if (!trimmed) return 'source.bin';

	let cleaned = trimmed.replace(INVALID_FILENAME_CHARS, '_');

	// Extract the extension so truncation doesn't chop it off.
	const dot = cleaned.lastIndexOf('.');
	const hasExt = dot > 0 && dot < cleaned.length - 1;
	const stem = hasExt ? cleaned.slice(0, dot) : cleaned;
	const ext = hasExt ? cleaned.slice(dot) : '';

	const stemBudget = Math.max(1, MAX_FILENAME_LENGTH - ext.length);
	const bounded = stem.length > stemBudget ? stem.slice(0, stemBudget) : stem;

	// Windows reserved names are matched case-insensitively against the stem.
	const isReserved = WINDOWS_RESERVED_NAMES.has(bounded.toUpperCase());
	cleaned = `${isReserved ? `${bounded}_` : bounded}${ext}`;

	return cleaned || 'source.bin';
}

/* ------------------------------- Caches ------------------------------- */

/** Segments for `media/{id}/cache/`. */
export function mediaCacheDir(id: string): string[] {
	return [...mediaDir(id), MEDIA_CACHE_DIR];
}

export function waveformDir(mediaId: string): string[] {
	return [...mediaCacheDir(mediaId), CACHE_WAVEFORM_DIR];
}

/** Segments for `media/{id}/cache/waveform/multi-res.bin`. */
export function waveformMultiResPath(mediaId: string): string[] {
	return [...waveformDir(mediaId), CACHE_WAVEFORM_MULTI_RES_FILENAME];
}

/** Segments for `media/{id}/cache/filmstrip/`. */
export function filmstripDir(mediaId: string): string[] {
	return [...mediaCacheDir(mediaId), CACHE_FILMSTRIP_DIR];
}

/** Segments for `media/{id}/cache/filmstrip/{N}.{ext}` — one frame per second. */
export function filmstripFramePath(mediaId: string, frameIndex: number, ext: string): string[] {
	return [...filmstripDir(mediaId), `${frameIndex}.${ext}`];
}

/** Segments for `media/{id}/cache/filmstrip/meta.json`. */
export function filmstripMetaPath(mediaId: string): string[] {
	return [...filmstripDir(mediaId), CACHE_META_FILENAME];
}

/** Segments for `media/{id}/cache/preview-audio.wav`. */
export function previewAudioPath(mediaId: string): string[] {
	return [...mediaCacheDir(mediaId), CACHE_PREVIEW_AUDIO_FILENAME];
}

export function decodedAudioDir(mediaId: string): string[] {
	return [...mediaCacheDir(mediaId), CACHE_DECODED_AUDIO_DIR];
}

export function decodedAudioBinPath(
	mediaId: string,
	channel: 'left' | 'right',
	binIndex: number
): string[] {
	return [...decodedAudioDir(mediaId), `${channel}-${binIndex}.bin`];
}

/**
 * Segments for `media/{id}/cache/ai/` — home for AI-derived analysis outputs
 * (transcripts, captions, scene cuts). One file per kind.
 */
export function aiOutputsDir(mediaId: string): string[] {
	return [...mediaCacheDir(mediaId), CACHE_AI_DIR];
}

/** Segments for `media/{id}/cache/ai/{kind}.json`. */
export function aiOutputPath(mediaId: string, kind: string): string[] {
	return [...aiOutputsDir(mediaId), `${kind}.json`];
}

/** Reusable word-timed transcript for one complete source file. */
export function sourceTranscriptPath(mediaId: string): string[] {
	return aiOutputPath(mediaId, 'transcript');
}

/** Scene Browser analysis envelope for one source file. */
export function sceneAnalysisPath(mediaId: string): string[] {
	return aiOutputPath(mediaId, 'scene-browser');
}

/** Persisted thumbnails captured at scene boundaries. */
export function sceneThumbsDir(mediaId: string): string[] {
	return [...aiOutputsDir(mediaId), CACHE_SCENE_THUMBS_DIR];
}

export function sceneThumbPath(mediaId: string, index: number): string[] {
	return [...sceneThumbsDir(mediaId), `${index}.jpg`];
}

export function sceneThumbRelPath(mediaId: string, index: number): string {
	return sceneThumbPath(mediaId, index).join('/');
}

/** Packed vectors keep local model output compact and fast to hydrate. */
export function sceneTextEmbeddingsPath(mediaId: string): string[] {
	return [...aiOutputsDir(mediaId), 'scene-text-embeddings.bin'];
}

export function sceneImageEmbeddingsPath(mediaId: string): string[] {
	return [...aiOutputsDir(mediaId), 'scene-image-embeddings.bin'];
}

export function cacheMetaPath(dir: string[]): string[] {
	return [...dir, CACHE_META_FILENAME];
}

/* ----------------------------- Recordings ----------------------------- */

/** Segments for `recordings/` — finished recorder takes before import. */
export function recordingsDir(): string[] {
	return [RECORDINGS_DIR];
}

/** Segments for `recordings/{sanitizedName}`. */
export function recordingFilePath(fileName: string): string[] {
	return [RECORDINGS_DIR, sanitizeWorkspaceFileName(fileName)];
}

/* ------------------------- Shared proxy store ------------------------- */

const CONTENT_PROXIES_DIR = 'proxies';

export function proxiesRoot(): string[] {
	return [CONTENT_DIR, CONTENT_PROXIES_DIR];
}

export function proxyFilePath(proxyKey: string): string[] {
	return [...proxiesRoot(), proxyKey, 'proxy.mp4'];
}

export function proxyMetaPath(proxyKey: string): string[] {
	return [...proxiesRoot(), proxyKey, 'meta.json'];
}

export function proxyDir(proxyKey: string): string[] {
	return [...proxiesRoot(), proxyKey];
}

/* ----------------------- Render outputs (root) ------------------------ */

/** Segments for `exports/{sanitizedName}` — a final rendered file. */
export function exportFilePath(fileName: string): string[] {
	return [EXPORTS_DIR, sanitizeWorkspaceFileName(fileName)];
}
