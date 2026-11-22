import type { MediaMetadata } from '@openpost/editor-shared/media';

export interface CloudVideoProject<TDocument extends object> {
	id: string;
	workspaceId: string;
	name: string;
	headRevision: number;
	document: TDocument;
	syncStatus: 'pending' | 'uploading' | 'saving' | 'synced' | 'needs_attention';
	attentionReason: string;
	trashedAt: string;
	updatedAt: string;
}

export interface CloudVideoProjectOfflineReader<TDocument extends object> {
	readonly workspaceId: string;
	get(projectId: string): Promise<CloudVideoProject<TDocument>>;
	listMedia(projectId: string): Promise<MediaMetadata[]>;
}
