import type { components } from '$lib/api/types';

type Publication = components['schemas']['PublicationResponse'];
type PublicationLoader = (
	publicationId: string,
	workspaceId: string,
	force?: boolean
) => Promise<Publication>;

interface PublicationLoadOptions {
	publicationId: string;
	workspaceId: string;
	force?: boolean;
	onWorkspaceMismatch?: (error: PublicationWorkspaceMismatchError) => void | Promise<void>;
}

export class PublicationWorkspaceMismatchError extends Error {
	constructor(
		readonly expectedWorkspaceId: string,
		readonly actualWorkspaceId: string
	) {
		super('Publication does not belong to the requested Workspace');
		this.name = 'PublicationWorkspaceMismatchError';
	}
}

export async function loadPublicationForWorkspace(
	loader: PublicationLoader,
	options: PublicationLoadOptions
): Promise<Publication> {
	const publication = await loader(
		options.publicationId,
		options.workspaceId,
		options.force ?? false
	);
	if (publication.workspace_id !== options.workspaceId) {
		const error = new PublicationWorkspaceMismatchError(
			options.workspaceId,
			publication.workspace_id
		);
		await options.onWorkspaceMismatch?.(error);
		throw error;
	}
	return publication;
}
