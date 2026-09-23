import { expect, it, vi } from 'vitest';
import { captureIfUnrecovered } from './chunk-error-reporting';

it('does not report an import error when the page has a scheduled recovery reload', async () => {
	const capture = vi.fn();
	const error = new TypeError('Failed to fetch dynamically imported module');
	await captureIfUnrecovered(
		error,
		async () => ({ kind: 'reloaded', assetPath: null, attempt: 1 }),
		capture
	);
	expect(capture).not.toHaveBeenCalled();
});

it('reports import errors that need a manual retry', async () => {
	const capture = vi.fn();
	const error = new TypeError('Importing a module script failed.');
	await captureIfUnrecovered(
		error,
		async () => ({ kind: 'manual', assetPath: null, reason: 'same-build', probeStatus: null }),
		capture
	);
	expect(capture).toHaveBeenCalledExactlyOnceWith(error);
});
