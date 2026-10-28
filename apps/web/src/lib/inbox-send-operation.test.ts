import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inboxSendOperation } from './inbox-send-operation';

describe('web inbox send identity', () => {
	beforeEach(() => {
		const stored = new Map<string, string>();
		vi.stubGlobal('sessionStorage', {
			getItem: (key: string) => stored.get(key) ?? null,
			setItem: (key: string, value: string) => stored.set(key, value),
			removeItem: (key: string) => stored.delete(key)
		});
	});
	it('reuses a receipt after an interrupted request and retires it after confirmation', async () => {
		const first = await inboxSendOperation('actor', 'workspace', 'conversation', 'hello');
		const retry = await inboxSendOperation('actor', 'workspace', 'conversation', 'hello');
		expect(retry.id).toBe(first.id);
		retry.complete();
		expect((await inboxSendOperation('actor', 'workspace', 'conversation', 'hello')).id).not.toBe(
			first.id
		);
	});
	it('isolates changed drafts, conversations, actors and workspaces', async () => {
		const first = await inboxSendOperation('actor', 'workspace', 'one', 'hello');
		const changed = await inboxSendOperation('actor', 'workspace', 'one', 'changed');
		const otherConversation = await inboxSendOperation('actor', 'workspace', 'two', 'hello');
		const otherActor = await inboxSendOperation('other', 'workspace', 'one', 'hello');
		const otherWorkspace = await inboxSendOperation('actor', 'other-workspace', 'one', 'hello');
		expect(
			new Set([first.id, changed.id, otherConversation.id, otherActor.id, otherWorkspace.id]).size
		).toBe(5);
		const unchanged = await inboxSendOperation('actor', 'workspace', 'one', 'hello');
		expect(unchanged.id).toBe(first.id);
		// Retire every receipt so later declarations start from a clean map.
		for (const operation of [
			first,
			changed,
			otherConversation,
			otherActor,
			otherWorkspace,
			unchanged
		]) {
			operation.complete();
		}
	});
});
