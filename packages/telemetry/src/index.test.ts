import { describe, expect, it } from 'vitest';
import { BrowserTelemetry, type BrowserTelemetryConfig } from './index';

class FakeSDK {
	initialized: Array<{ token: string; options: Record<string, unknown> }> = [];
	events: Array<{ event: string; properties: Record<string, unknown> | undefined }> = [];
	exceptions: Array<{ error: Error; properties: Record<string, unknown> | undefined }> = [];
	identified: string[] = [];
	registered: Record<string, unknown>[] = [];
	resetCount = 0;
	optOutCount = 0;

	init(token: string, options: Record<string, unknown>) { this.initialized.push({ token, options }); }
	capture(event: string, properties?: Record<string, unknown>) { this.events.push({ event, properties }); }
	captureException(error: Error, properties?: Record<string, unknown>) { this.exceptions.push({ error, properties }); }
	identify(id: string) { this.identified.push(id); }
	register(properties: Record<string, unknown>) { this.registered.push(properties); }
	reset() { this.resetCount += 1; }
	opt_out_capturing() { this.optOutCount += 1; }
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
});
