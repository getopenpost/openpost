import { describe, expect, it } from 'vitest';
import { openPostWorkspaceKey } from '@openpost/query-catalog';
import { QueryClient } from '@tanstack/query-core';
import { removeWorkspaceQueriesAfterAccessLoss } from './workspace-settings';

describe('Workspace settings query API', () => {
	it('drops every cached workspace view after confirmed access loss', () => {
		const client = new QueryClient();
		const lostKey = openPostWorkspaceKey('workspace-1');
		// A workspace the user can still access keeps serving its cached views.
		const keptKey = openPostWorkspaceKey('workspace-2');
		client.setQueryData(lostKey, 'cached');
		client.setQueryData(keptKey, 'cached');

		removeWorkspaceQueriesAfterAccessLoss(client, 'workspace-1');

		expect(client.getQueryData(lostKey)).toBeUndefined();
		expect(client.getQueryData(keptKey)).toBe('cached');
	});
});
