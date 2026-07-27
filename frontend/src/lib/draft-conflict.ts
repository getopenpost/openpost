export interface DraftConflictMetadata {
	aggregate_type: 'publication' | 'text_post';
	aggregate_id: string;
	expected_revision: number;
	current_revision: number;
	status: string;
	title?: string;
	updated_at?: string;
	changed_by_name?: string;
	changed_domains: string[];
}

export interface DraftConflictProblem {
	code: 'draft_revision_conflict';
	detail: string;
	conflict: DraftConflictMetadata;
}

export function parseDraftConflict(value: unknown): DraftConflictProblem | null {
	if (!value || typeof value !== 'object') return null;
	const problem = value as Partial<DraftConflictProblem>;
	if (problem.code !== 'draft_revision_conflict' || !problem.conflict) return null;
	if (
		typeof problem.conflict.current_revision !== 'number' ||
		typeof problem.conflict.aggregate_id !== 'string'
	) {
		return null;
	}
	return {
		code: 'draft_revision_conflict',
		detail:
			typeof problem.detail === 'string'
				? problem.detail
				: 'This draft changed after the editor loaded it.',
		conflict: {
			...problem.conflict,
			changed_domains: Array.isArray(problem.conflict.changed_domains)
				? problem.conflict.changed_domains.filter(
						(domain): domain is string => typeof domain === 'string'
					)
				: []
		}
	} as DraftConflictProblem;
}
