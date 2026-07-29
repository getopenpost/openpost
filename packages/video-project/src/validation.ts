import {
	VIDEO_PROJECT_LIMITS,
	VIDEO_PROJECT_SCHEMA_VERSION,
	VIDEO_TICKS_PER_SECOND,
	type PrimarySequenceClip,
	type ValidationIssue,
	type VideoProjectDocumentV1,
	type VideoProjectValidation
} from './types.js';
import { clipDurationUS, projectDurationUS } from './timeline.js';

const ROOT_FIELDS = new Set([
	'schema_version',
	'title',
	'timebase',
	'sources',
	'primary_sequence',
	'visual_tracks',
	'audio_tracks',
	'caption_tracks',
	'variants',
	'markers',
	'export_defaults'
]);

function issue(path: string, code: string, message: string): ValidationIssue {
	return { path, code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteInteger(value: unknown, minimum = 0): value is number {
	return Number.isInteger(value) && Number(value) >= minimum;
}

export function validateVideoProject(value: unknown): VideoProjectValidation {
	const issues: ValidationIssue[] = [];
	if (!isRecord(value)) {
		return { valid: false, issues: [issue('$', 'type', 'The project must be a JSON object.')] };
	}
	for (const field of Object.keys(value)) {
		if (!ROOT_FIELDS.has(field)) {
			issues.push(issue(`$.${field}`, 'unknown-field', 'Unknown project field.'));
		}
	}
	if (value.schema_version !== VIDEO_PROJECT_SCHEMA_VERSION) {
		issues.push(issue('$.schema_version', 'schema-version', 'Unsupported project schema version.'));
	}
	if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 200) {
		issues.push(issue('$.title', 'title', 'Title must contain 1–200 characters.'));
	}
	if (!isRecord(value.timebase)) {
		issues.push(issue('$.timebase', 'type', 'Timebase is required.'));
	} else {
		if (value.timebase.ticks_per_second !== VIDEO_TICKS_PER_SECOND) {
			issues.push(
				issue('$.timebase.ticks_per_second', 'timebase', 'Timebase must use integer microseconds.')
			);
		}
		if (![24, 25, 30, 50, 60].includes(Number(value.timebase.fps_numerator))) {
			issues.push(issue('$.timebase.fps_numerator', 'frame-rate', 'Frame rate is not supported.'));
		}
		if (![1, 1001].includes(Number(value.timebase.fps_denominator))) {
			issues.push(issue('$.timebase.fps_denominator', 'frame-rate', 'Frame-rate divisor is invalid.'));
		}
	}
	if (!isRecord(value.sources)) {
		issues.push(issue('$.sources', 'type', 'Sources must be an object.'));
	}
	const sources = isRecord(value.sources) ? value.sources : {};
	if (Object.keys(sources).length > VIDEO_PROJECT_LIMITS.maxSources) {
		issues.push(issue('$.sources', 'limit', `A project can contain up to ${VIDEO_PROJECT_LIMITS.maxSources} sources.`));
	}
	for (const [sourceID, candidate] of Object.entries(sources)) {
		validateSource(candidate, sourceID, issues);
	}

	const primary = Array.isArray(value.primary_sequence) ? value.primary_sequence : [];
	if (!Array.isArray(value.primary_sequence)) {
		issues.push(issue('$.primary_sequence', 'type', 'Primary sequence must be an array.'));
	}
	const clipIDs = new Set<string>();
	for (let index = 0; index < primary.length; index++) {
		validateClip(primary[index], index, sources, clipIDs, issues);
	}
	validateTracks(value, sources, issues);
	validateVariants(value.variants, issues);
	validateMarkers(value.markers, issues);

	try {
		const serializedBytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
		if (serializedBytes > VIDEO_PROJECT_LIMITS.maxDocumentBytes) {
			issues.push(issue('$', 'document-size', 'The serialized project document exceeds 5 MiB.'));
		}
	} catch {
		issues.push(issue('$', 'serialization', 'The project could not be serialized.'));
	}

	if (issues.length === 0) {
		const document = value as unknown as VideoProjectDocumentV1;
		if (projectDurationUS(document) > VIDEO_PROJECT_LIMITS.maxDurationUS) {
			issues.push(issue('$', 'duration', 'The final project duration cannot exceed 20 minutes.'));
		}
	}
	return issues.length
		? { valid: false, issues }
		: { valid: true, issues: [], document: value as unknown as VideoProjectDocumentV1 };
}

function validateSource(
	value: unknown,
	sourceID: string,
	issues: ValidationIssue[]
): void {
	const path = `$.sources.${sourceID}`;
	if (!isRecord(value)) {
		issues.push(issue(path, 'type', 'Source must be an object.'));
		return;
	}
	if (value.id !== sourceID) issues.push(issue(`${path}.id`, 'source-id', 'Source key and ID must match.'));
	if (
		![
			'video',
			'audio',
			'image',
			'recording-screen',
			'recording-camera',
			'recording-microphone',
			'recording-system-audio'
		].includes(String(value.kind))
	) {
		issues.push(issue(`${path}.kind`, 'source-kind', 'Source kind is not supported.'));
	}
	if (!isRecord(value.locator) || !['local-opfs', 'openpost-media'].includes(String(value.locator.type))) {
		issues.push(issue(`${path}.locator`, 'locator', 'Source locator is invalid.'));
	}
	for (const field of ['size_bytes', 'duration_us', 'width', 'height']) {
		if (!finiteInteger(value[field])) {
			issues.push(issue(`${path}.${field}`, 'number', `${field} must be a non-negative integer.`));
		}
	}
	if (typeof value.mime_type !== 'string' || !value.mime_type) {
		issues.push(issue(`${path}.mime_type`, 'mime', 'Source MIME type is required.'));
	}
}

function validateClip(
	value: unknown,
	index: number,
	sources: Record<string, unknown>,
	ids: Set<string>,
	issues: ValidationIssue[]
): void {
	const path = `$.primary_sequence[${index}]`;
	if (!isRecord(value)) {
		issues.push(issue(path, 'type', 'Primary clip must be an object.'));
		return;
	}
	if (typeof value.id !== 'string' || !value.id || ids.has(value.id)) {
		issues.push(issue(`${path}.id`, 'clip-id', 'Clip IDs must be unique and non-empty.'));
	} else ids.add(value.id);
	if (typeof value.source_id !== 'string' || !sources[value.source_id]) {
		issues.push(issue(`${path}.source_id`, 'source-reference', 'Clip source does not exist.'));
	}
	if (!['source', 'freeze'].includes(String(value.mode))) {
		issues.push(issue(`${path}.mode`, 'clip-mode', 'Clip mode is invalid.'));
	}
	if (
		!finiteInteger(value.source_in_us) ||
		!finiteInteger(value.source_out_us) ||
		Number(value.source_out_us) < Number(value.source_in_us)
	) {
		issues.push(issue(path, 'source-range', 'Clip source range is invalid.'));
	}
	if (
		typeof value.speed !== 'number' ||
		!Number.isFinite(value.speed) ||
		value.speed < 0.25 ||
		value.speed > 4
	) {
		issues.push(issue(`${path}.speed`, 'speed', 'Clip speed must be between 0.25× and 4×.'));
	}
	if (value.mode === 'freeze' && !finiteInteger(value.freeze_duration_us, 1)) {
		issues.push(issue(`${path}.freeze_duration_us`, 'freeze', 'Freeze duration must be positive.'));
	}
	if (value.mode === 'source' && clipDurationUS(value as unknown as PrimarySequenceClip) <= 0) {
		issues.push(issue(path, 'duration', 'Clip must have a positive duration.'));
	}
	for (const transitionField of ['transition_in', 'transition_out'] as const) {
		const transition = value[transitionField];
		if (transition === undefined) continue;
		if (!isRecord(transition) || !finiteInteger(transition.duration_us)) {
			issues.push(issue(`${path}.${transitionField}`, 'transition', 'Transition is invalid.'));
		}
	}
}

function validateTracks(
	value: Record<string, unknown>,
	sources: Record<string, unknown>,
	issues: ValidationIssue[]
): void {
	const visual = Array.isArray(value.visual_tracks) ? value.visual_tracks : [];
	const audio = Array.isArray(value.audio_tracks) ? value.audio_tracks : [];
	const captions = Array.isArray(value.caption_tracks) ? value.caption_tracks : [];
	if (visual.length > VIDEO_PROJECT_LIMITS.maxVisualTracks) {
		issues.push(issue('$.visual_tracks', 'limit', 'A project can contain up to four visual overlay tracks.'));
	}
	if (audio.length > VIDEO_PROJECT_LIMITS.maxAudioTracks) {
		issues.push(issue('$.audio_tracks', 'limit', 'A project can contain up to eight audio tracks.'));
	}
	if (captions.length > VIDEO_PROJECT_LIMITS.maxCaptionTracks) {
		issues.push(issue('$.caption_tracks', 'limit', 'A project can contain up to two caption tracks.'));
	}
	let timelineItems = 0;
	for (const [trackIndex, track] of [...visual.entries()]) {
		if (!isRecord(track) || !Array.isArray(track.items)) {
			issues.push(issue(`$.visual_tracks[${trackIndex}]`, 'track', 'Visual track is invalid.'));
			continue;
		}
		timelineItems += track.items.length;
		for (const [itemIndex, item] of track.items.entries()) {
			if (!isRecord(item)) continue;
			if ('source_id' in item && (typeof item.source_id !== 'string' || !sources[item.source_id])) {
				issues.push(
					issue(
						`$.visual_tracks[${trackIndex}].items[${itemIndex}].source_id`,
						'source-reference',
						'Overlay source does not exist.'
					)
				);
			}
		}
	}
	for (const [trackIndex, track] of [...audio.entries()]) {
		if (!isRecord(track) || !Array.isArray(track.items)) {
			issues.push(issue(`$.audio_tracks[${trackIndex}]`, 'track', 'Audio track is invalid.'));
			continue;
		}
		timelineItems += track.items.length;
		for (const [itemIndex, item] of track.items.entries()) {
			if (!isRecord(item) || typeof item.source_id !== 'string' || !sources[item.source_id]) {
				issues.push(
					issue(
						`$.audio_tracks[${trackIndex}].items[${itemIndex}].source_id`,
						'source-reference',
						'Audio source does not exist.'
					)
				);
			}
		}
	}
	if (timelineItems > VIDEO_PROJECT_LIMITS.maxTimelineItems) {
		issues.push(issue('$', 'timeline-limit', 'The project contains more than 2,000 timeline items.'));
	}
	let captionCues = 0;
	for (const [trackIndex, track] of [...captions.entries()]) {
		if (!isRecord(track) || !Array.isArray(track.cues)) {
			issues.push(issue(`$.caption_tracks[${trackIndex}]`, 'track', 'Caption track is invalid.'));
			continue;
		}
		captionCues += track.cues.length;
	}
	if (captionCues > VIDEO_PROJECT_LIMITS.maxCaptionCues) {
		issues.push(issue('$.caption_tracks', 'caption-limit', 'The project contains more than 5,000 caption cues.'));
	}
}

function validateVariants(value: unknown, issues: ValidationIssue[]): void {
	if (!Array.isArray(value)) {
		issues.push(issue('$.variants', 'type', 'Variants must be an array.'));
		return;
	}
	const expected = new Set(['portrait', 'feed-portrait', 'square', 'landscape']);
	for (const [index, variant] of value.entries()) {
		if (!isRecord(variant) || !expected.delete(String(variant.id))) {
			issues.push(issue(`$.variants[${index}].id`, 'variant', 'Variant ID is invalid or duplicated.'));
		}
	}
	if (expected.size) issues.push(issue('$.variants', 'variant', 'All four social variants are required.'));
}

function validateMarkers(value: unknown, issues: ValidationIssue[]): void {
	if (!Array.isArray(value)) {
		issues.push(issue('$.markers', 'type', 'Markers must be an array.'));
		return;
	}
	for (const [index, marker] of value.entries()) {
		if (!isRecord(marker) || !finiteInteger(marker.time_us)) {
			issues.push(issue(`$.markers[${index}]`, 'marker', 'Marker is invalid.'));
		}
	}
}

export function assertValidVideoProject(value: unknown): VideoProjectDocumentV1 {
	const result = validateVideoProject(value);
	if (!result.valid || !result.document) {
		const summary = result.issues
			.slice(0, 5)
			.map((entry) => `${entry.path}: ${entry.message}`)
			.join('; ');
		throw new Error(`Invalid Video Studio project: ${summary}`);
	}
	return result.document;
}
