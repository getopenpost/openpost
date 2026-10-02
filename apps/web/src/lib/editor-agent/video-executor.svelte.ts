/* oxlint-disable anti-slop/no-shape-in-symbol-names, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-known-value-widening, anti-slop/require-safety-comment-for-type-assertion -- This browser executor validates the MCP JSON operation payload and returns editor-specific evidence with the existing timeline action owners. */
import { editorSession } from '$lib/video-editor/editor.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { transitionsStore } from '$lib/video-editor/timeline/actions/transitions.svelte';
import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';
import {
	commandHistory,
	executeAtomic
} from '$lib/video-editor/timeline/commands/command-store.svelte';
import {
	addTextItemAtFrame,
	addShapeItem,
	addMarker,
	moveItems,
	removeItems,
	rippleDeleteItems,
	duplicateItems,
	splitItemsAtFrame,
	updateItemProperties,
	setItemsVolume
} from '$lib/video-editor/timeline/actions/items';
import { insertMediaAtFrame } from '$lib/video-editor/timeline/actions/insert-media';
import { addTrack, renameTrack } from '$lib/video-editor/timeline/actions/tracks';
import { trimItemToFrame } from '$lib/video-editor/timeline/actions/trim-playhead';
import { setCurrentFrame, setItemSpeed } from '$lib/video-editor/timeline/actions/items';
import { addTransition } from '$lib/video-editor/timeline/actions/transitions.svelte';
import { isTrackEffectivelyLocked } from '$lib/video-editor/timeline/utils/track-groups';
import { updatesIntroduceExclusiveTrackOverlap } from '$lib/video-editor/timeline/track-occupancy';
import {
	EditorAgentOperationError,
	editorAuthoredRevision,
	type EditorAgentRequest
} from './browser-relay';
import { mediaPool } from '$lib/video-editor/media/pool.svelte';
import {
	getSourceTranscript,
	sourceTranscriptMatchesMedia
} from '$lib/video-editor/workspace-fs/source-transcripts';
import { sourceFrameToTimelineOffset } from '$lib/video-editor/timeline/source-time-map';
import { expandSelectionWithLinkedItems } from '$lib/video-editor/timeline/utils/linked-items';
import { captureSnapshot } from '$lib/video-editor/timeline/commands/snapshot.svelte';
import { createExportableSequences } from '$lib/video-editor/export/exportable-sequences';
import { renderTimelineFrame } from '$lib/video-editor/media/render-export';
import { encodeEditorPreview } from './preview';
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { resolveMediaBlob } from '$lib/video-editor/media/import.svelte';
import { ensureProResDecoderForCodec } from '$lib/video-editor/media/prores-decoder';
import { addBackgroundItem } from '$lib/video-editor/timeline/actions/backgrounds';
import { transcriptionService } from '$lib/video-editor/transcript/transcription-service.svelte';
import { editorSettings } from '$lib/video-editor/settings/editor-settings.svelte';
import { addEffect, updateEffect, removeEffect } from '$lib/video-editor/timeline/actions/effects';
import { EFFECT_DEFINITIONS, type CssFilterType } from '$lib/video-editor/effects/types';
import { addSubtitleItemFromSrt } from '$lib/video-editor/transcript/captions';
import { renderVideoExport } from '$lib/video-editor/media/render-execution';
import { cancelEditorExport, editorExportStatus, startEditorExport } from './export-jobs';
import { sceneBrowser } from '$lib/video-editor/media/scene-search/scene-browser.svelte';
import { isSceneAnalyzableMedia } from '$lib/video-editor/media/scene-search/scene-analysis-client';
import { sceneAnalysisMatchesMedia } from '$lib/video-editor/workspace-fs/scene-analysis';
import { rankScenes } from '$lib/video-editor/media/scene-search/rank';
import type { SceneAnalysis } from '$lib/video-editor/media/scene-search/types';

interface AgentAction {
	kind: string;
	target_id?: string;
	value?: Record<string, unknown>;
}

interface AgentChange {
	projectID: string;
	sequenceID: string;
	before: string;
	after: string;
	undone: boolean;
}

let latestAgentChange: AgentChange | null = null;
const analysisJobs = new Map<
	string,
	{ projectID: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; error?: string }
>();
const cancelledSceneJobs = new Set<string>();

function sceneJobKey(mediaID: string): string {
	return `${editorSession.project?.id ?? ''}:${mediaID}`;
}

function currentAgentChange(): AgentChange | null {
	return latestAgentChange?.projectID === editorSession.project?.id &&
		latestAgentChange.sequenceID === (sequenceStore.activeSequenceId ?? 'root')
		? latestAgentChange
		: null;
}

function invalid(message: string): never {
	throw new EditorAgentOperationError('invalid_operation', message);
}

function valueObject(action: AgentAction): Record<string, unknown> {
	if (!action.value || typeof action.value !== 'object' || Array.isArray(action.value))
		invalid(`${action.kind} requires a value object`);
	return action.value;
}

function exactInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
		invalid(`${name} must be a nonnegative integer frame`);
	return value;
}

function exactString(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.trim() === '') invalid(`${name} is required`);
	return value;
}

function authoredDocument(): unknown {
	return {
		project: editorSession.project
			? {
					id: editorSession.project.id,
					name: editorSession.project.name,
					description: editorSession.project.description,
					metadata: $state.snapshot(editorSession.project.metadata),
					animation_presets: $state.snapshot(editorSession.project.animationPresets ?? []),
					font_assets: $state.snapshot(editorSession.project.fontAssets ?? [])
				}
			: null,
		media: $state.snapshot(mediaPool.mediaList.map(({ fileHandle: _handle, ...media }) => media)),
		compositions: $state.snapshot(sequenceStore.compositions),
		sequence_id: sequenceStore.activeSequenceId ?? 'root',
		items: $state.snapshot(timelineStore.items),
		tracks: $state.snapshot(timelineStore.tracks),
		transitions: $state.snapshot(transitionsStore.list),
		markers: $state.snapshot(timelineStore.markers),
		fps: timelineStore.fps,
		in_point: timelineStore.inPoint,
		out_point: timelineStore.outPoint,
		master_volume_db: timelineStore.masterVolumeDb,
		master_muted: timelineStore.masterMuted,
		bus_audio_eq: $state.snapshot(timelineStore.busAudioEq)
	};
}

export async function videoAgentRevision(): Promise<string> {
	return editorAuthoredRevision(authoredDocument());
}

