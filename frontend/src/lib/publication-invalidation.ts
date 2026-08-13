export type PublicationRefreshScope = 'activity' | 'calendar' | 'drafts';

export interface PublicationInvalidationRequest {
	workspaceId?: string;
	scopes?: readonly PublicationRefreshScope[];
	dateKeys?: readonly string[];
}

export interface PublicationInvalidationEntry {
	workspaceId: string;
	scopes: PublicationRefreshScope[];
	dateKeys: string[];
}

export interface PublicationInvalidationBatch {
	revision: number;
	entries: PublicationInvalidationEntry[];
}

const allScopes: readonly PublicationRefreshScope[] = ['activity', 'calendar', 'drafts'];

type PendingInvalidation = {
	scopes: Set<PublicationRefreshScope>;
	dateKeys: Set<string>;
};

/**
 * Collects publication invalidations without making a reactive store depend on
 * request frequency. The UI store decides when to drain the batch, so rapid
 * autosaves collapse into one bounded refresh.
 */
export class PublicationInvalidationCoalescer {
	readonly #pending = new Map<string, PendingInvalidation>();

	add(request: PublicationInvalidationRequest = {}) {
		const workspaceId = request.workspaceId?.trim() || '*';
		const pending = this.#pending.get(workspaceId) ?? {
			scopes: new Set<PublicationRefreshScope>(),
			dateKeys: new Set<string>()
		};
		for (const scope of request.scopes?.length ? request.scopes : allScopes) {
			pending.scopes.add(scope);
		}
		for (const dateKey of request.dateKeys ?? []) {
			const normalized = dateKey.trim();
			if (normalized) pending.dateKeys.add(normalized);
		}
		this.#pending.set(workspaceId, pending);
	}

	drain(revision: number): PublicationInvalidationBatch | null {
		if (this.#pending.size === 0) return null;
		const entries = [...this.#pending.entries()]
			.map(([workspaceId, pending]): PublicationInvalidationEntry => ({
				workspaceId,
				scopes: [...pending.scopes].sort(),
				dateKeys: [...pending.dateKeys].sort()
			}))
			.sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
		this.#pending.clear();
		return { revision, entries };
	}
}

export function publicationInvalidationForWorkspace(
	batch: PublicationInvalidationBatch,
	workspaceId: string
): PublicationInvalidationEntry | null {
	const matching = batch.entries.filter(
		(entry) => entry.workspaceId === '*' || entry.workspaceId === workspaceId
	);
	if (matching.length === 0) return null;
	return {
		workspaceId,
		scopes: [...new Set(matching.flatMap((entry) => entry.scopes))].sort(),
		dateKeys: [...new Set(matching.flatMap((entry) => entry.dateKeys))].sort()
	};
}
