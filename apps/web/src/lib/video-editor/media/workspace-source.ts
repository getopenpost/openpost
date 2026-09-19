import { queryMediaMetadata } from '$lib/query/media';
import { getAuthenticatedMediaByID } from '$lib/media-url';
import { m } from '$lib/paraglide/messages';

/** Resolve the authorized Workspace media before either editor creates a source asset. */
export async function loadWorkspaceMediaFile(
	workspaceId: string,
	mediaId: string,
	signal?: AbortSignal
): Promise<File> {
	const metadata = await queryMediaMetadata(workspaceId, [mediaId], { signal });
	if (!metadata.media.some((item) => item.id === mediaId)) throw new Error(m.media_load_failed());
	const response = await fetch(getAuthenticatedMediaByID(mediaId), {
		credentials: 'include',
		signal
	});
	if (!response.ok) throw new Error(m.media_load_failed());
	const blob = await response.blob();
	signal?.throwIfAborted();
	return new File([blob], `media-${mediaId}.${blob.type.includes('webm') ? 'webm' : 'mp4'}`, {
		type: blob.type
	});
}
