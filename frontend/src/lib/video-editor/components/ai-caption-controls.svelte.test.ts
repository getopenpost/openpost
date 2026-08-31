import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import AiCaptionControls from './ai-caption-controls.svelte';

describe('AiCaptionControls chrome', () => {
	it('renders generate action without overflow at 320', async () => {
		await page.viewport(320, 720);
		const onstart = vi.fn();
		const oncancel = vi.fn();
		const screen = await render(AiCaptionControls, {
			canGenerate: true,
			busy: false,
			progress: null,
			error: null,
			onstart,
			oncancel
		});
		const button = screen.getByRole('button', { name: 'Generate AI captions' });
		await expect.element(button).toBeVisible();
		await expect.element(button).toBeEnabled();
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(320);
		expect(screen.container.scrollHeight).toBeGreaterThan(0);
		await button.click();
		expect(onstart).toHaveBeenCalledOnce();
	});

	it('keeps controls usable at 390 and in dark theme without overflow', async () => {
		await page.viewport(390, 720);
		document.documentElement.classList.add('dark');
		const screen = await render(AiCaptionControls, {
			canGenerate: true,
			busy: false,
			progress: null,
			error: null,
			onstart: vi.fn(),
			oncancel: vi.fn()
		});
		await expect.element(screen.getByText('AI scene captions')).toBeVisible();
		await expect.element(screen.getByText('Local vision model')).toBeVisible();
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(390);
		const button = screen.getByRole('button', { name: 'Generate AI captions' });
		await expect.element(button).toBeVisible();
		document.documentElement.classList.remove('dark');
	});

	it('shows staged progress with accessible progressbar and turns main action into cancel', async () => {
		const oncancel = vi.fn();
		const screen = await render(AiCaptionControls, {
			canGenerate: true,
			busy: true,
			status: 'running',
			progress: { stage: 'captioning', percent: 42 },
			error: null,
			onstart: vi.fn(),
			oncancel
		});
		const progress = screen.getByRole('progressbar', { name: 'Describing scenes' }).element();
		expect(progress.getAttribute('aria-valuenow')).toBe('42');
		await expect.element(screen.getByText('42%')).toBeVisible();
		const cancel = screen.getByRole('button', { name: 'Cancel transcription' });
		await expect.element(cancel).toBeVisible();
		await cancel.click();
		expect(oncancel).toHaveBeenCalledOnce();
	});

	it('shows queued position, error alert, and keeps cancel reachable at 320', async () => {
		await page.viewport(320, 720);
		const oncancel = vi.fn();
		const screen = await render(AiCaptionControls, {
			canGenerate: true,
			busy: true,
			status: 'queued',
			queuePosition: 2,
			queueTotal: 3,
			progress: null,
			error: 'AI captioning failed.',
			onstart: vi.fn(),
			oncancel
		});
		await expect.element(screen.getByText('Queued 2 of 3')).toBeVisible();
		await expect.element(screen.getByRole('alert')).toHaveTextContent('AI captioning failed.');
		const cancel = screen.getByRole('button', { name: 'Cancel transcription' });
		await expect.element(cancel).toBeVisible();
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(320);
		await cancel.click();
		expect(oncancel).toHaveBeenCalledOnce();
	});

	it('disables generate without a selected media clip and exposes accessible labels', async () => {
		const screen = await render(AiCaptionControls, {
			canGenerate: false,
			busy: false,
			progress: null,
			error: null,
			onstart: vi.fn(),
			oncancel: vi.fn()
		});
		await expect
			.element(screen.getByRole('button', { name: 'Generate AI captions' }))
			.toBeDisabled();
		await expect
			.element(screen.getByText('Describe sampled scenes with the on-device caption model'))
			.toBeVisible();
	});
});
