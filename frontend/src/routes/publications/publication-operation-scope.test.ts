import { describe, expect, it } from 'vitest';
import { PublicationOperationScope } from './publication-operation-scope';

type Identity = { userID: string; epoch: number };

function identityIsCurrent(current: Identity) {
	return (identity: Identity) =>
		identity.userID === current.userID && identity.epoch === current.epoch;
}

describe('PublicationOperationScope', () => {
	it('keeps server reconciliation actor-scoped while blocking stale view projection', () => {
		const scope = new PublicationOperationScope<Identity>();
		const identity = { userID: 'user-1', epoch: 1 };
		const operation = scope.capture(identity, 'workspace-1', 'failed');
		const isIdentityCurrent = identityIsCurrent(identity);

		expect(scope.actorIsCurrent(operation, isIdentityCurrent)).toBe(true);
		expect(
			scope.viewIsCurrent(operation, {
				workspaceId: 'workspace-2',
				viewKey: 'failed',
				isIdentityCurrent
			})
		).toBe(false);
		expect(
			scope.viewIsCurrent(operation, {
				workspaceId: 'workspace-1',
				viewKey: 'scheduled',
				isIdentityCurrent
			})
		).toBe(false);
	});

	it('blocks projection after destruction or an auth epoch change', () => {
		const scope = new PublicationOperationScope<Identity>();
		const identity = { userID: 'user-1', epoch: 1 };
		const operation = scope.capture(identity, 'workspace-1', 'publication-1');

		scope.destroy();
		expect(scope.actorIsCurrent(operation, identityIsCurrent(identity))).toBe(true);
		expect(
			scope.viewIsCurrent(operation, {
				workspaceId: 'workspace-1',
				viewKey: 'publication-1',
				isIdentityCurrent: identityIsCurrent(identity)
			})
		).toBe(false);
		expect(scope.actorIsCurrent(operation, identityIsCurrent({ userID: 'user-1', epoch: 2 }))).toBe(
			false
		);
	});

	it('does not revive an old operation after returning to the same view', () => {
		const scope = new PublicationOperationScope<Identity>();
		const identity = { userID: 'user-1', epoch: 1 };
		const oldOperation = scope.capture(identity, 'workspace-1', 'publication-1');

		scope.supersedeView();
		const currentOperation = scope.capture(identity, 'workspace-1', 'publication-1');
		const currentView = {
			workspaceId: 'workspace-1',
			viewKey: 'publication-1',
			isIdentityCurrent: identityIsCurrent(identity)
		};

		expect(scope.viewIsCurrent(oldOperation, currentView)).toBe(false);
		expect(scope.viewIsCurrent(currentOperation, currentView)).toBe(true);
	});
});
