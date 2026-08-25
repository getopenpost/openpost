import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import * as importModule from '$lib/video-editor/media/import.svelte';
import * as lottieApi from '$lib/video-editor/lottie/lottiefiles-api';
import LottieBrowserPanel from './lottie-browser-panel.svelte';

beforeEach(() => {
	vi.spyOn(importModule, 'importRemoteLottie').mockResolvedValue('media-id');
	vi.spyOn(lottieApi, 'fetchLottieAnimations').mockResolvedValue({
		items: [
			{
				id: '42',
				name: 'Wave hello',
				lottieUrl: 'https://assets-v2.lottiefiles.com/wave.lottie',
				gifUrl: null,
				bgColor: '#ffffff',
				author: 'Ada',
				authorPath: '/ada'
			}
		],
		endCursor: null,
		hasNextPage: false,
		totalCount: 1
	});
});

describe('LottieBrowserPanel', () => {
	it('loads, attributes, and imports a public animation in a compact asset panel', async () => {
		const screen = await render(LottieBrowserPanel, { projectId: 'project' });
		await expect.element(screen.getByText('Wave hello')).toBeVisible();
		await screen.getByRole('button', { name: 'Add to media' }).click();
		await vi.waitFor(() => expect(importModule.importRemoteLottie).toHaveBeenCalledTimes(1));
		expect(importModule.importRemoteLottie).toHaveBeenCalledWith({
			projectId: 'project',
			url: 'https://assets-v2.lottiefiles.com/wave.lottie',
			fileName: 'Wave hello',
			attribution: expect.objectContaining({
				provider: 'LottieFiles',
				author: 'Ada',
				licenseUrl: 'https://lottiefiles.com/page/license'
			})
		});
		await expect.element(screen.getByRole('button', { name: 'Added to media' })).toBeVisible();

		screen.container.style.width = '280px';
		const panel = screen.container.querySelector('[aria-label="LottieFiles"]');
		expect(panel).not.toBeNull();
		if (panel) expect(panel.scrollWidth).toBeLessThanOrEqual(280);
	});
});
