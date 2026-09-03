import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AIGenerationProgress from './ai-generation-progress.svelte';

describe('AI generation progress', () => {
	it('keeps loading and completion glyphs outside the selected theme pack', async () => {
		const screen = await render(AIGenerationProgress, {
			active: true,
			copy: {
				heading: 'Building your publication',
				description: 'The build is running.'
			},
			phases: [
				{ id: 'brief', label: 'Reading the brief', status: 'complete' },
				{ id: 'draft', label: 'Writing drafts', status: 'active' }
			]
		});

		expect(screen.container.querySelector('[data-protected-icon="loading"]')).not.toBeNull();
		expect(screen.container.querySelector('[data-protected-icon="success"]')).not.toBeNull();
		expect(screen.container.querySelector('[data-theme-icon]')).toBeNull();
	});
});
