import type { components } from '$lib/api/types';

type CreatePublication = components['schemas']['CreatePublicationBody'];
type ValidationIssue = components['schemas']['ValidationIssue'];
type PublicationAction = components['schemas']['ActionOutputBody'];
type DeliveryOutcome = components['schemas']['RenditionActionOutcome'];

export type PublicationDraft = Omit<CreatePublication, 'workspace_id'>;

export interface ComposerPublication {
	id: string;
	workspace_id: string;
	revision: number;
	status: string;
	/** The server-normalized draft returned when a new Publication is created. */
	draft?: PublicationDraft;
}

export interface ComposerPublicationClient {
	load(publicationId: string): Promise<{
		publication: ComposerPublication;
		draft: PublicationDraft;
	}>;
	create(workspaceId: string, draft: PublicationDraft): Promise<ComposerPublication>;
	update(
		publicationId: string,
		expectedRevision: number,
		draft: PublicationDraft
	): Promise<ComposerPublication>;
	validate(publicationId: string): Promise<{ issues: ValidationIssue[] }>;
	schedule(publicationId: string, expectedRevision: number): Promise<PublicationAction>;
	publishNow(publicationId: string, expectedRevision: number): Promise<PublicationAction>;
	retry(publicationId: string, accountId: string, targetKey?: string): Promise<PublicationAction>;
	cancel(publicationId: string, expectedRevision: number): Promise<PublicationAction>;
	delete(publicationId: string, expectedRevision: number): Promise<void>;
}

export interface ComposerEditorHandoffBinding {
	workspaceId: string;
	publicationId: string;
	revision: number;
	returnToken: string;
}

export type ComposerClientErrorCategory =
	| 'invalid'
	| 'access_denied'
	| 'not_found'
	| 'conflict'
	| 'invalid_state'
	| 'not_ready'
	| 'unavailable';

export const composerErrorCodes = [
	'publication_request_failed',
	'publication_workspace_mismatch',
	'session_content_missing',
	'revision_conflict_unresolved',
	'editor_return_token_required',
	'editor_return_token_mismatch',
	'editor_requires_saved_publication',
	'editor_return_already_used',
	'editor_return_workspace_mismatch',
	'editor_return_publication_mismatch',
	'editor_return_revision_invalid',
	'revision_conflict_missing',
	'session_reset_pending_save',
	'session_inactive',
	'publication_revision_missing',
	'session_request_failed',
	'image_editor_return_inactive',
	'image_editor_return_workspace_mismatch',
	'editor_origin_segment_missing'
] as const;

export type ComposerErrorCode = (typeof composerErrorCodes)[number];

export class ComposerSessionError extends Error {
	constructor(readonly code: ComposerErrorCode) {
		super(code);
		this.name = 'ComposerSessionError';
	}
}

export class ComposerClientError extends Error {
	constructor(
		readonly category: ComposerClientErrorCategory,
		message: string,
		readonly currentRevision?: number,
		readonly presentationCode: ComposerErrorCode = 'publication_request_failed'
	) {
		super(message);
		this.name = 'ComposerClientError';
	}
}

export type ComposerSessionPhase =
	| 'idle'
	| 'loading'
	| 'saving'
	| 'validating'
	| 'scheduling'
	| 'publishing'
	| 'retrying'
	| 'cancelling'
	| 'deleting';

export type ComposerWorkspaceSwitchIntent = 'save' | 'discard' | 'stay';

export interface ComposerWorkspaceSwitchAdapters {
	save(): Promise<{ ok: boolean; error?: string }>;
	discard(): void;
	invalidate(): void;
	resume(): void;
}

export interface ComposerWorkspaceSwitchRequest {
	fromWorkspaceId: string;
	toWorkspaceId: string;
	toWorkspaceName: string;
	dirty: boolean;
	adapters: ComposerWorkspaceSwitchAdapters;
}