function normalizedWord(value: string): string {
	return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function sceneVersion(analysis: SceneAnalysis): string {
	return `${analysis.schemaVersion}:${analysis.detectorVersion}:${analysis.contentHash ?? analysis.sourceFileSize}:${analysis.analyzedAt}`;
}

async function currentSceneAnalysis(mediaID: string): Promise<SceneAnalysis | null> {
	const media = mediaPool.get(mediaID);
	if (!media)
		throw new EditorAgentOperationError('missing_source', `Media ${mediaID} is unavailable`);
	if (!isSceneAnalyzableMedia(media))
		throw new EditorAgentOperationError(
			'unsupported',
			'Visual scene analysis requires video or image media'
		);
	await sceneBrowser.load(mediaID);
	const analysis = sceneBrowser.analysis(mediaID);
	return analysis && sceneAnalysisMatchesMedia(analysis, media) ? analysis : null;
}

function sceneSummary(analysis: SceneAnalysis): Record<string, unknown> {
	return {
		analysis_version: sceneVersion(analysis),
		method: analysis.method,
		sample_interval_seconds: analysis.sampleIntervalSec,
		analyzed_at: new Date(analysis.analyzedAt).toISOString(),
		scene_count: analysis.scenes.length,
		captioned_scene_count: analysis.scenes.filter((scene) => scene.text.trim()).length,
		caption_model: analysis.captionModel ?? null,
		limitations: [
			'Scene boundaries and captions are sampled source evidence, not continuous observation.',
			'Inspect frames within a long scene before claiming an event is absent.'
		]
	};
}

async function searchSourceSpeech(
	query: string,
	revision: string
): Promise<Record<string, unknown>> {
	const words = query.trim().split(/\s+/).map(normalizedWord).filter(Boolean);
	if (words.length === 0 || words.length > 12) invalid('Query must contain 1 to 12 words');
	const mediaIDs = [
		...new Set([
			...mediaPool.mediaList.map((media) => media.id),
			...timelineStore.items.map((item) => item.mediaId).filter((id): id is string => Boolean(id))
		])
	];
	const coverage: Array<{ media_id: string; status: string; word_count?: number }> = [];
	const matches: Array<Record<string, unknown>> = [];
	for (const mediaID of mediaIDs) {
		const media = mediaPool.get(mediaID);
		if (!media) {
			coverage.push({ media_id: mediaID, status: 'source_unavailable' });
			continue;
		}
		if (
			(!media.mimeType.startsWith('audio/') && !media.mimeType.startsWith('video/')) ||
			media.hasAudio === false
		) {
			coverage.push({ media_id: mediaID, status: 'no_audio' });
			continue;
		}
		const transcript = await getSourceTranscript(mediaID);
		if (!transcript || !sourceTranscriptMatchesMedia(transcript, media)) {
			coverage.push({ media_id: mediaID, status: 'transcript_unavailable' });
			continue;
		}
		coverage.push({
			media_id: mediaID,
			status: 'transcribed',
			word_count: transcript.words.length
		});
		const normalized = transcript.words.map((word) => normalizedWord(word.text));
		for (let index = 0; index <= normalized.length - words.length; index++) {
			if (!words.every((word, offset) => word === normalized[index + offset])) continue;
			const first = transcript.words[index]!;
			const last = transcript.words[index + words.length - 1]!;
			const text = transcript.words
				.slice(index, index + words.length)
				.map((word) => word.text)
				.join(' ');
			const occurrences = timelineStore.items.filter((candidate) => candidate.mediaId === mediaID);
			if (occurrences.length === 0) {
				matches.push({
					media_id: mediaID,
					item_id: null,
					sequence_id: sequenceStore.activeSequenceId ?? 'root',
					source_start_seconds: first.startSeconds,
					source_end_seconds: last.endSeconds,
					timeline_start_frame: null,
					timeline_end_frame: null,
					text,
					analysis_version: transcript.updatedAt
				});
			}
			for (const item of occurrences) {
				const sourceFps = item.sourceFps || timelineStore.fps;
				const startOffset = sourceFrameToTimelineOffset(
					item,
					first.startSeconds * sourceFps,
					timelineStore.fps
				);
				const endOffset = sourceFrameToTimelineOffset(
					item,
					last.endSeconds * sourceFps,
					timelineStore.fps
				);
				if (
					Math.min(startOffset, endOffset) < 0 ||
					Math.max(startOffset, endOffset) > item.durationInFrames
				)
					continue;
				matches.push({
					media_id: mediaID,
					item_id: item.id,
					sequence_id: sequenceStore.activeSequenceId ?? 'root',
					source_start_seconds: first.startSeconds,
					source_end_seconds: last.endSeconds,
					timeline_start_frame: item.from + Math.round(Math.min(startOffset, endOffset)),
					timeline_end_frame: item.from + Math.round(Math.max(startOffset, endOffset)),
					text,
					analysis_version: transcript.updatedAt
				});
			}
			if (matches.length >= 50) break;
		}
		if (matches.length >= 50) break;
	}
	return { revision, query, matches, truncated: matches.length >= 50, coverage };
}

async function inspectSource(
	mediaID: string,
	offset: number,
	limit: number
): Promise<Record<string, unknown>> {
	const media = mediaPool.get(mediaID);
	if (!media)
		throw new EditorAgentOperationError('missing_source', `Media ${mediaID} is unavailable`);
	const transcript = await getSourceTranscript(mediaID);
	const validTranscript =
		transcript && sourceTranscriptMatchesMedia(transcript, media) ? transcript : null;
	return {
		media_id: mediaID,
		metadata: {
			file_name: media.fileName,
			mime_type: media.mimeType,
			duration_seconds: media.duration,
			file_size: media.fileSize,
			storage_type: media.storageType,
			has_audio: media.hasAudio
		},
		transcript: validTranscript
			? {
					analysis_version: validTranscript.updatedAt,
					model: validTranscript.resolvedModel,
					word_count: validTranscript.words.length,
					words: validTranscript.words.slice(offset, offset + limit),
					has_more: offset + limit < validTranscript.words.length
				}
			: { status: 'unavailable' },
		coverage: validTranscript ? 'source speech only' : 'metadata only'
	};
}

async function renderSourceFrame(
	mediaID: string,
	seconds: number,
	revision: string
): Promise<Record<string, unknown>> {
	if (!Number.isFinite(seconds) || seconds < 0) invalid('time_seconds must be nonnegative');
	const media = mediaPool.get(mediaID);
	if (!media)
		throw new EditorAgentOperationError('missing_source', `Media ${mediaID} is unavailable`);
	if (media.duration && seconds > media.duration)
		invalid('time_seconds is outside source duration');
	const blob = await resolveMediaBlob(media);
	let frame: Blob;
	let decodedSeconds = 0;
	if (media.mimeType.startsWith('image/')) {
		frame = blob;
	} else {
		const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
		try {
			const track = await input.getPrimaryVideoTrack();
			if (!track)
				throw new EditorAgentOperationError('unsupported', `Media ${mediaID} has no video frames`);
			await ensureProResDecoderForCodec(track.codec);
			const sink = new CanvasSink(track, { poolSize: 1 });
			try {
				const decoded = await sink.getCanvas(seconds);
				if (!decoded)
					throw new EditorAgentOperationError(
						'render_unavailable',
						`Could not decode source frame at ${seconds}s`
					);
				const canvas = new OffscreenCanvas(decoded.canvas.width, decoded.canvas.height);
				const context = canvas.getContext('2d');
				if (!context)
					throw new EditorAgentOperationError(
						'render_unavailable',
						'Source frame canvas is unavailable'
					);
				context.drawImage(decoded.canvas, 0, 0);
				frame = await canvas.convertToBlob({ type: 'image/png' });
				decodedSeconds = decoded.timestamp;
			} finally {
				(sink as CanvasSink & { dispose?: () => void }).dispose?.();
			}
		} finally {
			input.dispose?.();
		}
	}
	return {
		media_id: mediaID,
		requested_time_seconds: seconds,
		source_time_seconds: decodedSeconds,
		revision,
		provenance: 'decoded source media frame, before timeline composition',
		...(await encodeEditorPreview(frame))
	};
}

async function renderSourceStoryboard(
	mediaID: string,
	start: number,
	end: number,
	samples: number,
	revision: string
): Promise<Record<string, unknown>> {
	const media = mediaPool.get(mediaID);
	if (!media)
		throw new EditorAgentOperationError('missing_source', `Media ${mediaID} is unavailable`);
	if (!media.mimeType.startsWith('video/'))
		throw new EditorAgentOperationError('unsupported', 'Storyboards require a video source');
	if (
		!Number.isFinite(start) ||
		!Number.isFinite(end) ||
		start < 0 ||
		end <= start ||
		(media.duration > 0 && end > media.duration)
	)
		invalid('Storyboard range must fit within source duration');
	if (!Number.isSafeInteger(samples) || samples < 2 || samples > 9)
		invalid('samples must be from 2 to 9');
	const input = new Input({
		source: new BlobSource(await resolveMediaBlob(media)),
		formats: ALL_FORMATS
	});
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) throw new EditorAgentOperationError('unsupported', 'Source has no video frames');
		await ensureProResDecoderForCodec(track.codec);
		const sink = new CanvasSink(track, { poolSize: 1 });
		try {
			const columns = 3;
			const cellWidth = 200;
			const frameHeight = 112;
			const cellHeight = 136;
			const canvas = new OffscreenCanvas(
				columns * cellWidth,
				Math.ceil(samples / columns) * cellHeight
			);
			const context = canvas.getContext('2d');
			if (!context)
				throw new EditorAgentOperationError(
					'render_unavailable',
					'Storyboard canvas is unavailable'
				);
			context.fillStyle = '#161616';
			context.fillRect(0, 0, canvas.width, canvas.height);
			const frames: Array<{
				requested_time_seconds: number;
				source_time_seconds: number | null;
				status: string;
			}> = [];
			for (let index = 0; index < samples; index++) {
				const seconds = start + ((end - start) * (index + 0.5)) / samples;
				const x = (index % columns) * cellWidth;
				const y = Math.floor(index / columns) * cellHeight;
				const decoded = await sink.getCanvas(seconds);
				if (decoded) {
					const scale = Math.min(
						cellWidth / decoded.canvas.width,
						frameHeight / decoded.canvas.height
					);
					const width = decoded.canvas.width * scale;
					const height = decoded.canvas.height * scale;
					context.drawImage(
						decoded.canvas,
						x + (cellWidth - width) / 2,
						y + (frameHeight - height) / 2,
						width,
						height
					);
				}
				context.fillStyle = '#ffffff';
				context.font = '12px sans-serif';
				context.fillText(
					`${(decoded?.timestamp ?? seconds).toFixed(2)}s${decoded ? '' : ' unavailable'}`,
					x + 6,
					y + frameHeight + 17
				);
				frames.push({
					requested_time_seconds: seconds,
					source_time_seconds: decoded?.timestamp ?? null,
					status: decoded ? 'decoded' : 'unavailable'
				});
			}
			const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.78 });
			return {
				media_id: mediaID,
				revision,
				source_range_seconds: { start, end },
				frames,
				coverage: frames.every((frame) => frame.status === 'decoded') ? 'sampled' : 'partial',
				provenance:
					'sampled source frames before timeline composition; unsampled intervals are not verified',
				...(await encodeEditorPreview(blob))
			};
		} finally {
			(sink as CanvasSink & { dispose?: () => void }).dispose?.();
		}
	} finally {
		input.dispose?.();
	}
}

