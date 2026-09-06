import { describe, expect, it } from 'vitest';
import { parseDraftConflict } from './draft-conflict';

describe('parseDraftConflict', () => {
	it('accepts the stable 409 contract and keeps only safe changed-domain labels', () => {
		expect(
			parseDraftConflict({
				code: 'draft_revision_conflict',
				detail: 'Draft changed elsewhere',
				conflict: {
					aggregate_type: 'publication',
					aggregate_id: 'publication-1',
					expected_revision: 3,
					current_revision: 5,
					status: 'draft',
					changed_domains: ['content', 42, 'media']
				}
			})
		).toEqual({
			code: 'draft_revision_conflict',
			detail: 'Draft changed elsewhere',
			conflict: {
				aggregate_type: 'publication',
				aggregate_id: 'publication-1',
				expected_revision: 3,
				current_revision: 5,
				status: 'draft',
				changed_domains: ['content', 'media']
			}
		});
	});

	it('rejects unrelated and malformed API errors', () => {
		expect(parseDraftConflict({ code: 'validation_error' })).toBeNull();
		expect(
			parseDraftConflict({
				code: 'draft_revision_conflict',
				conflict: { aggregate_id: 'publication-1', current_revision: '5' }
			})
		).toBeNull();
	});
});
