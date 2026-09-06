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

type DraftConflictField =
	| string
	| number
	| boolean
	| null
	| DraftConflictField[]
	| { [key: string]: DraftConflictField }
	| undefined;

interface DraftConflictInput {
	code?: DraftConflictField;
	detail?: DraftConflictField;
	conflict?: DraftConflictField;
}

interface DraftConflictMetadataInput {
	aggregate_type?: DraftConflictField;
	aggregate_id?: DraftConflictField;
	expected_revision?: DraftConflictField;
	current_revision?: DraftConflictField;
	status?: DraftConflictField;
	title?: DraftConflictField;
	updated_at?: DraftConflictField;
	changed_by_name?: DraftConflictField;
	changed_domains?: DraftConflictField;
}

function stringField(value: DraftConflictField): string | undefined {
	return String(value) === value ? String(value) : undefined;
}

export function parseDraftConflict(value: unknown): DraftConflictProblem | null {
	if (!value || Object(value) !== value || Array.isArray(value)) return null;
	// SAFETY: The checks above establish the object boundary; every field is validated below.
	const problem = value as DraftConflictInput;
	if (problem.code !== 'draft_revision_conflict') return null;
	if (!problem.conflict || Object(problem.conflict) !== problem.conflict) return null;
	// SAFETY: The conflict member is a non-null object and each returned field is checked below.
	const conflict = problem.conflict as DraftConflictMetadataInput;
	const aggregateID = stringField(conflict.aggregate_id);
	const status = stringField(conflict.status);
	if (
		(conflict.aggregate_type !== 'publication' && conflict.aggregate_type !== 'text_post') ||
		!aggregateID ||
		!Number.isFinite(conflict.expected_revision) ||
		!Number.isFinite(conflict.current_revision) ||
		!status
	) {
		return null;
	}
	const changedDomains = Array.isArray(conflict.changed_domains)
		? conflict.changed_domains
				.map(stringField)
				.filter((domain): domain is string => domain !== undefined)
		: [];
	const metadata: DraftConflictMetadata = {
		aggregate_type: conflict.aggregate_type,
		aggregate_id: aggregateID,
		expected_revision: Number(conflict.expected_revision),
		current_revision: Number(conflict.current_revision),
		status,
		changed_domains: changedDomains
	};
	const title = stringField(conflict.title);
	const updatedAt = stringField(conflict.updated_at);
	const changedByName = stringField(conflict.changed_by_name);
	if (title !== undefined) metadata.title = title;
	if (updatedAt !== undefined) metadata.updated_at = updatedAt;
	if (changedByName !== undefined) metadata.changed_by_name = changedByName;
	return {
		code: 'draft_revision_conflict',
		detail: stringField(problem.detail) ?? 'This draft changed after the editor loaded it.',
		conflict: metadata
	};
}