async function sourceAnalysisStatus(mediaID: string): Promise<Record<string, unknown>> {
	const media = mediaPool.get(mediaID);
	if (!media)
		throw new EditorAgentOperationError('missing_source', `Media ${mediaID} is unavailable`);
	if (!media.mimeType.startsWith('audio/') && !media.mimeType.startsWith('video/'))
		return { media_id: mediaID, status: 'unsupported', reason: 'Source has no audio stream' };
	const transcript = await getSourceTranscript(mediaID);
	const current = analysisJobs.get(mediaID);
	return {
		media_id: mediaID,
		status:
			current?.projectID === editorSession.project?.id && current.status === 'running'
				? 'running'
				: transcript && sourceTranscriptMatchesMedia(transcript, media)
					? 'completed'
					: current?.projectID === editorSession.project?.id
						? current.status
						: 'unavailable',
		analysis_version:
			transcript && sourceTranscriptMatchesMedia(transcript, media)
				? transcript.updatedAt
				: undefined,
		word_count:
			transcript && sourceTranscriptMatchesMedia(transcript, media)
				? transcript.words.length
				: undefined,
		error: current?.projectID === editorSession.project?.id ? current.error : undefined
	};
}

function item(targetID: string) {
	const found = timelineStore.itemById.get(targetID);
	if (!found) invalid(`Timeline item ${targetID} does not exist in the active sequence`);
	if (isTrackEffectivelyLocked(found.trackId, timelineStore.tracks))
		throw new EditorAgentOperationError('locked', `Timeline item ${targetID} is locked`);
	return found;
}

