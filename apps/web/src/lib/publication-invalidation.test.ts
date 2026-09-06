import { describe, expect, it } from 'vitest';
import {
	PublicationInvalidationCoalescer,
	publicationInvalidationForWorkspace
} from './publication-invalidation';

describe('PublicationInvalidationCoalescer', () => {
	it('coalesces autosaves into one workspace-scoped batch', () => {
		const coalescer = new PublicationInvalidationCoalescer();
		coalescer.add({ workspaceId: 'workspace-1', scopes: ['drafts'] });
		coalescer.add({
			workspaceId: 'workspace-1',
			scopes: ['calendar', 'drafts'],
			dateKeys: ['2026-08-12', '2026-08-11']
		});
		coalescer.add({
			workspaceId: 'workspace-1',
			scopes: ['calendar'],
			dateKeys: ['2026-08-12']
		});

		expect(coalescer.drain(4)).toEqual({
			revision: 4,
			entries: [
				{
					workspaceId: 'workspace-1',
					scopes: ['calendar', 'drafts'],
					dateKeys: ['2026-08-11', '2026-08-12'],
					activities: []
				}
			]
		});
		expect(coalescer.drain(5)).toBeNull();
	});

	it('keeps workspace invalidations isolated while merging a global refresh', () => {
		const coalescer = new PublicationInvalidationCoalescer();
		coalescer.add({ workspaceId: 'workspace-1', scopes: ['calendar'] });
		coalescer.add({ workspaceId: 'workspace-2', scopes: ['drafts'] });
		coalescer.add();
		const batch = coalescer.drain(1);

		expect(batch).not.toBeNull();
		expect(publicationInvalidationForWorkspace(batch!, 'workspace-1')).toEqual({
			workspaceId: 'workspace-1',
			scopes: ['activity', 'calendar', 'drafts'],
			dateKeys: [],
			activities: []
		});
		expect(publicationInvalidationForWorkspace(batch!, 'workspace-3')).toEqual({
			workspaceId: 'workspace-3',
			scopes: ['activity', 'calendar', 'drafts'],
			dateKeys: [],
			activities: []
		});
	});

	it('merges exact activity buckets across coalesced moves', () => {
		const coalescer = new PublicationInvalidationCoalescer();
		coalescer.add({
			workspaceId: 'workspace-1',
			scopes: ['activity', 'calendar'],
			activities: ['scheduled']
		});
		coalescer.add({
			workspaceId: 'workspace-1',
			scopes: ['activity'],
			activities: ['failed', 'scheduled']
		});
		coalescer.add({ workspaceId: 'workspace-1', scopes: ['drafts'] });

		expect(coalescer.drain(7)).toEqual({
			revision: 7,
			entries: [
				{
					workspaceId: 'workspace-1',
					scopes: ['activity', 'calendar', 'drafts'],
					dateKeys: [],
					activities: ['failed', 'scheduled']
				}
			]
		});
	});
});
