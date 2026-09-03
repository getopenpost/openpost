import type { ActivityPublicationBucket } from '@openpost/query-catalog';

export type PublicationRefreshScope = 'activity' | 'calendar' | 'drafts';

/**
 * Maps a publication status to its activity bucket for exact invalidation.
 * Prefers over-inclusion (extra refetch) over under-inclusion (stale UI).
 */
export function activityBucketForStatus(
	status: string,
	scheduledAt?: string
): ActivityPublicationBucket {
	switch (status) {
		case 'published':
			return 'published';
		case 'failed':
			return 'failed';
		case 'scheduled':
		case 'publishing':
			return 'scheduled';
		case 'ready':
			return scheduledAt ? 'scheduled' : 'draft';
		default:
			return 'draft';
	}
}

export interface PublicationInvalidationRequest {
	workspaceId?: string;
	scopes?: readonly PublicationRefreshScope[];
	dateKeys?: readonly string[];
	/**
	 * Exact activity buckets (old+new) for moves. Absent means the entry
	 * keeps the coarse whole-workspace activity behavior.
	 */
	activities?: readonly ActivityPublicationBucket[];
}

export interface PublicationInvalidationEntry {
	workspaceId: string;
	scopes: PublicationRefreshScope[];
	dateKeys: string[];
	activities: ActivityPublicationBucket[];
}

export interface PublicationInvalidationBatch {
	revision: number;
	entries: PublicationInvalidationEntry[];
}

const allScopes: readonly PublicationRefreshScope[] = ['activity', 'calendar', 'drafts'];

type PendingInvalidation = {
	scopes: Set<PublicationRefreshScope>;
	dateKeys: Set<string>;
	activities: Set<ActivityPublicationBucket>;
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
			dateKeys: new Set<string>(),
			activities: new Set<ActivityPublicationBucket>()
		};
		for (const scope of request.scopes?.length ? request.scopes : allScopes) {
			pending.scopes.add(scope);
		}
		for (const dateKey of request.dateKeys ?? []) {
			const normalized = dateKey.trim();
			if (normalized) pending.dateKeys.add(normalized);
		}
		for (const activity of request.activities ?? []) {
			pending.activities.add(activity);
		}
		this.#pending.set(workspaceId, pending);
	}

	drain(revision: number): PublicationInvalidationBatch | null {
		if (this.#pending.size === 0) return null;
		const entries = [...this.#pending.entries()]
			.map(
				([workspaceId, pending]): PublicationInvalidationEntry => ({
					workspaceId,
					scopes: [...pending.scopes].sort(),
					dateKeys: [...pending.dateKeys].sort(),
					activities: [...pending.activities].sort()
				})
			)
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
		dateKeys: [...new Set(matching.flatMap((entry) => entry.dateKeys))].sort(),
		activities: [...new Set(matching.flatMap((entry) => entry.activities))].sort()
	};
}