function applyAction(action: AgentAction): string[] {
	const targetID = action.target_id;
	switch (action.kind) {
		case 'media.insert': {
			const value = valueObject(action);
			const mediaID = exactString(value.media_id, 'media_id');
			const media = mediaPool.get(mediaID);
			if (!media)
				throw new EditorAgentOperationError('missing_source', `Media ${mediaID} is unavailable`);
			const frame = exactInteger(value.frame, 'frame');
			const trackID = exactString(value.track_id, 'track_id');
			return [insertMediaAtFrame(media, frame, { exactTrackId: trackID })];
		}
		case 'text.add': {
			const value = valueObject(action);
			const text = exactString(value.text, 'text');
			const frame = exactInteger(value.frame, 'frame');
			return [
				addTextItemAtFrame(
					text,
					frame,
					typeof value.track_id === 'string' ? value.track_id : undefined
				)
			];
		}
		case 'shape.add': {
			const value = valueObject(action);
			const kind = value.kind;
			if (
				kind !== 'rectangle' &&
				kind !== 'circle' &&
				kind !== 'triangle' &&
				kind !== 'ellipse' &&
				kind !== 'star' &&
				kind !== 'polygon' &&
				kind !== 'heart'
			)
				invalid('Unsupported shape kind');
			return [
				addShapeItem(
					kind,
					undefined,
					{},
					{
						frame: exactInteger(value.frame, 'frame'),
						preferredTrackId: typeof value.track_id === 'string' ? value.track_id : undefined
					}
				)
			];
		}
		case 'background.add': {
			const value = valueObject(action);
			return [
				addBackgroundItem(undefined, {
					frame: exactInteger(value.frame, 'frame'),
					preferredTrackId: typeof value.track_id === 'string' ? value.track_id : undefined
				})
			];
		}
		case 'marker.add': {
			return [addMarker(exactInteger(valueObject(action).frame, 'frame'))];
		}
		case 'captions.import_srt': {
			const content = exactString(valueObject(action).srt, 'srt');
			if (content.length > 16_000) invalid('srt must be at most 16000 characters');
			try {
				return [addSubtitleItemFromSrt(content)];
			} catch (error) {
				return invalid(error instanceof Error ? error.message : 'Could not import captions');
			}
		}
		case 'caption.set': {
			const id = exactString(targetID, 'target_id');
			const current = item(id);
			if (current.type !== 'subtitle' || !current.cues) invalid(`${id} is not a subtitle item`);
			const value = valueObject(action);
			const cueID = exactString(value.cue_id, 'cue_id');
			const text = exactString(value.text, 'text');
			const cue = current.cues.find((entry) => entry.id === cueID);
			if (!cue) invalid(`Subtitle cue ${cueID} does not exist`);
			if (cue.text === text) return [id, cueID];
			if (
				!updateItemProperties(id, {
					cues: current.cues.map((cue) => (cue.id === cueID ? { ...cue, text } : cue))
				})
			)
				invalid(`Could not update subtitle ${id}`);
			return [id, cueID];
		}
		case 'effect.add': {
			const id = exactString(targetID, 'target_id');
			const current = item(id);
			const kind = exactString(valueObject(action).kind, 'kind');
			const definition = EFFECT_DEFINITIONS.find((effect) => effect.type === kind);
			if (!definition) invalid(`Unsupported effect ${kind}`);
			const before = new Set((current.effects ?? []).map((effect) => effect.id));
			if (!addEffect(id, definition.type as CssFilterType))
				invalid(`Could not add effect to ${id}`);
			const created = (timelineStore.itemById.get(id)?.effects ?? []).find(
				(effect) => !before.has(effect.id)
			);
			if (!created) invalid('Effect was not created');
			return [id, created.id];
		}
		case 'effect.set': {
			const id = exactString(targetID, 'target_id');
			const current = item(id);
			const value = valueObject(action);
			const effectID = exactString(value.effect_id, 'effect_id');
			const effect = current.effects?.find((entry) => entry.id === effectID);
			if (!effect || effect.type === 'gpu')
				invalid(`CSS effect ${effectID} does not exist on ${id}`);
			const patch: { amount?: number; enabled?: boolean } = {};
			if (value.amount !== undefined) {
				const definition = EFFECT_DEFINITIONS.find((entry) => entry.type === effect.type);
				if (
					!definition ||
					typeof value.amount !== 'number' ||
					!Number.isFinite(value.amount) ||
					value.amount < definition.min ||
					value.amount > definition.max
				)
					invalid(`amount is outside the range for ${effect.type}`);
				patch.amount = value.amount;
			}
			if (value.enabled !== undefined) {
				if (typeof value.enabled !== 'boolean') invalid('enabled must be boolean');
				patch.enabled = value.enabled;
			}
			if (Object.keys(patch).length === 0) invalid('No effect fields were provided');
			if (
				(patch.amount === undefined || patch.amount === effect.amount) &&
				(patch.enabled === undefined || patch.enabled === effect.enabled)
			)
				return [id, effectID];
			if (!updateEffect(id, effectID, patch)) invalid(`Could not update effect ${effectID}`);
			return [id, effectID];
		}
		case 'effect.remove': {
			const id = exactString(targetID, 'target_id');
			item(id);
			const effectID = exactString(valueObject(action).effect_id, 'effect_id');
			if (!removeEffect(id, effectID)) invalid(`Could not remove effect ${effectID}`);
			return [id, effectID];
		}
		case 'text.set': {
			const id = exactString(targetID, 'target_id');
			const current = item(id);
			if (current.type !== 'text') invalid(`${id} is not a text item`);
			const text = exactString(valueObject(action).text, 'text');
			if (!updateItemProperties(id, { text, label: text })) invalid(`Could not update ${id}`);
			return [id];
		}
		case 'text.style': {
			const id = exactString(targetID, 'target_id');
			const current = item(id);
			if (current.type !== 'text') invalid(`${id} is not a text item`);
			const value = valueObject(action);
			const patch: { color?: string; fontSize?: number; textAlign?: 'left' | 'center' | 'right' } =
				{};
			if (value.color !== undefined) {
				if (
					typeof value.color !== 'string' ||
					!/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value.color)
				)
					invalid('color must be a hex color');
				patch.color = value.color;
			}
			if (value.font_size !== undefined) {
				if (
					typeof value.font_size !== 'number' ||
					!Number.isFinite(value.font_size) ||
					value.font_size < 1 ||
					value.font_size > 1000
				)
					invalid('font_size must be from 1 to 1000');
				patch.fontSize = value.font_size;
			}
			if (value.align !== undefined) {
				if (value.align !== 'left' && value.align !== 'center' && value.align !== 'right')
					invalid('align must be left, center, or right');
				patch.textAlign = value.align;
			}
			if (!Object.keys(patch).length) invalid('No text style fields were provided');
			if (!updateItemProperties(id, patch)) invalid(`Could not style ${id}`);
			return [id];
		}
		case 'item.transform': {
			const id = exactString(targetID, 'target_id');
			const current = item(id);
			if (current.type === 'audio') invalid('Audio items have no visual transform');
			if (current.transformParent) invalid('Parented items require the Motion transform controls');
			const value = valueObject(action);
			const transform = { ...current.transform };
			let changed = false;
			for (const key of ['x', 'y', 'width', 'height', 'rotation', 'opacity'] as const) {
				const number = value[key];
				if (number === undefined) continue;
				if (typeof number !== 'number' || !Number.isFinite(number))
					invalid(`${key} must be a finite number`);
				if ((key === 'width' || key === 'height') && number <= 0)
					invalid(`${key} must be positive`);
				if (key === 'opacity' && (number < 0 || number > 1)) invalid('opacity must be from 0 to 1');
				transform[key] = number;
				changed = true;
			}
			if (!changed) invalid('No transform fields were provided');
			if (!updateItemProperties(id, { transform })) invalid(`Could not transform ${id}`);
			return [id];
		}
		case 'clip.remove': {
			const id = exactString(targetID, 'target_id');
			item(id);
			const value = valueObject(action);
			if (typeof value.include_linked !== 'boolean') invalid('include_linked must be explicit');
			const removed = removeItems([id], value.include_linked);
			if (!removed.includes(id)) invalid(`Could not remove ${id}`);
			return removed;
		}
		case 'clip.ripple_remove': {
			const id = exactString(targetID, 'target_id');
			item(id);
			const value = valueObject(action);
			if (typeof value.include_linked !== 'boolean') invalid('include_linked must be explicit');
			const before = new Map(timelineStore.items.map((entry) => [entry.id, entry.from]));
			const removed = rippleDeleteItems([id], value.include_linked);
			if (!removed.includes(id)) invalid(`Could not ripple remove ${id}`);
			const shifted = timelineStore.items
				.filter((entry) => before.has(entry.id) && before.get(entry.id) !== entry.from)
				.map((entry) => entry.id);
			return [...removed, ...shifted];
		}
		case 'track.add': {
			const value = valueObject(action);
			const name = exactString(value.name, 'name');
			if (value.kind !== 'video' && value.kind !== 'audio')
				invalid('Track kind must be video or audio');
			return [addTrack(value.kind, name)];
		}
		case 'track.rename': {
			const id = exactString(targetID, 'target_id');
			const track = timelineStore.tracks.find((entry) => entry.id === id);
			if (!track)
				throw new EditorAgentOperationError('missing_target', `Track ${id} does not exist`);
			const name = exactString(valueObject(action).name, 'name');
			if (track.name !== name.trim() && !renameTrack(id, name)) invalid(`Could not rename ${id}`);
			return [id];
		}
		case 'clip.duplicate': {
			const id = exactString(targetID, 'target_id');
			item(id);
			const value = valueObject(action);
			if (typeof value.include_linked !== 'boolean') invalid('include_linked must be explicit');
			if (value.placement !== 'after' && value.placement !== 'above')
				invalid('placement must be after or above');
			const targets = value.include_linked
				? expandSelectionWithLinkedItems(timelineStore.items, [id])
				: [id];
			for (const target of targets) item(target);
			const created = duplicateItems(targets, { placement: value.placement });
			if (created.length !== targets.length) invalid(`Could not duplicate ${id}`);
			return created;
		}
		case 'clip.split': {
			const id = exactString(targetID, 'target_id');
			const targets = expandSelectionWithLinkedItems(timelineStore.items, [id]);
			for (const target of targets) item(target);
			const current = item(id);
			const frame = exactInteger(valueObject(action).frame, 'frame');
			if (frame <= current.from || frame >= current.from + current.durationInFrames)
				invalid('Split frame is outside the clip interior');
			if (
				targets.some((target) => {
					const companion = timelineStore.itemById.get(target)!;
					return frame <= companion.from || frame >= companion.from + companion.durationInFrames;
				})
			)
				invalid('Split frame is outside a linked companion');
			const result = splitItemsAtFrame(frame, targets);
			if (targets.some((target) => !result.left.includes(target)))
				invalid('Could not split every linked item');
			return [...result.left, ...result.right];
		}
		case 'clip.move': {
			const id = exactString(targetID, 'target_id');
			const current = item(id);
			const value = valueObject(action);
			const frame = exactInteger(value.frame, 'frame');
			const trackID = exactString(value.track_id, 'track_id');
			const track = timelineStore.tracks.find((candidate) => candidate.id === trackID);
			if (!track || track.isGroup || isTrackEffectivelyLocked(trackID, timelineStore.tracks))
				invalid('Destination track is missing or locked');
			if (
				(track.kind === 'audio' && current.type !== 'audio') ||
				(track.kind !== 'audio' && current.type === 'audio')
			)
				invalid('Destination track is incompatible with the item');
			const delta = frame - current.from;
			const targets = expandSelectionWithLinkedItems(timelineStore.items, [id]);
			const moves = targets.map((target) => {
				const companion = item(target);
				const from = companion.from + delta;
				if (from < 0) invalid('A linked item would move before frame zero');
				return { id: target, from, trackId: target === id ? trackID : companion.trackId };
			});
			if (
				updatesIntroduceExclusiveTrackOverlap(
					timelineStore.items,
					moves.map((move) => ({ id: move.id, patch: { from: move.from, trackId: move.trackId } }))
				)
			)
				throw new EditorAgentOperationError('occupied', 'Destination range is occupied');
			moveItems(moves);
			return targets;
		}
		case 'clip.trim_start':
		case 'clip.trim_end': {
			const id = exactString(targetID, 'target_id');
			item(id);
			const frame = exactInteger(valueObject(action).frame, 'frame');
			if (!trimItemToFrame(id, action.kind === 'clip.trim_start' ? 'start' : 'end', frame))
				invalid(`Could not trim ${id} to frame ${frame}`);
			return [id];
		}
		case 'clip.speed': {
			const id = exactString(targetID, 'target_id');
			item(id);
			const rate = valueObject(action).rate;
			if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0 || rate > 16)
				invalid('rate must be greater than zero and at most 16');
			if (!setItemSpeed(id, rate)) invalid(`Could not change speed for ${id}`);
			return [id];
		}
		case 'audio.gain': {
			const id = exactString(targetID, 'target_id');
			const current = item(id);
			if (current.type !== 'audio' && current.type !== 'video') invalid(`${id} has no audio gain`);
			const gain = valueObject(action).gain;
			if (typeof gain !== 'number' || !Number.isFinite(gain) || gain < 0 || gain > 1)
				invalid('gain must be a number from 0 to 1');
			const result = setItemsVolume([id], gain);
			if (result.locked || !result.changed) invalid(`Could not change gain for ${id}`);
			return [id];
		}
		case 'audio.fade':
		case 'visual.fade': {
			const id = exactString(targetID, 'target_id');
			const current = item(id);
			const audio = action.kind === 'audio.fade';
			if (
				audio &&
				((current.type !== 'audio' && current.type !== 'video') || current.audioDetached)
			)
				invalid(`${id} has no embedded audio to fade`);
			if (!audio && current.type === 'audio') invalid(`${id} has no visual output to fade`);
			const value = valueObject(action);
			const fadeIn = value.fade_in_seconds;
			const fadeOut = value.fade_out_seconds;
			const maxSeconds = current.durationInFrames / timelineStore.fps;
			if (
				typeof fadeIn !== 'number' ||
				typeof fadeOut !== 'number' ||
				!Number.isFinite(fadeIn) ||
				!Number.isFinite(fadeOut) ||
				fadeIn < 0 ||
				fadeOut < 0 ||
				fadeIn + fadeOut > maxSeconds
			)
				invalid(`Fade durations must be nonnegative and fit within ${maxSeconds} seconds`);
			const patch = audio ? { audioFadeIn: fadeIn, audioFadeOut: fadeOut } : { fadeIn, fadeOut };
			if (!updateItemProperties(id, patch)) invalid(`Could not fade ${id}`);
			return [id];
		}
		case 'transition.add': {
			const value = valueObject(action);
			const fromID = exactString(value.from_item_id, 'from_item_id');
			const toID = exactString(value.to_item_id, 'to_item_id');
			item(fromID);
			item(toID);
			if (value.kind !== 'crossfade' && value.kind !== 'fade-black')
				invalid('Unsupported transition kind');
			const duration =
				value.duration_frames === undefined
					? undefined
					: exactInteger(value.duration_frames, 'duration_frames');
			return [addTransition(fromID, toID, value.kind, duration)];
		}
		default:
			throw new EditorAgentOperationError('unsupported', `Unsupported video action ${action.kind}`);
	}
}

