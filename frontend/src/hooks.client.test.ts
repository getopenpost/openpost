import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeClientErrors } from './hooks.client';

const capturedExceptions = vi.fn();

function installTestErrorCapture() {
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

function testRuntime() {
	return Object.assign(new EventTarget(), {
		location: { reload: vi.fn() },
		setTimeout: vi.fn(() => 1)
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('client error initialization', () => {
	it('handles stale module failures before global telemetry observes them', () => {
		const runtime = testRuntime();
		vi.stubGlobal('window', runtime);
		vi.stubGlobal('navigator', {});
		vi.stubGlobal('sessionStorage', {
			getItem: vi.fn(() => null),
			setItem: vi.fn(),
			removeItem: vi.fn()
		});

		initializeClientErrors(installTestErrorCapture);
		const error = new Error('Importing a module script failed.');
		const event = Object.assign(new Event('error', { cancelable: true }), {
			error,
			message: error.message
		});
		runtime.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(true);
		expect(capturedExceptions).not.toHaveBeenCalled();
	});

	it('handles Vite preload failures from the emitted payload', () => {
		const runtime = testRuntime();
		vi.stubGlobal('window', runtime);
		vi.stubGlobal('navigator', {});
		vi.stubGlobal('sessionStorage', {
			getItem: vi.fn(() => null),
			setItem: vi.fn(),
			removeItem: vi.fn()
		});

		initializeClientErrors(installTestErrorCapture);
		const event = Object.assign(new Event('vite:preloadError', { cancelable: true }), {
			payload: new Error('Importing a module script failed.')
		});
		runtime.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(true);
	});
});
