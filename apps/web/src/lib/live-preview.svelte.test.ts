import { describe, expect, it } from 'vitest';
import { LivePreview, LivePreviewError } from './live-preview.svelte';

function deferredRenderer() {
	const calls: {
		key: string;
		resolve: (value: string) => void;
		reject: (cause: unknown) => void;
	}[] = [];
	const render = (key: string) =>
		new Promise<string>((resolve, reject) => calls.push({ key, resolve, reject }));
	return { calls, render };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const waitFor = async (check: () => boolean) => {
	for (let attempt = 0; attempt < 50 && !check(); attempt++)
		await new Promise((resolve) => setTimeout(resolve, 20));
	expect(check()).toBe(true);
};

describe('LivePreview', () => {
	it('streams the newest input while one render is in flight', async () => {
		const { calls, render } = deferredRenderer();
		const preview = new LivePreview(render, {
			debounceMs: 0,
			minIntervalMs: 0
		});
		preview.request('a');
		await waitFor(() => calls.length === 1);
		preview.request('ab');
		preview.request('abc');
		await settle();
		expect(calls).toHaveLength(1);
		calls[0].resolve('image a');
		await waitFor(() => calls.length === 2);
		expect(preview.current).toBe('image a');
		expect(preview.pending).toBe(true);
		expect(calls[1].key).toBe('abc');
		calls[1].resolve('image abc');
		await waitFor(() => preview.current === 'image abc');
		expect(preview.pending).toBe(false);
		preview.dispose();
	});

	it('reuses recent results without rendering again', async () => {
		const { calls, render } = deferredRenderer();
		const preview = new LivePreview(render, {
			debounceMs: 0,
			minIntervalMs: 0
		});
		preview.request('light');
		await waitFor(() => calls.length === 1);
		calls[0].resolve('light image');
		await waitFor(() => preview.current === 'light image');
		preview.request('dark');
		await waitFor(() => calls.length === 2);
		calls[1].resolve('dark image');
		await waitFor(() => preview.current === 'dark image');
		preview.request('light');
		expect(preview.current).toBe('light image');
		expect(preview.pending).toBe(false);
		await settle();
		expect(calls).toHaveLength(2);
		preview.dispose();
	});

	it('keeps the last image visible when a render fails', async () => {
		const { calls, render } = deferredRenderer();
		const preview = new LivePreview(render, {
			debounceMs: 0,
			minIntervalMs: 0
		});
		preview.request('fits');
		await waitFor(() => calls.length === 1);
		calls[0].resolve('fitting image');
		await waitFor(() => preview.current === 'fitting image');
		preview.request('overflows');
		await waitFor(() => calls.length === 2);
		calls[1].reject(new LivePreviewError('This content does not fit', 422));
		await waitFor(() => preview.error !== null);
		expect(preview.error?.status).toBe(422);
		expect(preview.current).toBe('fitting image');
		expect(preview.pending).toBe(false);
		preview.dispose();
	});

	it('waits for a saved result before the first render and can cancel', async () => {
		const { calls, render } = deferredRenderer();
		const preview = new LivePreview(render, { initialDelayMs: 50 });
		preview.request('saved');
		preview.cancel();
		await new Promise((resolve) => setTimeout(resolve, 120));
		expect(calls).toHaveLength(0);
		expect(preview.pending).toBe(false);
		preview.request('edited');
		await waitFor(() => calls.length === 1);
		expect(calls[0].key).toBe('edited');
		preview.dispose();
	});
});