export async function handleVideoAgentRequest(
	request: EditorAgentRequest,
	revealItem?: (id: string) => void
): Promise<Record<string, unknown>> {
	if (!editorSession.project || editorSession.loading)
		throw new EditorAgentOperationError('editor_unavailable', 'Video project is still loading');
	const startingDocument = authoredDocument();
	const startingJSON = JSON.stringify(startingDocument);
	const revision = await editorAuthoredRevision(startingDocument);
	switch (request.operation) {
		case 'editor_context':
			return {
				project_id: editorSession.project.id,
				editor_kind: 'video',
				revision,
				active_sequence_id: sequenceStore.activeSequenceId ?? 'root',
				playhead_frame: timelineStore.currentFrame,
				fps: timelineStore.fps,
				save_state: editorSession.saving
					? 'saving'
					: editorSession.saveError
						? 'error'
						: timelineStore.isDirty || editorSession.projectDirty
							? 'pending'
							: 'saved'
			};
		case 'editor_history_inspect': {
			const change = currentAgentChange();
			return {
				project_id: editorSession.project.id,
				revision,
				can_undo_agent_change: Boolean(
					change &&
					!change.undone &&
					change.after === revision &&
					commandHistory.getLastCommandType() === 'EDITOR_AGENT_EDIT'
				),
				can_redo_agent_change: Boolean(
					change &&
					change.undone &&
					change.before === revision &&
					commandHistory.redoStack.at(-1)?.command.type === 'EDITOR_AGENT_EDIT'
				),
				latest_agent_change: change
					? { before_revision: change.before, after_revision: change.after, undone: change.undone }
					: null
			};
		}
		case 'editor_reveal': {
			const args = request.arguments;
			if (args.project_id !== editorSession.project.id || args.expected_revision !== revision)
				throw new EditorAgentOperationError('stale_revision', 'Reveal target or revision changed');
			if (args.item_id !== undefined) {
				const target = exactString(args.item_id, 'item_id');
				if (!timelineStore.itemById.has(target))
					throw new EditorAgentOperationError(
						'missing_target',
						`Timeline item ${target} does not exist`
					);
				revealItem?.(target);
			}
			if (args.frame !== undefined) setCurrentFrame(exactInteger(args.frame, 'frame'));
			if (args.frame === undefined && args.item_id === undefined)
				invalid('frame or item_id is required');
			return {
				project_id: editorSession.project.id,
				revision,
				selected_item_id: args.item_id ?? null,
				playhead_frame: timelineStore.currentFrame,
				view_state_only: true
			};
		}
		case 'preview_render': {
			const args = request.arguments;
			if (args.project_id !== editorSession.project.id || args.expected_revision !== revision)
				throw new EditorAgentOperationError('stale_revision', 'Preview target or revision changed');
			const frame = exactInteger(args.frame, 'frame');
			const activeID = sequenceStore.activeSequenceId;
			const exportable = createExportableSequences(
				$state.snapshot(editorSession.project),
				captureSnapshot(),
				activeID
			).find((entry) => entry.id === activeID);
			if (!exportable)
				throw new EditorAgentOperationError('render_unavailable', 'Active sequence is unavailable');
			if (frame > Math.max(0, exportable.durationInFrames - 1))
				invalid('frame is outside the active sequence');
			const width = Math.min(640, exportable.project.metadata.width);
			const height = Math.max(
				1,
				Math.round((width * exportable.project.metadata.height) / exportable.project.metadata.width)
			);
			const blob = await renderTimelineFrame(exportable.project, frame, {
				width,
				height,
				burnSubtitles: true
			});
			if (JSON.stringify(authoredDocument()) !== startingJSON)
				throw new EditorAgentOperationError(
					'stale_revision',
					'Sequence changed while rendering the preview'
				);
			return {
				project_id: editorSession.project.id,
				sequence_id: activeID ?? 'root',
				revision,
				frame,
				provenance: 'composited export renderer at preview resolution',
				...(await encodeEditorPreview(blob))
			};
		}
		case 'export_start': {
			const args = request.arguments;
			if (args.project_id !== editorSession.project.id || args.expected_revision !== revision)
				throw new EditorAgentOperationError('stale_revision', 'Export target or revision changed');
			if (args.format !== 'mp4' && args.format !== 'webm')
				invalid('Video export format must be mp4 or webm');
			const activeID = sequenceStore.activeSequenceId;
			const exportable = createExportableSequences(
				$state.snapshot(editorSession.project),
				captureSnapshot(),
				activeID
			).find((entry) => entry.id === activeID);
			if (!exportable)
				throw new EditorAgentOperationError('render_unavailable', 'Active sequence is unavailable');
			if (JSON.stringify(authoredDocument()) !== startingJSON)
				throw new EditorAgentOperationError(
					'stale_revision',
					'Sequence changed while preparing export'
				);
			const projectID = editorSession.project.id;
			const format = args.format;
			return startEditorExport(projectID, revision, async (signal, progress) => {
				const artifact = await renderVideoExport(exportable.project, {
					format,
					quality: 'standard',
					subtitleMode: 'burn',
					signal,
					onProgress: (value) => progress(value.progress, value.phase)
				});
				return {
					project_id: projectID,
					sequence_id: activeID ?? 'root',
					revision,
					file_name: artifact.fileName,
					saved_path: artifact.relPath,
					file_size: artifact.blob.size,
					storage: 'video_project_exports'
				};
			});
		}
		case 'export_status':
		case 'export_cancel': {
			const args = request.arguments;
			if (args.project_id !== editorSession.project.id)
				throw new EditorAgentOperationError(
					'wrong_project',
					'Export project differs from the connected editor'
				);
			const exportID = exactString(args.export_id, 'export_id');
			const job =
				request.operation === 'export_cancel'
					? cancelEditorExport(editorSession.project.id, exportID)
					: editorExportStatus(editorSession.project.id, exportID);
			if (!job)
				throw new EditorAgentOperationError(
					'missing_job',
					'Export job is unavailable in this browser session'
				);
			return { ...job };
		}
		case 'editor_history_undo':
		case 'editor_history_redo': {
			const args = request.arguments;
			if (args.project_id !== editorSession.project.id)
				throw new EditorAgentOperationError(
					'wrong_project',
					'Project changed while request was in flight'
				);
			if (
				args.expected_revision !== revision ||
				JSON.stringify(authoredDocument()) !== startingJSON
			)
				throw new EditorAgentOperationError(
					'stale_revision',
					'Project changed before history operation'
				);
			const change = currentAgentChange();
			const undo = request.operation === 'editor_history_undo';
			if (
				!change ||
				(undo &&
					(change.undone ||
						change.after !== revision ||
						commandHistory.getLastCommandType() !== 'EDITOR_AGENT_EDIT')) ||
				(!undo &&
					(!change.undone ||
						change.before !== revision ||
						commandHistory.redoStack.at(-1)?.command.type !== 'EDITOR_AGENT_EDIT'))
			)
				throw new EditorAgentOperationError(
					'history_conflict',
					'A later change prevents this agent history operation'
				);
			if (undo) commandHistory.undo();
			else commandHistory.redo();
			change.undone = undo;
			const nextRevision = await videoAgentRevision();
			editorSession.scheduleAutosave();
			return {
				status: undo ? 'undone' : 'redone',
				project_id: editorSession.project.id,
				before_revision: revision,
				after_revision: nextRevision,
				persistence_state: 'pending'
			};
		}
		case 'timeline_inspect': {
			const offset =
				request.arguments.offset === undefined
					? 0
					: exactInteger(request.arguments.offset, 'offset');
			const limit =
				request.arguments.limit === undefined
					? 100
					: exactInteger(request.arguments.limit, 'limit');
			if (limit < 1 || limit > 100) invalid('limit must be from 1 to 100');
			const itemID = request.arguments.item_id;
			if (itemID !== undefined && (typeof itemID !== 'string' || !itemID))
				invalid('item_id must be a stable item ID');
			const selected = itemID
				? timelineStore.items.filter((entry) => entry.id === itemID)
				: timelineStore.items;
			if (itemID && selected.length === 0)
				throw new EditorAgentOperationError(
					'missing_target',
					`Timeline item ${itemID} does not exist`
				);
			return {
				project_id: editorSession.project.id,
				revision,
				sequence_id: sequenceStore.activeSequenceId ?? 'root',
				fps: timelineStore.fps,
				tracks: timelineStore.tracks.map((track) => ({
					id: track.id,
					name: track.name,
					kind: track.kind,
					order: track.order,
					locked: isTrackEffectivelyLocked(track.id, timelineStore.tracks),
					muted: track.muted,
					visible: track.visible,
					is_group: track.isGroup
				})),
				items: selected.slice(offset, offset + limit).map((entry) =>
					itemID
						? $state.snapshot(entry)
						: {
								id: entry.id,
								type: entry.type,
								label: entry.label,
								text: entry.text,
								track_id: entry.trackId,
								from_frame: entry.from,
								duration_frames: entry.durationInFrames,
								media_id: entry.mediaId,
								source_start_frame: entry.sourceStart,
								source_end_frame: entry.sourceEnd,
								source_fps: entry.sourceFps,
								speed: entry.speed,
								linked_group_id: entry.linkedGroupId,
								locked: isTrackEffectivelyLocked(entry.trackId, timelineStore.tracks)
							}
				),
				item_count: selected.length,
				offset,
				has_more: offset + limit < selected.length,
				transitions: $state.snapshot(transitionsStore.list.slice(0, 100)),
				transition_count: transitionsStore.list.length,
				markers: $state.snapshot(timelineStore.markers.slice(0, 100)),
				marker_count: timelineStore.markers.length
			};
		}
		case 'video_edit': {
			const args = request.arguments;
			if (args.project_id !== editorSession.project.id)
				throw new EditorAgentOperationError(
					'wrong_project',
					'Project changed while request was in flight'
				);
			if (args.expected_revision !== revision)
				throw new EditorAgentOperationError(
					'stale_revision',
					`Expected ${args.expected_revision}, current revision is ${revision}`
				);
			if (JSON.stringify(authoredDocument()) !== startingJSON)
				throw new EditorAgentOperationError(
					'stale_revision',
					'The project changed while checking the revision'
				);
			if (!Array.isArray(args.actions) || args.actions.length < 1 || args.actions.length > 10)
				invalid('actions must contain 1 to 10 edits');
			const changedIDs = executeAtomic('EDITOR_AGENT_EDIT', () => {
				const ids: string[] = [];
				for (const raw of args.actions as AgentAction[]) ids.push(...applyAction(raw));
				return ids;
			});
			const nextRevision = await videoAgentRevision();
			if (nextRevision !== revision) editorSession.scheduleAutosave();
			if (nextRevision !== revision)
				latestAgentChange = {
					projectID: editorSession.project.id,
					sequenceID: sequenceStore.activeSequenceId ?? 'root',
					before: revision,
					after: nextRevision,
					undone: false
				};
			return {
				status: nextRevision === revision ? 'no_change' : 'committed',
				project_id: editorSession.project.id,
				before_revision: revision,
				after_revision: nextRevision,
				changed_ids: [...new Set(changedIDs)],
				preview_state: 'pending',
				persistence_state: 'pending',
				undo_available: nextRevision !== revision && commandHistory.canUndo
			};
		}
		case 'media_search': {
			const query = exactString(request.arguments.query, 'query');
			return searchSourceSpeech(query, revision);
		}
		case 'media_analyze': {
			const args = request.arguments;
			if (args.project_id !== editorSession.project.id || args.expected_revision !== revision)
				throw new EditorAgentOperationError(
					'stale_revision',
					'Analysis target or revision changed'
				);
			const mediaID = exactString(args.media_id, 'media_id');
			const media = mediaPool.get(mediaID);
			if (!media)
				throw new EditorAgentOperationError('missing_source', `Media ${mediaID} is unavailable`);
			if (
				media.hasAudio === false ||
				(!media.mimeType.startsWith('audio/') && !media.mimeType.startsWith('video/'))
			)
				throw new EditorAgentOperationError('unsupported', 'Source has no audio to transcribe');
			const existing = await sourceAnalysisStatus(mediaID);
			if (existing.status === 'running' || existing.status === 'completed') return existing;
			const projectID = editorSession.project.id;
			analysisJobs.set(mediaID, { projectID, status: 'running' });
			void transcriptionService
				.enqueueMedia(mediaID, {
					model: editorSettings.defaultTranscriptionModel,
					language: editorSettings.defaultTranscriptionLanguage || undefined,
					quantization: editorSettings.defaultTranscriptionQuantization
				})
				.then(
					() => {
						const job = analysisJobs.get(mediaID);
						if (job?.projectID === projectID) job.status = 'completed';
					},
					(error: unknown) => {
						const job = analysisJobs.get(mediaID);
						if (job?.projectID === projectID) {
							job.status =
								error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'failed';
							job.error = error instanceof Error ? error.message : String(error);
						}
					}
				);
			return {
				media_id: mediaID,
				status: 'running',
				analysis_type: 'source_transcript',
				project_id: projectID,
				revision,
				cancellation: 'media_analysis_cancel'
			};
		}
		case 'media_analysis_status': {
			const mediaID = exactString(request.arguments.media_id, 'media_id');
			return sourceAnalysisStatus(mediaID);
		}
		case 'media_analysis_cancel': {
			const mediaID = exactString(request.arguments.media_id, 'media_id');
			const job = analysisJobs.get(mediaID);
			if (job?.projectID !== editorSession.project.id || job.status !== 'running')
				throw new EditorAgentOperationError(
					'missing_job',
					'No running source analysis exists for this media'
				);
			if (!transcriptionService.cancelForMedia(mediaID))
				throw new EditorAgentOperationError(
					'missing_job',
					'Source analysis is no longer cancellable'
				);
			return { media_id: mediaID, status: 'cancelling' };
		}
		case 'media_library': {
			const offset =
				request.arguments.offset === undefined
					? 0
					: exactInteger(request.arguments.offset, 'offset');
			const limit =
				request.arguments.limit === undefined
					? 100
					: exactInteger(request.arguments.limit, 'limit');
			if (limit < 1 || limit > 100) invalid('limit must be from 1 to 100');
			const entries = mediaPool.order.filter((id) => !mediaPool.get(id)?.tags.includes('font'));
			return {
				project_id: editorSession.project.id,
				revision,
				offset,
				media_count: entries.length,
				has_more: offset + limit < entries.length,
				media: entries.slice(offset, offset + limit).map((id) => {
					const entry = mediaPool.entry(id)!;
					const media = entry.media;
					return {
						media_id: id,
						file_name: media.fileName,
						mime_type: media.mimeType,
						duration_seconds: media.duration,
						width_px: media.width,
						height_px: media.height,
						fps: media.fps,
						codec: media.codec,
						has_audio: media.hasAudio,
						storage_type: media.storageType,
						preparation_status: entry.status,
						used_on_active_sequence: timelineStore.items.filter((item) => item.mediaId === id)
							.length
					};
				})
			};
		}
		case 'media_inspect': {
			const mediaID = exactString(request.arguments.media_id, 'media_id');
			const offset =
				request.arguments.offset === undefined
					? 0
					: exactInteger(request.arguments.offset, 'offset');
			const limit =
				request.arguments.limit === undefined
					? 100
					: exactInteger(request.arguments.limit, 'limit');
			if (limit < 1 || limit > 200) invalid('limit must be from 1 to 200');
			return inspectSource(mediaID, offset, limit);
		}
		case 'media_frame': {
			const mediaID = exactString(request.arguments.media_id, 'media_id');
			const seconds = request.arguments.time_seconds;
			if (typeof seconds !== 'number') invalid('time_seconds must be a number');
			const result = await renderSourceFrame(mediaID, seconds, revision);
			if (JSON.stringify(authoredDocument()) !== startingJSON)
				throw new EditorAgentOperationError(
					'stale_revision',
					'Sequence changed while decoding source frame'
				);
			return result;
		}
		case 'media_storyboard': {
			const args = request.arguments;
			const mediaID = exactString(args.media_id, 'media_id');
			const media = mediaPool.get(mediaID);
			if (!media)
				throw new EditorAgentOperationError('missing_source', `Media ${mediaID} is unavailable`);
			const start = args.start_seconds === undefined ? 0 : Number(args.start_seconds);
			const end = args.end_seconds === undefined ? media.duration : Number(args.end_seconds);
			const samples = args.samples === undefined ? 6 : Number(args.samples);
			const result = await renderSourceStoryboard(mediaID, start, end, samples, revision);
			if (JSON.stringify(authoredDocument()) !== startingJSON)
				throw new EditorAgentOperationError(
					'stale_revision',
					'Sequence changed while decoding storyboard'
				);
			return result;
		}
		case 'scene_analyze': {
			const args = request.arguments;
			if (args.project_id !== editorSession.project.id || args.expected_revision !== revision)
				throw new EditorAgentOperationError(
					'stale_revision',
					'Visual analysis target or revision changed'
				);
			const mediaID = exactString(args.media_id, 'media_id');
			const media = mediaPool.get(mediaID);
			if (!media)
				throw new EditorAgentOperationError('missing_source', `Media ${mediaID} is unavailable`);
			if (!isSceneAnalyzableMedia(media))
				throw new EditorAgentOperationError(
					'unsupported',
					'Visual scene analysis requires video or image media'
				);
			const existing = await currentSceneAnalysis(mediaID);
			if (existing?.captionModel && existing.scenes.every((scene) => scene.text.trim()))
				return { media_id: mediaID, status: 'completed', ...sceneSummary(existing) };
			if (!sceneBrowser.progress(mediaID)) {
				const key = sceneJobKey(mediaID);
				cancelledSceneJobs.delete(key);
				void sceneBrowser
					.analyze(media)
					.then(() => cancelledSceneJobs.delete(key))
					.catch(() => {});
			}
			return {
				media_id: mediaID,
				status: 'running',
				progress: sceneBrowser.progress(mediaID) ?? null
			};
		}
		case 'scene_analysis_status': {
			const mediaID = exactString(request.arguments.media_id, 'media_id');
			const analysis = await currentSceneAnalysis(mediaID);
			const progress = sceneBrowser.progress(mediaID);
			let status = 'unavailable';
			if (progress) status = 'running';
			else if (cancelledSceneJobs.has(sceneJobKey(mediaID))) status = 'cancelled';
			else if (sceneBrowser.error(mediaID)) status = 'failed';
			else if (analysis)
				status =
					analysis.captionModel && analysis.scenes.every((scene) => scene.text.trim())
						? 'completed'
						: 'partial';
			return {
				media_id: mediaID,
				status,
				progress: progress ?? null,
				error: sceneBrowser.error(mediaID) ?? null,
				analysis: analysis ? sceneSummary(analysis) : null
			};
		}
		case 'scene_analysis_cancel': {
			if (request.arguments.project_id !== editorSession.project.id)
				throw new EditorAgentOperationError(
					'wrong_project',
					'Project changed while cancelling visual analysis'
				);
			const mediaID = exactString(request.arguments.media_id, 'media_id');
			if (!mediaPool.get(mediaID))
				throw new EditorAgentOperationError('missing_source', `Media ${mediaID} is unavailable`);
			const running = Boolean(sceneBrowser.progress(mediaID));
			if (running) {
				cancelledSceneJobs.add(sceneJobKey(mediaID));
				sceneBrowser.cancel(mediaID);
			}
			return { media_id: mediaID, status: running ? 'cancel_requested' : 'no_change' };
		}
		case 'scene_inspect': {
			const mediaID = exactString(request.arguments.media_id, 'media_id');
			const offset =
				request.arguments.offset === undefined
					? 0
					: exactInteger(request.arguments.offset, 'offset');
			const limit =
				request.arguments.limit === undefined ? 30 : exactInteger(request.arguments.limit, 'limit');
			if (limit < 1 || limit > 100) invalid('limit must be from 1 to 100');
			const analysis = await currentSceneAnalysis(mediaID);
			if (!analysis)
				return { media_id: mediaID, status: 'unavailable', scenes: [], coverage: 'not_analyzed' };
			return {
				media_id: mediaID,
				status: 'available',
				...sceneSummary(analysis),
				scenes: analysis.scenes.slice(offset, offset + limit).map((scene) => ({
					scene_id: scene.id,
					start_seconds: scene.startSec,
					end_seconds: scene.endSec,
					sample_seconds: scene.timeSec,
					caption: scene.text || null,
					visual_description: scene.sceneData ?? null
				})),
				offset,
				has_more: offset + limit < analysis.scenes.length
			};
		}
		case 'scene_search': {
			const query = exactString(request.arguments.query, 'query');
			const mediaID =
				request.arguments.media_id === undefined
					? null
					: exactString(request.arguments.media_id, 'media_id');
			const limit =
				request.arguments.limit === undefined ? 20 : exactInteger(request.arguments.limit, 'limit');
			if (limit < 1 || limit > 50) invalid('limit must be from 1 to 50');
			const sources = mediaID
				? [mediaID]
				: mediaPool.mediaList.filter(isSceneAnalyzableMedia).map((media) => media.id);
			const analyses = await Promise.all(sources.map((id) => currentSceneAnalysis(id)));
			const missingMediaIDs = sources.filter((_id, index) => !analyses[index]);
			const captionGapMediaIDs = sources.filter((_id, index) =>
				analyses[index]?.scenes.some((scene) => !scene.text.trim())
			);
			const scenes = analyses.flatMap(
				(analysis, index) =>
					analysis?.scenes.map((scene) => ({
						id: scene.id,
						mediaId: scene.mediaId,
						mediaFileName: mediaPool.get(sources[index]!)?.fileName ?? scene.mediaId,
						timeSec: scene.timeSec,
						text: scene.text
					})) ?? []
			);
			const byID = new Map(
				analyses.flatMap(
					(analysis) =>
						analysis?.scenes.map((scene) => [scene.id, { scene, analysis }] as const) ?? []
				)
			);
			const matches = rankScenes(query, scenes)
				.slice(0, limit)
				.map((match) => {
					const evidence = byID.get(match.id)!;
					return {
						scene_id: match.id,
						media_id: match.mediaId,
						score: match.score,
						caption: match.text,
						start_seconds: evidence.scene.startSec,
						end_seconds: evidence.scene.endSec,
						sample_seconds: evidence.scene.timeSec,
						analysis_version: sceneVersion(evidence.analysis)
					};
				});
			return {
				query,
				ranker: 'keyword_fuzzy',
				matches,
				analyzed_media_ids: sources.filter((_id, index) => analyses[index]),
				missing_analysis_media_ids: missingMediaIDs,
				missing_caption_media_ids: captionGapMediaIDs,
				coverage:
					missingMediaIDs.length || captionGapMediaIDs.length ? 'partial' : 'analyzed_scenes_only',
				limitations:
					'Scene captions and boundaries are sampled; no search result can prove an event absent between samples.'
			};
		}
		default:
			throw new EditorAgentOperationError(
				'unsupported',
				`Unsupported video request ${request.operation}`
			);
	}
}
