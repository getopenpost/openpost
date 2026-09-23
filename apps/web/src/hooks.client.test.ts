/* oxlint-disable anti-slop/no-module-mocking, anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- This bootstrap-order regression test observes telemetry through a module spy and supplies the exact browser event/runtime fields read by the hook. */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleError, initializeClientErrors } from './hooks.client';

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
	it('replaces the previous global error listener when initialized again', () => {
		const runtime = testRuntime();
		vi.stubGlobal('window', runtime);
		vi.stubGlobal('navigator', { onLine: true });
		vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {} });
		initializeClientErrors(installTestErrorCapture);
		initializeClientErrors(installTestErrorCapture);
		runtime.dispatchEvent(Object.assign(new Event('error'), { error: new Error('failure') }));
		expect(capturedExceptions).toHaveBeenCalledOnce();
	});
	it('preserves models and project caches when recovering a stale page', async () => {
		const runtime = Object.assign(testRuntime(), {
			setTimeout: (callback: () => void) => {
				callback();
				return 1;
			},
			caches: {
				keys: async () => [
					'openpost-pages-2',
					'openpost-image-editor-models-1.7.0',
					'local-projects'
				],
				delete: vi.fn(async () => true)
			}
		});
		vi.stubGlobal('window', runtime);
		vi.stubGlobal('navigator', { onLine: true });
		vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {} });
		// The missing asset is the evidence of deployment skew: the probe
		// reports it gone, so one bounded reload is justified.
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ status: 404 }))
		);
		initializeClientErrors(installTestErrorCapture);
		runtime.dispatchEvent(
			Object.assign(new Event('error', { cancelable: true }), {
				error: new Error(
					'Failed to fetch dynamically imported module: /_app/immutable/chunks/route.js'
				)
			})
		);
		await vi.waitFor(() => expect(runtime.location.reload).toHaveBeenCalledOnce());
		expect(runtime.caches.delete.mock.calls).toEqual([['openpost-pages-2']]);
	});

	it('keeps unclassified import failures visible instead of reloading blindly', () => {
		const runtime = testRuntime();
		vi.stubGlobal('window', runtime);
		vi.stubGlobal('navigator', { onLine: true });
		vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {} });
		initializeClientErrors(installTestErrorCapture);
		runtime.dispatchEvent(
			Object.assign(new Event('error', { cancelable: true }), {
				error: new Error('Importing a module script failed.')
			})
		);
		// A bare message names no asset, so there is nothing to probe and no
		// evidence a reload would help. The boundary keeps its explicit retry.
		expect(runtime.setTimeout).not.toHaveBeenCalled();
	});

	it('does not schedule chunk recovery while offline', () => {
		const runtime = testRuntime();
		vi.stubGlobal('window', runtime);
		vi.stubGlobal('navigator', { onLine: false });
		initializeClientErrors(installTestErrorCapture);
		runtime.dispatchEvent(
			Object.assign(new Event('error', { cancelable: true }), {
				error: new Error('Importing a module script failed.')
			})
		);
		expect(runtime.setTimeout).not.toHaveBeenCalled();
	});

	it('does not reload an editing tab when a service worker takes control', () => {
		const runtime = testRuntime();
		const serviceWorker = Object.assign(new EventTarget(), { controller: {} });
		vi.stubGlobal('window', runtime);
		vi.stubGlobal('navigator', { serviceWorker });
		initializeClientErrors(installTestErrorCapture);
		serviceWorker.dispatchEvent(new Event('controllerchange'));
		expect(runtime.location.reload).not.toHaveBeenCalled();
	});

	it('keeps rejected imports visible to global telemetry while recovering separately', () => {
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

		// The rejection stays intact for SvelteKit and telemetry; recovery is
		// coordinated separately and finds no evidence here.
		expect(event.defaultPrevented).toBe(false);
		expect(capturedExceptions).toHaveBeenCalledOnce();
		expect(runtime.setTimeout).not.toHaveBeenCalled();
	});

	it('leaves failed preloads to their caller before deciding whether to reload', () => {
		const runtime = testRuntime();
		vi.stubGlobal('window', runtime);
		vi.stubGlobal('navigator', { onLine: true });
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

		expect(event.defaultPrevented).toBe(false);
		expect(runtime.setTimeout).not.toHaveBeenCalled();
	});

	it('reloads when SvelteKit reports an unhandled route chunk failure', async () => {
		const runtime = testRuntime();
		vi.stubGlobal('window', runtime);
		vi.stubGlobal('navigator', { onLine: true });
		vi.stubGlobal('sessionStorage', {
			getItem: vi.fn(() => null),
			setItem: vi.fn(),
			removeItem: vi.fn()
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ status: 404 }))
		);

		initializeClientErrors(installTestErrorCapture);
		// SAFETY: handleError only reads error and status; the route event and message are unused here.
		handleError({
			error: new Error(
				'Failed to fetch dynamically imported module: /_app/immutable/chunks/route.js'
			),
			status: 500
		} as Parameters<typeof handleError>[0]);

		await vi.waitFor(() => expect(runtime.setTimeout).toHaveBeenCalledOnce());
	});

	it('reloads when SvelteKit reports a Firefox route chunk failure', async () => {
		const runtime = testRuntime();
		vi.stubGlobal('window', runtime);
		vi.stubGlobal('navigator', { onLine: true });
		vi.stubGlobal('sessionStorage', {
			getItem: vi.fn(() => null),
			setItem: vi.fn(),
			removeItem: vi.fn()
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ status: 404 }))
		);

		initializeClientErrors(installTestErrorCapture);
		// SAFETY: handleError only reads error and status; the route event and message are unused here.
		handleError({
			error: new Error(
				'error loading dynamically imported module: https://openpo.st/_app/immutable/chunks/route.js'
			),
			status: 500
		} as Parameters<typeof handleError>[0]);

		await vi.waitFor(() => expect(runtime.setTimeout).toHaveBeenCalledOnce());
	});

	it('refuses automatic reloads while the layout reports unsaved changes', async () => {
		const runtime = testRuntime();
		vi.stubGlobal('window', runtime);
		vi.stubGlobal('navigator', { onLine: true });
		vi.stubGlobal('sessionStorage', {
			getItem: vi.fn(() => null),
			setItem: vi.fn(),
			removeItem: vi.fn()
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ status: 404 }))
		);
		// SAFETY: the hook only reads documentElement.dataset.unsavedChanges.
		vi.stubGlobal('document', {
			documentElement: { dataset: { unsavedChanges: '1' } }
		} as unknown as Document);

		initializeClientErrors(installTestErrorCapture);
		// SAFETY: handleError only reads error and status; the route event and message are unused here.
		handleError({
			error: new Error(
				'Failed to fetch dynamically imported module: /_app/immutable/chunks/route.js'
			),
			status: 500
		} as Parameters<typeof handleError>[0]);

		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(runtime.setTimeout).not.toHaveBeenCalled();
	});

	it('never reloads for unsupported-browser syntax failures', async () => {
		const runtime = testRuntime();
		vi.stubGlobal('window', runtime);
		vi.stubGlobal('navigator', { onLine: true });
		vi.stubGlobal('sessionStorage', {
			getItem: vi.fn(() => null),
			setItem: vi.fn(),
			removeItem: vi.fn()
		});

		initializeClientErrors(installTestErrorCapture);
		// SAFETY: handleError only reads error and status; the route event and message are unused here.
		handleError({
			error: new SyntaxError('Invalid regular expression: invalid group specifier name'),
			status: 500
		} as Parameters<typeof handleError>[0]);

		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(runtime.setTimeout).not.toHaveBeenCalled();
	});
});
