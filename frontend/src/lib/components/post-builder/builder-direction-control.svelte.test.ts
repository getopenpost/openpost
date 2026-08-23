import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { PostBuilderDirection } from '$lib/post-builder';
import BuilderDirectionControl from './builder-direction-control.svelte';

describe('BuilderDirectionControl', () => {
	it('opens when the direction comes from reactive parent state', async () => {
		const direction = new Proxy<PostBuilderDirection>(
			{ goal: 'Build authority', destinationStrategy: 'recommend' },
			{}
		);
		const screen = await render(BuilderDirectionControl, {
			props: {
				direction,
				onChange: vi.fn()
			}
		});

		await screen.getByRole('button', { name: 'Direction: 1 choice' }).click();

		await expect.element(screen.getByRole('dialog', { name: 'Set direction' })).toBeVisible();
	});
});
