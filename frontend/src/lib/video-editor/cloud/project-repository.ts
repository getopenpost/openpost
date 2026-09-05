import {
	portableVideoProjectDocument,
	VideoProjectMutationOutbox,
	type MutationOutboxStorage,
	type PendingVideoProjectMutation,
	type PortableVideoProjectDocument,
	type VideoProjectMutationOperation
} from '@openpost/video-project';
import { browser } from '$app/environment';
import { client } from '$lib/api/client';

const OUTBOX_DATABASE = 'openpost-video-project-sync';
const OUTBOX_STORE = 'state';
const OUTBOX_KEY = 'mutation-outbox-v1';
const DEVICE_KEY = 'openpost:video-project-device-id:v1';

export function purgeCloudVideoProjectDeviceData(): void {
	if (!browser) return;
	localStorage.removeItem(DEVICE_KEY);
	indexedDB.deleteDatabase(OUTBOX_DATABASE);
}

export interface CloudVideoProject<TDocument extends PortableVideoProjectDocument> {
	id: string;
	workspaceId: string;
	name: string;
	headRevision: number;
	document: TDocument;
	syncStatus: 'pending' | 'uploading' | 'saving' | 'synced' | 'needs_attention';
	attentionReason: string;
	updatedAt: string;
}

class BrowserMutationStorage implements MutationOutboxStorage {
	async load(): Promise<PendingVideoProjectMutation[]> {
		if (!browser) return [];
		const database = await openOutboxDatabase();
		return new Promise((resolve, reject) => {
			const request = database.transaction(OUTBOX_STORE).objectStore(OUTBOX_STORE).get(OUTBOX_KEY);
			request.onsuccess = () =>
				resolve((request.result as PendingVideoProjectMutation[] | undefined) ?? []);
			request.onerror = () =>
				reject(request.error ?? new Error('Could not read the Video Project outbox'));
		});
	}

	async save(entries: PendingVideoProjectMutation[]): Promise<void> {
		if (!browser) return;
		const database = await openOutboxDatabase();
		await new Promise<void>((resolve, reject) => {
			const transaction = database.transaction(OUTBOX_STORE, 'readwrite');
			transaction.objectStore(OUTBOX_STORE).put(entries, OUTBOX_KEY);
			transaction.oncomplete = () => resolve();
			transaction.onerror = () =>
				reject(transaction.error ?? new Error('Could not save the Video Project outbox'));
		});
	}
}

function openOutboxDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(OUTBOX_DATABASE, 1);
		request.onupgradeneeded = () => request.result.createObjectStore(OUTBOX_STORE);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () =>
			reject(request.error ?? new Error('Could not open Video Project sync storage'));
	});
}

function deviceId(): string {
	if (!browser) return 'web';
	const current = localStorage.getItem(DEVICE_KEY);
	if (current) return current;
	const created = crypto.randomUUID();
	localStorage.setItem(DEVICE_KEY, created);
	return created;
}

function cloudProject<TDocument extends PortableVideoProjectDocument>(raw: {
	id: string;
	workspace_id: string;
	name: string;
	head_revision: number;
	document: Record<string, unknown>;
	sync_status: CloudVideoProject<TDocument>['syncStatus'];
	attention_reason?: string;
	updated_at: string;
}): CloudVideoProject<TDocument> {
	return {
		id: raw.id,
		workspaceId: raw.workspace_id,
		name: raw.name,
		headRevision: raw.head_revision,
		document: raw.document as TDocument,
		syncStatus: raw.sync_status,
		attentionReason: raw.attention_reason ?? '',
		updatedAt: raw.updated_at
	};
}

export class CloudVideoProjectRepository<TDocument extends PortableVideoProjectDocument> {
	readonly outbox = new VideoProjectMutationOutbox(new BrowserMutationStorage());

	constructor(readonly workspaceId: string) {}

	async list(includeTrash = false): Promise<CloudVideoProject<TDocument>[]> {
		const { data, error } = await client.GET('/video-projects', {
			params: { query: { workspace_id: this.workspaceId, include_trash: includeTrash } }
		});
		if (error || !data) throw new Error('Could not load Cloud Video Projects');
		return data.map((project) => cloudProject<TDocument>(project));
	}

	async get(id: string): Promise<CloudVideoProject<TDocument>> {
		const { data, error } = await client.GET('/video-projects/{id}', {
			params: { path: { id }, query: { workspace_id: this.workspaceId } }
		});
		if (error || !data) throw new Error('Could not load Cloud Video Project');
		return cloudProject<TDocument>(data);
	}

	async create(name: string, document: TDocument): Promise<CloudVideoProject<TDocument>> {
		const portable = portableVideoProjectDocument(document);
		const { data, error } = await client.POST('/video-projects', {
			body: { workspace_id: this.workspaceId, name, device_id: deviceId(), document: portable }
		});
		if (error || !data) throw new Error('Could not create Cloud Video Project');
		return cloudProject<TDocument>(data);
	}

	async save(project: CloudVideoProject<TDocument>, document: TDocument): Promise<void> {
		const portable = portableVideoProjectDocument(document);
		const operations = Object.entries(portable).map(([key, value]) => ({
			kind: 'set' as const,
			target: key === 'timeline' ? 'project:timeline' : `project:${key}`,
			path: `/${key}` as `/${string}`,
			value
		})) satisfies VideoProjectMutationOperation[];
		await this.outbox.enqueue({
			projectId: project.id,
			batch: {
				workspace_id: this.workspaceId,
				mutation_id: crypto.randomUUID(),
				base_revision: project.headRevision,
				device_id: deviceId(),
				operations
			},
			queuedAt: Date.now(),
			attempts: 0
		});
		const results = await this.flush();
		const latest = results.at(-1);
		if (latest) project.headRevision = latest.revision;
		project.document = portable;
	}

	async flush() {
		return this.outbox.drain(async (entry) => {
			const { data, error } = await client.POST('/video-projects/{id}/mutations', {
				params: { path: { id: entry.projectId } },
				body: entry.batch
			});
			if (error || !data) throw new Error('Cloud Video Project save is waiting for a connection');
			return data.outcome === 'conflict'
				? {
						outcome: 'conflict' as const,
						revision: data.revision,
						conflictId: data.conflict_id ?? ''
					}
				: { outcome: 'applied' as const, revision: data.revision };
		});
	}

	async trash(id: string): Promise<void> {
		const { error } = await client.POST('/video-projects/{id}/trash', {
			params: { path: { id } },
			body: { workspace_id: this.workspaceId }
		});
		if (error) throw new Error('Could not move Cloud Video Project to Trash');
	}

	async restore(id: string): Promise<void> {
		const { error } = await client.POST('/video-projects/{id}/restore', {
			params: { path: { id } },
			body: { workspace_id: this.workspaceId }
		});
		if (error) throw new Error('Could not restore Cloud Video Project');
	}
}
