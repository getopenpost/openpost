import { createLogger } from '../workspace-fs/logger';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { executeAtomic } from '../timeline/commands/command-store.svelte';
import type { TimelineItem, TimelineTrack } from '../project/types';
import { importGeneratedVideo, importRecordedAudio } from '../media/import.svelte';
import type { CaptureArtifact, RecorderKind } from './recorder.svelte';

const logger = createLogger('InsertRecording');

export type InsertRecordingResult = {
	mediaIds: string[];
	itemIds: string[];
};

function recorderKindToTrackName(kind: RecorderKind, index: number): string {
	switch (kind) {
		case 'screen':
			return `Screen ${index + 1}`;
		case 'camera':
			return `Camera ${index + 1}`;
		case 'microphone':
			return `Mic ${index + 1}`;
		default:
			return `Recording ${index + 1}`;
	}
}

function trackKindForRecorder(kind: RecorderKind): TimelineTrack['kind'] {
	return kind === 'microphone' ? 'audio' : 'video';
}

function mimeExtension(mimeType: string): string {
	if (mimeType.includes('ogg')) return 'ogg';
	if (mimeType.includes('mp4')) return 'mp4';
	if (mimeType.includes('audio')) return 'webm';
	return 'webm';
}

export async function insertRecordingArtifacts(
	projectId: string,
	artifacts: CaptureArtifact[],
	anchorFrame: number
): Promise<InsertRecordingResult> {
	if (artifacts.length === 0) return { mediaIds: [], itemIds: [] };
	const fps = timelineStore.fps;
	const baseFrame = Number.isFinite(anchorFrame) ? Math.max(0, Math.round(anchorFrame)) : 0;

	// Import each artifact as media first (outside undo transaction)
	const imported: Array<{
		kind: RecorderKind;
		mediaId: string;
		duration: number;
		fileName: string;
	}> = [];
	for (const artifact of artifacts) {
		const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
		const ext = mimeExtension(artifact.mimeType);
		const kindLabel = artifact.kind;
		const fileName = `recording-${kindLabel}-${stamp}.${ext}`;
		const file = new File([artifact.blob], fileName, {
			type: artifact.mimeType || artifact.blob.type,
			lastModified: Date.now()
		});
		try {
			if (kindLabel === 'microphone') {
				const durationSec = Math.max(0.1, artifact.durationMs / 1000);
				const media = await importRecordedAudio(file, { projectId, duration: durationSec });
				imported.push({ kind: kindLabel, mediaId: media.id, duration: media.duration, fileName });
			} else {
				const media = await importGeneratedVideo(file, {
					projectId,
					tags: ['recorded', kindLabel]
				});
				imported.push({ kind: kindLabel, mediaId: media.id, duration: media.duration, fileName });
			}
		} catch (error) {
			logger.error(`importRecordingArtifacts failed for ${kindLabel}`, error);
			// Preserve already imported media but rethrow so caller can offer recovery downloads
			throw error;
		}
	}

	// One atomic timeline transaction for all clips/tracks
	const result = executeAtomic('INSERT_RECORDING', () => {
		const itemIds: string[] = [];
		const mediaIds = imported.map((i) => i.mediaId);
		// We need to know order - compute per artifact offset
		artifacts.forEach((artifact, idx) => {
			const importedEntry = imported[idx];
			if (!importedEntry) return;
			const offsetMs = Math.max(0, artifact.startOffsetMs);
			const from = Math.max(0, baseFrame + Math.round((offsetMs / 1000) * fps));
			const durationInFrames = Math.max(1, Math.round((importedEntry.duration || 0.1) * fps) || 1);
			const existingTracks = timelineStore.tracks;
			const order =
				existingTracks.length > 0 ? Math.max(...existingTracks.map((t) => t.order)) + 1 : 0;
			const trackKind = trackKindForRecorder(artifact.kind);
			const track: TimelineTrack = {
				id: crypto.randomUUID(),
				name: recorderKindToTrackName(artifact.kind, idx),
				kind: trackKind,
				height: trackKind === 'video' ? 72 : 56,
				locked: false,
				syncLock: true,
				visible: true,
				muted: false,
				solo: false,
				volume: 1,
				order
			};
			const sourceFps = fps;
			const item: TimelineItem = {
				id: crypto.randomUUID(),
				trackId: track.id,
				from,
				durationInFrames,
				label: importedEntry.fileName,
				type: trackKind === 'audio' ? 'audio' : 'video',
				mediaId: importedEntry.mediaId,
				originId: crypto.randomUUID(),
				sourceStart: 0,
				sourceEnd: durationInFrames,
				sourceDuration: durationInFrames,
				sourceFps,
				volume: 1
			};
			timelineStore._setTracks([...timelineStore.tracks, track]);
			timelineStore._addItem(item);
			itemIds.push(item.id);
		});
		return { mediaIds, itemIds };
	});

	return result;
}
