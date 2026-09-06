import type { components } from '$lib/api/types';

export type MediaBatchDeletionResult = components['schemas']['BatchDeleteMediaOutputBody'];

export class MediaBatchDeletionRejected extends Error {}

export function remainingMediaDeletionIDs(
	requestedIDs: string[],
	result: MediaBatchDeletionResult
): string[] {
	const failedIDs = result.failed_ids ?? [];
	if (result.deleted >= requestedIDs.length && failedIDs.length === 0) return [];
	if (failedIDs.length > 0) return [...failedIDs];
	return [...requestedIDs];
}

export async function requestRecoverableMediaBatchDeletion(
	requestedIDs: string[],
	request: (ids: string[]) => Promise<MediaBatchDeletionResult>
): Promise<MediaBatchDeletionResult> {
	try {
		return await request(requestedIDs);
	} catch (error) {
		if (error instanceof MediaBatchDeletionRejected) throw error;
		// The endpoint is idempotent, so replay reconciles a response lost after commit.
		return request(requestedIDs);
	}
}
