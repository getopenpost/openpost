import { describe, expect, it, vi } from 'vitest';
import { installStaleModuleRecovery } from './stale-module-recovery';

describe('installStaleModuleRecovery', () => {
	it('suppresses a failed Safari module import and reloads the current page', () => {
		const runtime = new EventTarget() as EventTarget & {
			location: { reload: () => void };
			setTimeout: (callback: () => void, delay: number) => number;
			sessionStorage: Storage;
		};
		const stored = new Map<string, string>();
		runtime.location = { reload: vi.fn() };
		runtime.setTimeout = (callback) => {
			callback();
			return 1;
		};
		runtime.sessionStorage = {
			getItem: (key) => stored.get(key) ?? null,
			setItem: (key, value) => stored.set(key, value),
			removeItem: (key) => stored.delete(key),
			clear: () => stored.clear(),
			key: (index) => [...stored.keys()][index] ?? null,
			get length() {
				return stored.size;
			}
		};
		const removeRecovery = installStaleModuleRecovery(runtime);
		const event = new Event('error', { cancelable: true }) as Event & {
			error: Error;
			message: string;
		};
		event.error = new Error('Importing a module script failed.');
		event.message = event.error.message;

		runtime.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(true);
		expect(runtime.location.reload).toHaveBeenCalledOnce();
		removeRecovery();
	});
});