function mergeServerAssignedDraftIdentity(
	current: PublicationDraft,
	created: PublicationDraft
): PublicationDraft {
	const merged = structuredClone(current);
	const serverSegments = created.segments ?? [];
	merged.segments = (merged.segments ?? []).map((segment, index) => {
		const serverSegment = serverSegments[index];
		return serverSegment?.id ? { ...segment, id: serverSegment.id } : segment;
	});

	const serverRenditions = created.renditions ?? [];
	merged.renditions = (merged.renditions ?? []).map((rendition, index) => {
		const serverRendition =
			serverRenditions.find(
				(candidate) =>
					candidate.social_account_id === rendition.social_account_id &&
					candidate.target_key === rendition.target_key
			) ?? serverRenditions[index];
		if (!serverRendition) return rendition;

		const serverRenditionSegments = serverRendition.segments ?? [];
		return {
			...rendition,
			id: serverRendition.id ?? rendition.id,
			segments: (rendition.segments ?? []).map((segment, segmentIndex) => {
				const serverSegment = serverRenditionSegments[segmentIndex];
				return serverSegment?.id
					? {
							...segment,
							id: serverSegment.id,
							publication_segment_id:
								serverSegment.publication_segment_id ?? segment.publication_segment_id
						}
					: segment;
			})
		};
	});

	return merged;
}

export interface ComposerWorkspaceSwitchState {
	toWorkspaceId: string;
	toWorkspaceName: string;
	intent: Exclude<ComposerWorkspaceSwitchIntent, 'stay'> | null;
	error: string | null;
}

export interface ComposerSessionSnapshot {
	workspaceId: string;
	publicationId: string | null;
	revision: number | null;
	status: string | null;
	phase: ComposerSessionPhase;
	dirty: boolean;
	conflict: { expectedRevision: number; currentRevision: number } | null;
	validationIssues: ValidationIssue[];
	delivery: DeliveryOutcome[];
	error: string | null;
	workspaceSwitch: ComposerWorkspaceSwitchState | null;
}

