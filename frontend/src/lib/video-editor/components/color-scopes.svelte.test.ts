import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { scopeSamples } from '$lib/video-editor/effects/scope-samples.svelte';
import '../../../routes/layout.css';
import ColorScopes from './color-scopes.svelte';

beforeEach(() => {
	localStorage.removeItem('timeline:scopes:stackLayout');
	scopeSamples.publish(
		'clip',
		new ImageData(
			new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 128, 128, 128, 255]),
			2,
			2
		)
	);
});

afterEach(async () => {
	scopeSamples.clear('clip');
	await page.viewport(1280, 900);
});

describe('ColorScopes', () => {
	it("opens on FreeCut's RGB Parade default and remembers scope changes", async () => {
		const screen = await render(ColorScopes, { itemId: 'clip' });
		const picker = screen.getByRole('button', { name: 'Live color scope' });
		await expect.element(picker).toHaveTextContent('RGB Parade');
		await picker.click();
		await screen.getByRole('option', { name: 'Histogram' }).click();
		await vi.waitFor(() => {
			expect(localStorage.getItem('timeline:scopes:stackLayout')).toBe('histogram');
		});
	});

	it('renders every scope and keeps the grading dock fitted at 320px', async () => {
		await page.viewport(320, 720);
		const screen = await render(ColorScopes, { itemId: 'clip' });
		const section = screen.container.querySelector<HTMLElement>('[data-scope-backend]');
		expect(section).not.toBeNull();
		if (!section) return;

		await expect.element(screen.getByText('Scopes', { exact: true })).toBeVisible();
		await vi.waitFor(() => {
			expect(section.dataset.scopeBackend).toMatch(/^(cpu|webgpu)$/);
			expect(section.querySelector('canvas')?.width).toBeGreaterThan(0);
		});

		const picker = screen.getByRole('button', { name: 'Live color scope' });
		for (const label of ['Waveform', 'RGB Parade', 'Vectorscope', 'Histogram']) {
			await picker.click();
			await screen.getByRole('option', { name: label }).click();
			await expect.element(picker).toHaveTextContent(label);
			await vi.waitFor(() => {
				const canvas = section.querySelector('canvas');
				expect(canvas).not.toBeNull();
				expect(canvas?.clientWidth ?? 0).toBeLessThanOrEqual(section.clientWidth);
			});
		}
		await picker.click();
		await screen.getByRole('option', { name: 'RGB Parade' }).click();
		await page.screenshot({
			element: screen.container,
			path: '../../../../.svelte-kit/openpost-color-scopes-phone.png'
		});
		expect(section.scrollWidth).toBeLessThanOrEqual(section.clientWidth);
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
	});

	it('keeps the source-defined measurement guides visible across scope renderers', async () => {
		const screen = await render(ColorScopes, { itemId: 'clip' });
		const picker = screen.getByRole('button', { name: 'Live color scope' });

		await expect.element(screen.getByText('R', { exact: true })).toBeVisible();
		await expect.element(screen.getByText('G', { exact: true })).toBeVisible();
		await expect.element(screen.getByText('B', { exact: true })).toBeVisible();

		await picker.click();
		await screen.getByRole('option', { name: 'Histogram' }).click();
		await expect.element(screen.getByText('255', { exact: true })).toBeVisible();

		await picker.click();
		await screen.getByRole('option', { name: 'Vectorscope' }).click();
		await expect.element(screen.getByText('skin', { exact: true })).toBeVisible();
		await expect.element(screen.getByText('Mg', { exact: true })).toBeVisible();
		await expect.element(screen.getByText('Cy', { exact: true })).toBeVisible();
		await expect.element(screen.getByText('Yl', { exact: true })).toBeVisible();
	});

	it('exposes the FreeCut channel modes when WebGPU is active', async () => {
		const screen = await render(ColorScopes, { itemId: 'clip' });
		const section = screen.container.querySelector<HTMLElement>('[data-scope-backend]');
		expect(section).not.toBeNull();
		if (!section) return;
		await vi.waitFor(() => expect(section.dataset.scopeBackend).toMatch(/^(cpu|webgpu)$/));
		if (section.dataset.scopeBackend !== 'webgpu') {
			await expect.element(screen.getByRole('button', { name: 'Y' })).not.toBeInTheDocument();
			return;
		}
		await expect.element(screen.getByRole('button', { name: 'RGB' })).toBeVisible();
		await screen.getByRole('button', { name: 'Y' }).click();
		expect(screen.getByRole('button', { name: 'Y' }).element().getAttribute('aria-pressed')).toBe(
			'true'
		);
	});
});
