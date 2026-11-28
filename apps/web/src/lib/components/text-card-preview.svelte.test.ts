import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { TextCardRequest, TextCardResult } from '$lib/text-cards';
import TextCardPreview from './text-card-preview.svelte';

const post = vi.hoisted(() => vi.fn());
vi.mock('$lib/api/client', () => ({ client: { POST: post } }));

const image = (n: number) => ({ data_url: `data:image/png;base64,AA${n}`, width: 10, height: 10 });
const request = (text: string) =>
	({ social_account_id: 'acc', text, settings: {} }) as unknown as TextCardRequest;

afterEach(() => post.mockReset());

describe('TextCardPreview', () => {
	it('keeps previous images visible while the next render is pending', async () => {
		post.mockResolvedValueOnce({ data: { images: [image(1)] } });
		let release!: (value: unknown) => void;
		post.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
		const results: TextCardResult[] = [];
		const screen = render(TextCardPreview, {
			request: request('a'),
			onResult: (r: TextCardResult) => results.push(r)
		});
		await expect.element(page.getByRole('img')).toBeVisible();
		await screen.rerender({ request: request('ab') });
		await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2));
		await expect.element(page.getByRole('img')).toBeVisible();
		expect(results.at(-1)?.loading).toBe(true);
		release({ data: { images: [image(2)] } });
		await vi.waitFor(() => expect(results.at(-1)?.loading).toBe(false));
		expect(results.at(-1)?.images[0].data_url).toContain('AA2');
	});

	it('reports errors and retries', async () => {
		post.mockResolvedValueOnce({ error: { detail: 'boom' } });
		post.mockResolvedValueOnce({ data: { images: [image(3)] } });
		render(TextCardPreview, { request: request('x') });
		await expect.element(page.getByText('boom')).toBeVisible();
		await page.getByRole('button', { name: /try again/i }).click();
		await expect.element(page.getByRole('img')).toBeVisible();
	});

	it('uses a matching saved preview without calling the server', async () => {
		const first = render(TextCardPreview, { request: request('s') });
		first.unmount();
		post.mockReset();
		post.mockResolvedValue({ data: { images: [image(4)] } });
		const results: TextCardResult[] = [];
		const { textCardRequestKey } = await import('$lib/text-cards');
		render(TextCardPreview, {
			request: request('s'),
			savedPreview: {
				key: textCardRequestKey(request('s')),
				images: [image(5)],
				loading: false,
				error: ''
			},
			onResult: (r: TextCardResult) => results.push(r)
		});
		await expect.element(page.getByRole('img')).toBeVisible();
		expect(post).not.toHaveBeenCalled();
		expect(results.at(-1)?.images[0].data_url).toContain('AA5');
	});
});
