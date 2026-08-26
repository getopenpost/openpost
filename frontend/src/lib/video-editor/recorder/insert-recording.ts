import { createLogger } from '../workspace-fs/logger';
import { importGeneratedVideo, importRecordedAudio } from '../media/import.svelte';
import { insertMediaAtPlayhead } from '../timeline/actions/insert-media';

const logger = createLogger('InsertRecording');

export type RecordingInsertKind = 'video' | 'audio';

export async function insertRecordingAtPlayhead(params: {
	blob: Blob;
	mimeType: string;
	projectId: string;
	fileName: string;
	kind: RecordingInsertKind;
	label?: string;
}): Promise<string | null> {
	const file = new File([params.blob], params.fileName, {
		type: params.mimeType || params.blob.type || 'video/webm',
		lastModified: Date.now()
	});
	try {
		let media;
		if (params.kind === 'audio') {
			// Use recorded audio path so duration is probed and not flagged as AI.
			media = await importRecordedAudio(file, {
				projectId: params.projectId,
				duration: 0,
				tags: ['recorded']
			});
		} else {
			media = await importGeneratedVideo(file, {
				projectId: params.projectId,
				tags: ['recorded']
			});
		}
		const itemId = insertMediaAtPlayhead(media, { label: params.label });
		return itemId;
	} catch (error) {
		logger.warn('insertRecordingAtPlayhead failed', error);
		return null;
	}
}
