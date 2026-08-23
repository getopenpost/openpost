import { describe, expect, it } from 'vitest';
import type { components } from '$lib/api/types';
import { publicationDraft } from './publication-client';

type Publication = components['schemas']['PublicationResponse'];

describe('publicationDraft', () => {
	it('keeps builder direction when the composer loads a draft', () => {
		const publication: Publication = {
			id: 'publication-1',
			workspace_id: 'workspace-1',
			created_by: 'user-1',
			title: 'Less code, better product',
			intent: 'post',
			creation_preset: 'post',
			content_profile: 'short_text',
			source_text: 'I deleted 15,000 lines.',
			goal: 'Build authority',
			audience: 'Technical founders',
			metadata: { builder: { angle: 'The deletion is the launch' } },
			media: [],
			segments: [],
			renditions: [],
			repost_override: { mode: 'inherit' },
			status: 'draft',
			revision: 1,
			random_delay_minutes: 0,
			random_delay_inherited: true,
			created_at: '2026-08-23T12:00:00Z',
			updated_at: '2026-08-23T12:00:00Z'
		};

		expect(publicationDraft(publication)).toMatchObject({
			goal: 'Build authority',
			audience: 'Technical founders',
			metadata: { builder: { angle: 'The deletion is the launch' } }
		});
	});
});
