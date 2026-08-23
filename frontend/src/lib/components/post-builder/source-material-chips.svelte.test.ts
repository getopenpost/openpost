import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { postBuilderCopy } from '$lib/post-builder';
import SourceMaterialChips from './source-material-chips.svelte';

describe('SourceMaterialChips', () => {
	it('lets the user remove a source that is still processing', async () => {
		const onRemove = vi.fn();
		const source = {
			id: 'media-1',
			kind: 'video' as const,
			label: 'demo.mp4',
			status: 'processing' as const
		};
		const screen = await render(SourceMaterialChips, {
			props: {
				sources: [source],
				copy: postBuilderCopy(),
				onRemove
			}
		});

		await screen.getByRole('button', { name: 'Remove source: demo.mp4' }).click();

		expect(onRemove).toHaveBeenCalledWith(source);
	});
});
