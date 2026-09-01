import { describe, expect, it, vi } from 'vitest';
import { installStaleModuleRecovery } from './stale-module-recovery';

describe('installStaleModuleRecovery', () => {
	it('suppresses a failed Safari module import and reloads the current page', () => {
		const stored = new Map<string, string>();
		const reload = vi.fn();
		const runtime = Object.assign(new EventTarget(), {
			location: { reload },
			setTimeout: (callback: () => void) => {
				callback();
				return 1;
			},
			sessionStorage: {
				getItem: (key: string) => stored.get(key) ?? null,
				setItem: (key: string, value: string) => stored.set(key, value)
			}
		});
		const removeRecovery = installStaleModuleRecovery(runtime);
		const error = new Error('Importing a module script failed.');
		const event = Object.assign(new Event('error', { cancelable: true }), {
			error,
			message: error.message
		});

		runtime.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(true);
		expect(reload).toHaveBeenCalledOnce();
		removeRecovery();
	});
});
