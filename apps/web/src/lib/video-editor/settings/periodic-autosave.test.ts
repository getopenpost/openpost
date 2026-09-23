import { expect, it, vi } from 'vitest';
import { PeriodicAutosaveController, type PeriodicAutosaveScheduler } from './periodic-autosave';

it('stops periodic retries after a missing project while keeping the edit dirty', async () => {
	let tick: (() => void) | undefined;
	let idle: (() => void) | undefined;
	const dirty = true;
	const clearInterval = vi.fn((id: ReturnType<typeof setInterval>) => {
		globalThis.clearInterval(id);
		tick = undefined;
	});
	const save = vi.fn(async () => {
		throw new Error('Project not found');
	});
	const scheduler: PeriodicAutosaveScheduler = {
		setInterval: (callback) => {
			tick = callback;
			return globalThis.setInterval(() => undefined, 1_000_000);
		},
		clearInterval,
		requestIdle: (callback) => {
			idle = callback;
			return () => {
				idle = undefined;
			};
		}
	};
	const controller = new PeriodicAutosaveController(
		() => dirty,
		save,
		() => 'stop',
		scheduler
	);
	controller.configure(5);
	tick?.();
	const runIdle = idle;
	idle = undefined;
	runIdle?.();
	await vi.waitFor(() => expect(clearInterval).toHaveBeenCalledOnce());
	tick?.();
	expect(idle).toBeUndefined();
	expect(save).toHaveBeenCalledOnce();
	expect(dirty).toBe(true);
});
