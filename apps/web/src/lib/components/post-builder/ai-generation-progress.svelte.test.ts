import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AIGenerationProgress from './ai-generation-progress.svelte';
import '../../../routes/layout.css';

describe('AIGenerationProgress', () => {
	it('announces the active phase and completion without making the whole step list live', async () => {
		const screen = await render(AIGenerationProgress, {
			phases: [
				{ id: 'brief', label: 'Brief', status: 'complete' },
				{ id: 'drafts', label: 'Drafts', status: 'active' },
				{ id: 'review', label: 'Review', status: 'pending' }
			],
			copy: { heading: 'Building', description: 'Working' },
			active: true
		});

		await expect
			.element(screen.getByTestId('ai-generation-progress'))
			.toHaveAttribute('aria-busy', 'true');
		await expect.element(screen.getByRole('status')).toHaveTextContent('Drafts');
		await expect
			.element(screen.getByTestId('ai-generation-progress'))
			.not.toHaveAttribute('aria-live', 'polite');
		await screen.rerender({
			active: false,
			phases: [{ id: 'brief', label: 'Brief', status: 'complete' }],
			message: 'Draft ready'
		});
		await expect.element(screen.getByRole('status')).toHaveTextContent('Draft ready');
		await expect
			.element(screen.getByTestId('ai-generation-progress'))
			.toHaveAttribute('aria-busy', 'false');
	});
});
