import { describe, expect, it } from 'vitest';
import {
	applyTelemetryRequestHeaders,
	BrowserTelemetry,
	type BrowserTelemetryConfig
} from './index';

class FakeSDK {
	initialized: Array<{ token: string; options: Record<string, unknown> }> = [];
	events: Array<{ event: string; properties: Record<string, unknown> | undefined }> = [];
	exceptions: Array<{ error: Error; properties: Record<string, unknown> | undefined }> = [];
	identified: string[] = [];
	registered: Record<string, unknown>[] = [];
	resetCount = 0;
	optOutCount = 0;
	distinctID = 'browser-user-1';
	sessionID = 'session-1';

	init(token: string, options: Record<string, unknown>) { this.initialized.push({ token, options }); }
	capture(event: string, properties?: Record<string, unknown>) { this.events.push({ event, properties }); }
	captureException(error: Error, properties?: Record<string, unknown>) { this.exceptions.push({ error, properties }); }
	identify(id: string) { this.identified.push(id); }
	register(properties: Record<string, unknown>) { this.registered.push(properties); }
	reset() { this.resetCount += 1; }
	opt_out_capturing() { this.optOutCount += 1; }
	get_distinct_id() { return this.distinctID; }
	get_session_id() { return this.sessionID; }
}

const configuredApp: BrowserTelemetryConfig = {
	enabled: true,
	projectToken: 'phc_test',
	apiHost: 'https://e.example.com/',
	uiHost: 'https://eu.posthog.com/',
	environment: 'test',
	edition: 'cloud',
	version: '1.2.3',
	revision: 'abc123',
	surface: 'app'
};

describe('BrowserTelemetry', () => {
	it('uses private browser defaults and flushes queued identity and events', () => {
		const sdk = new FakeSDK();
		const subject = new BrowserTelemetry(sdk, () => true);
		subject.identify('user-1');
		subject.capture('workspace created');
		subject.configure(configuredApp);

		expect(sdk.initialized[0]?.options).toMatchObject({
			api_host: 'https://e.example.com',
			autocapture: false,
			persistence: 'memory',
			cookieless_mode: 'always',
			person_profiles: 'identified_only',
			disable_session_recording: true
		});
		expect(sdk.identified).toEqual(['user-1']);
		expect(sdk.events[0]?.event).toBe('workspace created');
	});

	it('resets before switching identified users and on logout', () => {
		const sdk = new FakeSDK();
		const subject = new BrowserTelemetry(sdk, () => true);
		subject.configure(configuredApp);
		subject.identify('user-1');
		subject.identify('user-2');
		subject.resetIdentity();

		expect(sdk.identified).toEqual(['user-1', 'user-2']);
		expect(sdk.resetCount).toBe(2);
	});

	it('does not expose credentials or capture events when disabled', () => {
		const sdk = new FakeSDK();
		const subject = new BrowserTelemetry(sdk, () => true);
		subject.configure({ ...configuredApp, enabled: false });
		subject.capture('workspace created');

		expect(sdk.initialized).toHaveLength(0);
		expect(sdk.events).toHaveLength(0);
	});

	it('scrubs common secrets and captures the same error object once', () => {
		const sdk = new FakeSDK();
		const subject = new BrowserTelemetry(sdk, () => true);
		subject.configure(configuredApp);
		const error = new Error('Failed https://example.com/callback?code=secret user@example.com');
		subject.captureException(error);
		subject.captureException(error);

		expect(sdk.exceptions).toHaveLength(1);
		expect(sdk.exceptions[0]?.error.message).not.toContain('secret');
		expect(sdk.exceptions[0]?.error.message).not.toContain('user@example.com');
		expect(sdk.exceptions[0]?.error.message).not.toContain('https://example.com');
	});

	it('redacts raw stack URLs while retaining safe source-map asset paths', () => {
		const sdk = new FakeSDK();
		const subject = new BrowserTelemetry(sdk, () => true);
		subject.configure(configuredApp);
		const error = new Error('Navigation failed');
		error.stack = [
			'Error: Navigation failed',
			'    at load (https://app.openpost.social/_app/immutable/chunks/app.ABC123.js:12:3?token=secret)',
			'    at reset (https://example.com/reset/path-secret:4:2)'
		].join('\n');

		subject.captureException(error);

		const stack = sdk.exceptions[0]?.error.stack ?? '';
		expect(stack).toContain('/_app/immutable/chunks/app.ABC123.js:12:3');
		expect(stack).toContain('[redacted-url]');
		expect(stack).not.toContain('app.openpost.social');
		expect(stack).not.toContain('path-secret');
		expect(stack).not.toContain('token=secret');
	});

	it('applies browser correlation headers to shared request transports', () => {
		const headers = applyTelemetryRequestHeaders(new Headers({ Authorization: 'Bearer token' }), {
			'X-PostHog-Distinct-ID': 'browser-user-1',
			'X-PostHog-Session-ID': 'session-1'
		});

		expect(headers.get('Authorization')).toBe('Bearer token');
		expect(headers.get('X-PostHog-Distinct-ID')).toBe('browser-user-1');
		expect(headers.get('X-PostHog-Session-ID')).toBe('session-1');
	});
});
