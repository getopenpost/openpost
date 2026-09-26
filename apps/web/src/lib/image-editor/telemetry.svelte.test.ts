import { afterEach, expect, it, vi } from 'vitest';
import { configureProfiling } from '$lib/performance/profiling';
import { startImageEditorMetric } from './telemetry';
import { init } from '../../hooks.client';

const originalUrl = location.href;
let observer: PerformanceObserver | undefined;

afterEach(() => {
	configureProfiling({ enabled: false });
	History.prototype.replaceState.call(history, null, '', originalUrl);
	observer?.disconnect();
});

it('preserves entry-page profiling after navigation without retaining performance entries', async () => {
	History.prototype.replaceState.call(history, null, '', '?profile=1');
	await init();
	History.prototype.replaceState.call(history, null, '', location.pathname);
	const entries: PerformanceEntry[] = [];
	observer = new PerformanceObserver((list) => {
		entries.push(...list.getEntries());
	});
	observer.observe({ type: 'measure' });
	const finish = startImageEditorMetric('export');
	finish('error');
	finish('error');
	await expect
		.poll(() => entries.map((entry) => entry.name))
		.toEqual(['OpenPost/Image Editor/export']);
	expect(performance.getEntriesByName('OpenPost/Image Editor/export')).toHaveLength(0);
});

it('keeps normal editor metrics working without enabling performance tracing', async () => {
	configureProfiling({ enabled: false });
	const metric = vi.fn();
	const entries: PerformanceEntry[] = [];
	observer = new PerformanceObserver((list) => entries.push(...list.getEntries()));
	observer.observe({ type: 'measure' });
	globalThis.addEventListener('openpost:image-editor-metric', metric, {
		once: true
	});
	startImageEditorMetric('export')();
	await new Promise(requestAnimationFrame);
	expect(metric).toHaveBeenCalledOnce();
	expect(entries.filter((entry) => entry.name.startsWith('OpenPost/'))).toHaveLength(0);
});
