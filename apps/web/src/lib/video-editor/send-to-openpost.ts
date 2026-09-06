/**
 * Send to OpenPost: upload a finished export into the workspace media
 * library via the established upload client. Only final results cross the
 * boundary — projects never sync.
 */

import { uploadMediaFile } from '$lib/media-upload-client';
import { createLogger } from './workspace-fs/logger';

const logger = createLogger('SendToOpenPost');

export interface SendResult {
	mediaId: string;
	fileName: string;
}

/**
 * Upload an exported blob to the given workspace. `prepareVideo` stays off:
 * exports are already browser-compatible MP4/WebM.
 */
export async function sendToOpenPost(options: {
	workspaceId: string;
	blob: Blob;
	fileName: string;
}): Promise<SendResult> {
	const { workspaceId, blob, fileName } = options;
	try {
		const file = new File([blob], fileName, { type: blob.type || 'video/mp4' });
		const result = await uploadMediaFile({
			workspaceId,
			file,
			// SAFETY: backend accepts video_editor_export; generated union lags.
			source: 'video_editor_export' as 'upload',
			assetKind: 'library',
			retentionClass: 'library',
			prepareVideo: false
		});
		return { mediaId: result.id, fileName };
	} catch (error) {
		logger.warn('upload failed', error);
		throw error instanceof Error ? error : new Error(String(error));
	}
}
