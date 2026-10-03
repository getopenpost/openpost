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
	const media = metadata.media.find((item) => item.id === mediaId);
	if (!media) throw new Error(m.media_load_failed());
	const response = await fetch(getAuthenticatedMediaByID(mediaId), {
		credentials: 'include',
		signal
	});
	if (!response.ok) throw new Error(m.media_load_failed());
	const blob = await response.blob();
	signal?.throwIfAborted();
	const filename = media.original_filename?.trim()
		? media.original_filename
		: `media-${mediaId}.${blob.type.includes('webm') ? 'webm' : 'mp4'}`;
	return new File([blob], filename, {
		type: blob.type
	});
}
