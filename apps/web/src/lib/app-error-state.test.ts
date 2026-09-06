import { describe, expect, it } from 'vitest';
import { resolveAppErrorProjection } from './app-error-presentation';
import { resolveAppErrorState } from './app-error-state';

describe('resolveAppErrorState', () => {
	it('gives offline recovery priority over the HTTP status', () => {
		expect(resolveAppErrorState(500, false)).toEqual({
			kind: 'offline',
			canRetry: true,
			showDestinations: false,
			showDocumentation: false,
			showSupport: false
		});
	});

	it.each([
		[403, 'forbidden', false, false, true],
		[404, 'not-found', false, true, false],
		[400, 'request-error', false, false, false],
		[429, 'request-error', true, false, false],
		[500, 'server-error', true, false, true],
		[503, 'server-error', true, false, true]
	] as const)(
		'resolves HTTP %i as %s with accurate recovery actions',
		(status, kind, canRetry, showDocumentation, showSupport) => {
			expect(resolveAppErrorState(status, true)).toMatchObject({
				kind,
				canRetry,
				showDocumentation,
				showSupport
			});
		}
	);

	it('projects one classification into matching recovery and presentation', () => {
		const error = resolveAppErrorProjection(500, false);

		expect(error.recovery.kind).toBe('offline');
		expect(error.presentation).toMatchObject({
			title: 'You are offline',
			icon: error.recovery.kind
		});
	});
});
