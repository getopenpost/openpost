import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SampleCampaign from './sample-campaign.svelte';

function renderCampaign() {
	return render(SampleCampaign, {
		onSkip: vi.fn(),
		onContinue: vi.fn(),
		continueLabel: 'See account setup'
	});
}

describe('SampleCampaign', () => {
	it('labels the campaign as local and separates the canonical brief from renditions', async () => {
		const screen = await renderCampaign();

		await expect
			.element(screen.getByRole('heading', { level: 1, name: 'Review an agent-prepared campaign' }))
			.toBeVisible();
		await expect.element(screen.getByText('Illustrative sample')).toBeVisible();
		await expect
			.element(
				screen.getByRole('heading', { name: 'Launch OpenPost with proof, not a generic claim' })
			)
			.toBeVisible();
		await expect
			.element(screen.getByText(/This sample makes no campaign or provider calls/))
			.toBeVisible();
		await expect
			.element(screen.getByRole('tab', { name: /X/ }))
			.toHaveAttribute('aria-selected', 'true');
	});

	it('shows distinct destination copy and returns edited content to review', async () => {
		const screen = await renderCampaign();

		await screen.getByRole('tab', { name: /LinkedIn/ }).click();
		const editor = screen.getByRole('textbox', { name: 'LinkedIn rendition' });
		await expect.element(screen.getByText(/AI can write a launch post/).first()).toBeVisible();

		await screen.getByRole('button', { name: 'Mark reviewed' }).click();
		await expect.element(screen.getByText('1 of 5 reviewed')).toBeVisible();

		await editor.fill('A reviewed rendition changed after approval.');
		await expect.element(screen.getByText('0 of 5 reviewed')).toBeVisible();
		await expect
			.element(screen.getByText('A reviewed rendition changed after approval.'))
			.toBeVisible();
	});

	it('completes a five-destination human review without a publish action', async () => {
		const screen = await renderCampaign();

		for (const platform of ['X', 'LinkedIn', 'Bluesky', 'Mastodon', 'Threads']) {
			await screen.getByRole('tab', { name: new RegExp(platform) }).click();
			await screen.getByRole('button', { name: 'Mark reviewed' }).click();
		}

		await expect.element(screen.getByText('5 of 5 reviewed')).toBeVisible();
		await expect.element(screen.getByText('All five sample renditions are reviewed')).toBeVisible();
		expect(screen.getByRole('button', { name: /publish/i })).toHaveLength(0);
		expect(screen.getByRole('button', { name: /schedule/i })).toHaveLength(0);
	});

	it('keeps skip and continuation under the parent navigation contract', async () => {
		const onSkip = vi.fn();
		const onContinue = vi.fn();
		const screen = await render(SampleCampaign, {
			onSkip,
			onContinue,
			continueLabel: 'Continue plan setup'
		});

		await screen.getByRole('button', { name: 'Skip sample' }).click();
		await screen.getByRole('button', { name: 'Continue plan setup' }).click();

		expect(onSkip).toHaveBeenCalledOnce();
		expect(onContinue).toHaveBeenCalledOnce();
	});
});