export class ComposerSession {
	readonly workspaceId: string;
	readonly #client: ComposerPublicationClient;
	#draft: PublicationDraft | null = null;
	#draftVersion = 0;
	#saveTail: Promise<void> = Promise.resolve();
	#pendingSaves = 0;
	#active = true;
	#generation = 0;
	#pendingWorkspaceSwitch: {
		resolve: (allowed: boolean) => void;
		adapters: ComposerWorkspaceSwitchAdapters;
	} | null = null;
	#consumedEditorReturnTokens = new Set<string>();
	#snapshot: ComposerSessionSnapshot;
	#listeners = new Set<(snapshot: Readonly<ComposerSessionSnapshot>) => void>();

	constructor(options: { workspaceId: string; client: ComposerPublicationClient }) {
		this.workspaceId = options.workspaceId;
		this.#client = options.client;
		this.#snapshot = {
			workspaceId: options.workspaceId,
			publicationId: null,
			revision: null,
			status: null,
			phase: 'idle',
			dirty: false,
			conflict: null,
			validationIssues: [],
			delivery: [],
			error: null,
			workspaceSwitch: null
		};
	}

	get snapshot(): Readonly<ComposerSessionSnapshot> {
		return structuredClone(this.#snapshot);
	}

	get draft(): Readonly<PublicationDraft> | null {
		return this.#draft ? structuredClone(this.#draft) : null;
	}

	subscribe(listener: (snapshot: Readonly<ComposerSessionSnapshot>) => void): () => void {
		this.#listeners.add(listener);
		listener(this.snapshot);
		return () => this.#listeners.delete(listener);
	}

	async load(publicationId: string): Promise<void> {
		this.#requireActive();
		const generation = this.#generation;
		this.#patch({ phase: 'loading', error: null });
		try {
			const loaded = await this.#client.load(publicationId);
			if (generation !== this.#generation) return;
			if (loaded.publication.workspace_id !== this.workspaceId) {
				throw new ComposerSessionError('publication_workspace_mismatch');
			}
			this.#draft = structuredClone(loaded.draft);
			this.#draftVersion += 1;
			this.#patch({
				publicationId: loaded.publication.id,
				revision: loaded.publication.revision,
				status: loaded.publication.status,
				dirty: false,
				conflict: null,
				validationIssues: [],
				delivery: [],
				error: null
			});
		} catch (cause) {
			if (generation === this.#generation) this.#patch({ error: errorMessage(cause) });
			throw cause;
		} finally {
			if (generation === this.#generation) this.#patch({ phase: 'idle' });
		}
	}

	edit(draft: PublicationDraft): void {
		this.#requireActive();
		this.#draft = structuredClone(
			this.#snapshot.publicationId && this.#draft
				? mergeServerAssignedDraftIdentity(draft, this.#draft)
				: draft
		);
		this.#draftVersion += 1;
		this.#patch({ dirty: true, error: null });
	}

	async save(): Promise<ComposerPublication> {
		this.#requireActive();
		if (!this.#draft) throw new ComposerSessionError('session_content_missing');
		if (this.#snapshot.conflict) {
			throw new ComposerClientError(
				'conflict',
				this.#snapshot.error || 'revision_conflict_unresolved',
				this.#snapshot.conflict.currentRevision
			);
		}
		const draft = structuredClone(this.#draft);
		const draftVersion = this.#draftVersion;
		this.#pendingSaves += 1;
		this.#patch({ phase: 'saving', error: null });
		const generation = this.#generation;
		const run = this.#saveTail.then(() => this.#persist(draft, draftVersion, generation));
		this.#saveTail = run.then(
			() => undefined,
			() => undefined
		);
		return run;
	}

	async flush(): Promise<void> {
		await this.#saveTail;
	}

	requestWorkspaceSwitch(request: ComposerWorkspaceSwitchRequest): Promise<boolean> {
		if (!this.#active || request.fromWorkspaceId !== this.workspaceId)
			return Promise.resolve(false);
		if (request.toWorkspaceId === this.workspaceId) return Promise.resolve(true);
		if (this.#pendingWorkspaceSwitch) return Promise.resolve(false);
		if (!request.dirty) {
			request.adapters.invalidate();
			this.#deactivate();
			return Promise.resolve(true);
		}

		this.#patch({
			workspaceSwitch: {
				toWorkspaceId: request.toWorkspaceId,
				toWorkspaceName: request.toWorkspaceName,
				intent: null,
				error: null
			}
		});
		return new Promise<boolean>((resolve) => {
			this.#pendingWorkspaceSwitch = { resolve, adapters: request.adapters };
		});
	}

	async decideWorkspaceSwitch(intent: ComposerWorkspaceSwitchIntent): Promise<void> {
		const pending = this.#pendingWorkspaceSwitch;
		const state = this.#snapshot.workspaceSwitch;
		if (!pending || !state || state.intent) return;

		if (intent === 'stay') {
			this.#pendingWorkspaceSwitch = null;
			this.#patch({ workspaceSwitch: null });
			pending.adapters.resume();
			pending.resolve(false);
			return;
		}

		this.#patch({ workspaceSwitch: { ...state, intent, error: null } });
		if (intent === 'discard') {
			pending.adapters.discard();
			this.#allowWorkspaceSwitch(pending);
			return;
		}

		try {
			await this.flush();
			const result = await pending.adapters.save();
			await this.flush();
			if (!result.ok) {
				this.#patch({
					workspaceSwitch: {
						...state,
						intent: null,
						error: result.error || 'session_request_failed'
					}
				});
				return;
			}
			this.#allowWorkspaceSwitch(pending);
		} catch (cause) {
			this.#patch({ workspaceSwitch: { ...state, intent: null, error: errorMessage(cause) } });
		}
	}

	bindEditorHandoff(returnToken: string): ComposerEditorHandoffBinding {
		if (!returnToken.trim()) throw new ComposerSessionError('editor_return_token_required');
		if (!this.#snapshot.publicationId || this.#snapshot.revision === null) {
			throw new ComposerSessionError('editor_requires_saved_publication');
		}
		return {
			workspaceId: this.workspaceId,
			publicationId: this.#snapshot.publicationId,
			revision: this.#snapshot.revision,
			returnToken
		};
	}

	acceptEditorHandoff(binding: ComposerEditorHandoffBinding): ComposerEditorHandoffBinding {
		if (!binding.returnToken.trim()) {
			throw new ComposerSessionError('editor_return_token_required');
		}
		if (this.#consumedEditorReturnTokens.has(binding.returnToken)) {
			throw new ComposerSessionError('editor_return_already_used');
		}
		if (binding.workspaceId !== this.workspaceId) {
			throw new ComposerSessionError('editor_return_workspace_mismatch');
		}
		if (!this.#snapshot.publicationId || binding.publicationId !== this.#snapshot.publicationId) {
			throw new ComposerSessionError('editor_return_publication_mismatch');
		}
		if (!Number.isInteger(binding.revision) || binding.revision < 1) {
			throw new ComposerSessionError('editor_return_revision_invalid');
		}
		this.#consumedEditorReturnTokens.add(binding.returnToken);
		this.#patch({ revision: binding.revision, conflict: null, error: null });
		return { ...binding };
	}

	async overwriteConflict(): Promise<ComposerPublication> {
		if (!this.#snapshot.conflict) {
			throw new ComposerSessionError('revision_conflict_missing');
		}
		this.#patch({
			revision: this.#snapshot.conflict.currentRevision,
			conflict: null,
			error: null
		});
		return this.save();
	}

	async validate(): Promise<ValidationIssue[]> {
		this.#requireActive();
		const generation = this.#generation;
		const publication = await this.#ensureSaved();
		this.#requireGeneration(generation);
		this.#patch({ phase: 'validating', error: null });
		try {
			const result = await this.#client.validate(publication.id);
			if (generation === this.#generation) this.#patch({ validationIssues: result.issues });
			return result.issues;
		} catch (cause) {
			if (generation === this.#generation) this.#patch({ error: errorMessage(cause) });
			throw cause;
		} finally {
			if (generation === this.#generation) this.#patch({ phase: 'idle' });
		}
	}

	async schedule(): Promise<PublicationAction> {
		this.#requireActive();
		const generation = this.#generation;
		const publication = await this.#ensureSaved();
		await this.#validateForDelivery();
		this.#requireGeneration(generation);
		this.#patch({ phase: 'scheduling', error: null });
		try {
			const action = await this.#client.schedule(publication.id, this.#requiredRevision());
			this.#applyAction(action, 'scheduled', generation);
			return action;
		} catch (cause) {
			if (generation === this.#generation) this.#captureClientError(cause);
			throw cause;
		} finally {
			if (generation === this.#generation) this.#patch({ phase: 'idle' });
		}
	}

	async publishNow(): Promise<PublicationAction> {
		this.#requireActive();
		const generation = this.#generation;
		const publication = await this.#ensureSaved();
		await this.#validateForDelivery();
		this.#requireGeneration(generation);
		this.#patch({ phase: 'publishing', error: null });
		try {
			const action = await this.#client.publishNow(publication.id, this.#requiredRevision());
			this.#applyAction(action, 'publishing', generation);
			return action;
		} catch (cause) {
			if (generation === this.#generation) this.#captureClientError(cause);
			throw cause;
		} finally {
			if (generation === this.#generation) this.#patch({ phase: 'idle' });
		}
	}

	async retry(accountId: string, targetKey?: string): Promise<PublicationAction> {
		this.#requireActive();
		const generation = this.#generation;
		const publication = await this.#ensureSaved();
		this.#requireGeneration(generation);
		this.#patch({ phase: 'retrying', error: null });
		try {
			const action = await this.#client.retry(publication.id, accountId, targetKey);
			this.#applyAction(action, this.#snapshot.status ?? 'publishing', generation);
			return action;
		} catch (cause) {
			if (generation === this.#generation) this.#captureClientError(cause);
			throw cause;
		} finally {
			if (generation === this.#generation) this.#patch({ phase: 'idle' });
		}
	}

	async cancel(): Promise<PublicationAction> {
		this.#requireActive();
		const generation = this.#generation;
		const publication = await this.#ensureSaved();
		this.#requireGeneration(generation);
		this.#patch({ phase: 'cancelling', error: null });
		try {
			const action = await this.#client.cancel(publication.id, this.#requiredRevision());
			this.#applyAction(action, 'draft', generation);
			return action;
		} catch (cause) {
			if (generation === this.#generation) this.#captureClientError(cause);
			throw cause;
		} finally {
			if (generation === this.#generation) this.#patch({ phase: 'idle' });
		}
	}

	async delete(): Promise<void> {
		this.#requireActive();
		const generation = this.#generation;
		const publication = await this.#ensureSaved();
		this.#requireGeneration(generation);
		this.#patch({ phase: 'deleting', error: null });
		try {
			await this.#client.delete(publication.id, this.#requiredRevision());
			if (generation !== this.#generation) return;
			this.#draft = null;
			this.#draftVersion += 1;
			this.#patch({
				publicationId: null,
				revision: null,
				status: 'deleted',
				dirty: false,
				conflict: null,
				validationIssues: [],
				delivery: []
			});
		} catch (cause) {
			if (generation === this.#generation) this.#captureClientError(cause);
			throw cause;
		} finally {
			if (generation === this.#generation) this.#patch({ phase: 'idle' });
		}
	}

	reset(): void {
		this.#requireActive();
		if (this.#pendingSaves > 0) {
			throw new ComposerSessionError('session_reset_pending_save');
		}
		this.#draft = null;
		this.#draftVersion += 1;
		this.#snapshot = {
			workspaceId: this.workspaceId,
			publicationId: null,
			revision: null,
			status: null,
			phase: 'idle',
			dirty: false,
			conflict: null,
			validationIssues: [],
			delivery: [],
			error: null,
			workspaceSwitch: null
		};
		this.#notify();
	}

	async #persist(
		draft: PublicationDraft,
		draftVersion: number,
		generation: number
	): Promise<ComposerPublication> {
		try {
			const publicationID = this.#snapshot.publicationId;
			const revision = this.#snapshot.revision;
			const creating = !publicationID || revision === null;
			let publication: ComposerPublication;
			if (creating) {
				publication = await this.#client.create(this.workspaceId, draft);
			} else {
				publication = await this.#client.update(publicationID, revision, draft);
			}
			if (creating && publication.draft && generation === this.#generation) {
				this.#draft =
					this.#draftVersion === draftVersion
						? structuredClone(publication.draft)
						: mergeServerAssignedDraftIdentity(this.#draft ?? draft, publication.draft);
			}
			if (generation === this.#generation) {
				this.#patch({
					publicationId: publication.id,
					revision: publication.revision,
					status: publication.status,
					dirty: this.#draftVersion !== draftVersion,
					conflict: null,
					error: null
				});
			}
			return publication;
		} catch (cause) {
			if (generation === this.#generation) this.#captureClientError(cause, { dirty: true });
			throw cause;
		} finally {
			this.#pendingSaves -= 1;
			if (this.#pendingSaves === 0 && generation === this.#generation)
				this.#patch({ phase: 'idle' });
		}
	}

	#allowWorkspaceSwitch(pending: {
		resolve: (allowed: boolean) => void;
		adapters: ComposerWorkspaceSwitchAdapters;
	}): void {
		if (this.#pendingWorkspaceSwitch !== pending) return;
		pending.adapters.invalidate();
		this.#deactivate();
		this.#pendingWorkspaceSwitch = null;
		this.#patch({ workspaceSwitch: null });
		pending.resolve(true);
	}

	#deactivate(): void {
		this.#active = false;
		this.#generation += 1;
	}

	#requireActive(): void {
		if (!this.#active) throw new ComposerSessionError('session_inactive');
	}

	#requireGeneration(generation: number): void {
		if (generation !== this.#generation) throw new ComposerSessionError('session_inactive');
	}

	async #ensureSaved(): Promise<ComposerPublication> {
		if (this.#snapshot.dirty || !this.#snapshot.publicationId) return this.save();
		return {
			id: this.#snapshot.publicationId,
			workspace_id: this.workspaceId,
			revision: this.#requiredRevision(),
			status: this.#snapshot.status ?? 'draft'
		};
	}

	async #validateForDelivery(): Promise<void> {
		const issues = await this.validate();
		this.#requireActive();
		const blocker = issues.find((issue) => issue.severity === 'error');
		if (!blocker) return;
		const failure = new ComposerClientError(
			'not_ready',
			blocker.message || blocker.fallback_message
		);
		this.#patch({ error: failure.message });
		throw failure;
	}

	#requiredRevision(): number {
		if (this.#snapshot.revision === null) {
			throw new ComposerSessionError('publication_revision_missing');
		}
		return this.#snapshot.revision;
	}

	#applyAction(action: PublicationAction, status: string, generation = this.#generation): void {
		if (generation !== this.#generation) return;
		this.#patch({
			status,
			revision: action.revision ?? this.#snapshot.revision,
			delivery: action.renditions ?? [],
			error: null,
			conflict: null
		});
	}

	#captureClientError(cause: unknown, extra: Partial<ComposerSessionSnapshot> = {}): void {
		const patch: Partial<ComposerSessionSnapshot> = {
			...extra,
			error: errorMessage(cause)
		};
		if (
			cause instanceof ComposerClientError &&
			cause.category === 'conflict' &&
			this.#snapshot.revision !== null &&
			cause.currentRevision !== undefined
		) {
			patch.conflict = {
				expectedRevision: this.#snapshot.revision,
				currentRevision: cause.currentRevision
			};
		}
		this.#patch(patch);
	}

	#patch(patch: Partial<ComposerSessionSnapshot>): void {
		this.#snapshot = { ...this.#snapshot, ...patch };
		this.#notify();
	}

	#notify(): void {
		const snapshot = this.snapshot;
		for (const listener of this.#listeners) listener(snapshot);
	}
}

function errorMessage(cause: unknown): string {
	if (cause instanceof ComposerClientError) {
		return cause.message.trim() || cause.presentationCode;
	}
	if (cause instanceof ComposerSessionError) return cause.code;
	return cause instanceof Error && cause.message.trim() ? cause.message : 'session_request_failed';
}
