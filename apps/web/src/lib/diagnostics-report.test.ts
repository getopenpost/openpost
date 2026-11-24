import { describe, expect, it } from 'vitest';
import {
	maintainerDiagnosticsAllowed,
	maybeReportBrowserFailure,
	normalizeBrowserFailure,
	type MaintainerDiagnosticsTransport
} from './diagnostics-report';

function transport() {
	const calls: Array<{
		surface: string;
		operation: string;
		error_code: string;
	}> = [];
	const sender: MaintainerDiagnosticsTransport = {
		postReport: async (body) => {
			calls.push(body);
		}
	};
	return { calls, sender };
}

describe('normalizeBrowserFailure', () => {
	it('reduces an uncaught error to a code and an app-relative location', () => {
		const failure = normalizeBrowserFailure(
			'error',
			'TypeError',
			"Cannot read properties of undefined (reading 'text')",
			'TypeError: Cannot read properties of undefined\n    at save (https://app.example/_app/immutable/nodes/9.Abc.js:120:8)\n    at HTMLButtonElement.<anonymous>',
			'/publications',
			'https://app.example'
		);
		expect(failure?.code).toBe('browser_uncaught');
		expect(failure?.location).toBe('/_app/immutable/nodes/9.Abc.js:120:8');
		expect(failure).toMatchObject({
			errorKind: 'type_error' as const,
			frames: [
				{
					module: '/_app/immutable/nodes/9.Abc.js',
					function: 'browser',
					line: 120,
					column: 8
				}
			]
		});
	});

	it('omits custom error names and external script paths', () => {
		const failure = normalizeBrowserFailure(
			'error',
			'private-account-name',
			'private content',
			'Error at https://example.com/private-media.js:10:3',
			'/video-editor/[id]'
		);
		expect(failure).toMatchObject({ location: '/video-editor/:param' });
		expect(JSON.stringify(failure)).not.toMatch(/private|example\.com/);
	});

	it('accepts only application callsites, excluding message URLs and foreign origins', () => {
		const failure = normalizeBrowserFailure(
			'error',
			'Error',
			'private content',
			'Error: upload /_app/immutable/private-client-filename.js\n    at f (https://external.example/_app/immutable/private-name.js:10:3)\nsave@https://app.example/_app/immutable/nodes/9.Abc.js:120:8',
			'/(app)/video-editor/[id]',
			'https://app.example'
		);
		expect(failure?.frames).toEqual([
			{
				module: '/_app/immutable/nodes/9.Abc.js',
				function: 'browser',
				line: 120,
				column: 8
			}
		]);
		expect(JSON.stringify(failure)).not.toContain('private');
	});

	it('never forwards free-form message text', () => {
		const failure = normalizeBrowserFailure(
			'error',
			'Error',
			'secret bearer abc123 and user content here',
			undefined,
			'/publications'
		);
		expect(failure).toBeDefined();
		expect(JSON.stringify(failure)).not.toContain('bearer');
		expect(JSON.stringify(failure)).not.toContain('user content');
	});

	it('skips chunk-load failures handled by deployment recovery', () => {
		expect(
			normalizeBrowserFailure(
				'unhandledrejection',
				'Error',
				'Failed to fetch dynamically imported module: https://app.example/_app/immutable/nodes/9.js',
				undefined,
				'/publications'
			)
		).toBeNull();
		// Firefox wording for the same stale-deployment failure.
		expect(
			normalizeBrowserFailure(
				'unhandledrejection',
				'TypeError',
				'error loading dynamically imported module: https://app.example/_app/immutable/chunks/C_lq0IyJ.js',
				undefined,
				'/publications'
			)
		).toBeNull();
	});

	it('sanitizes route templates instead of sending concrete user paths', () => {
		const failure = normalizeBrowserFailure('error', 'Error', 'boom', undefined, '/u/[username]');
		expect(failure?.location).toBe('/u/:param');
		const templated = normalizeBrowserFailure(
			'error',
			'Error',
			'boom',
			undefined,
			'/video-editor/[id]'
		);
		expect(templated?.location).toBe('/video-editor/:param');
	});
});

describe('maintainerDiagnosticsAllowed', () => {
	it('forces off on browser privacy signals regardless of the switch', () => {
		for (const gate of [
			{ doNotTrack: '1', globalPrivacyControl: false, configEnabled: true },
			{ doNotTrack: 'yes', globalPrivacyControl: false, configEnabled: true },
			{ doNotTrack: null, globalPrivacyControl: true, configEnabled: true }
		] as const) {
			expect(maintainerDiagnosticsAllowed(gate)).toBe(false);
		}
	});
});

describe('maybeReportBrowserFailure', () => {
	it('sends once per code and location, then stays silent', async () => {
		const seen = new Set<string>();
		const { calls, sender } = transport();
		const failure = {
			code: 'browser_uncaught' as const,
			location: '/_app/immutable/nodes/9.js:3',
			errorKind: 'type_error' as const,
			frames: [{ module: '/_app/immutable/nodes/9.js', function: 'browser', line: 3 }]
		};
		expect(await maybeReportBrowserFailure(failure, sender, seen)).toBe(true);
		expect(await maybeReportBrowserFailure(failure, sender, seen)).toBe(false);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toEqual({
			surface: 'browser',
			operation: '/_app/immutable/nodes/9.js:3',
			error_code: 'browser_uncaught',
			error_kind: 'type_error',
			frames: failure.frames
		});
	});
});
