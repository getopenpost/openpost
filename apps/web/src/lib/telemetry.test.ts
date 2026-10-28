import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.resetModules();
});

const config = {
	enabled: true,
	project_token: 'phc_fixture',
	api_host: 'https://analytics.example.test',
	environment: 'test',
	edition: 'cloud'
};

it('recovers configuration after a temporary HTTP failure without duplicate initialization', async () => {
	vi.useFakeTimers();
	vi.stubGlobal('window', new EventTarget());
	const fetch = vi
		.fn()
		.mockResolvedValueOnce(new Response(null, { status: 503 }))
		.mockResolvedValue(Response.json(config));
	vi.stubGlobal('fetch', fetch);
	const { getTelemetryPreference, subscribeTelemetryPreference } =
		await import('@openpost/telemetry');
	const preferences: string[] = [];
	const unsubscribe = subscribeTelemetryPreference((value) => preferences.push(value));
	const { initializeAppTelemetry } = await import('./telemetry');
	const first = initializeAppTelemetry();
	const concurrent = initializeAppTelemetry();
	expect(fetch).toHaveBeenCalledTimes(1);
	await vi.runAllTimersAsync();
	await Promise.all([first, concurrent]);
	expect(fetch).toHaveBeenCalledTimes(2);
	expect(getTelemetryPreference()).toBe('undecided');
	expect(preferences.filter((value) => value === 'undecided')).toHaveLength(1);
	unsubscribe();
});

it('bounds offline attempts and recovers when the browser returns online', async () => {
	vi.useFakeTimers();
	const window = new EventTarget();
	vi.stubGlobal('window', window);
	const fetch = vi.fn().mockRejectedValue(new TypeError('Network unavailable'));
	vi.stubGlobal('fetch', fetch);
	const { getTelemetryPreference } = await import('@openpost/telemetry');
	const { initializeAppTelemetry } = await import('./telemetry');
	const initial = initializeAppTelemetry();
	await vi.runAllTimersAsync();
	await initial;
	expect(fetch).toHaveBeenCalledTimes(3);
	expect(getTelemetryPreference()).toBe('unavailable');
	fetch.mockResolvedValue(Response.json(config));
	window.dispatchEvent(new Event('online'));
	await vi.runAllTimersAsync();
	expect(fetch).toHaveBeenCalledTimes(4);
	expect(getTelemetryPreference()).toBe('undecided');
});
