import { afterEach, describe, expect, it, vi } from 'vitest';
import { init } from './hooks.client';

const capturedExceptions = vi.hoisted(() => vi.fn());

vi.mock('@openpost/telemetry', () => ({
	captureClientException: capturedExceptions,
	installGlobalErrorCapture: () => {
		const capture = (event: Event) => {
			if (!event.defaultPrevented) capturedExceptions();
		};
		window.addEventListener('error', capture);
		window.addEventListener('unhandledrejection', capture);
		return () => {
			window.removeEventListener('error', capture);
			window.removeEventListener('unhandledrejection', capture);
		};
	}
}));

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('client error initialization', () => {
	it('handles stale module failures before global telemetry observes them', async () => {
		const runtime = new EventTarget() as EventTarget & {
			location: { reload: () => void };
			setTimeout: typeof setTimeout;
		};
		runtime.location = { reload: vi.fn() };
		runtime.setTimeout = vi.fn(() => 1) as unknown as typeof setTimeout;
		vi.stubGlobal('window', runtime);
		vi.stubGlobal('navigator', {});
		vi.stubGlobal('sessionStorage', {
			getItem: vi.fn(() => null),
			setItem: vi.fn(),
			removeItem: vi.fn()
		});

		await init();
		const event = new Event('error', { cancelable: true }) as Event & {
			error: Error;
			message: string;
		};
		event.error = new Error('Importing a module script failed.');
		event.message = event.error.message;
		runtime.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(true);
		expect(capturedExceptions).not.toHaveBeenCalled();
	});

	it('handles Vite preload failures from the emitted payload', async () => {
		const runtime = new EventTarget() as EventTarget & {
			location: { reload: () => void };
			setTimeout: typeof setTimeout;
		};
		runtime.location = { reload: vi.fn() };
		runtime.setTimeout = vi.fn(() => 1) as unknown as typeof setTimeout;
		vi.stubGlobal('window', runtime);
		vi.stubGlobal('navigator', {});
		vi.stubGlobal('sessionStorage', {
			getItem: vi.fn(() => null),
			setItem: vi.fn(),
			removeItem: vi.fn()
		});

		await init();
		const event = new Event('vite:preloadError', { cancelable: true }) as Event & {
			payload: Error;
		};
		event.payload = new Error('Importing a module script failed.');
		runtime.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(true);
	});
});
