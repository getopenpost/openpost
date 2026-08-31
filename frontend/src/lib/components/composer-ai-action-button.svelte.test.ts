import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ComposerAIActionButton from './composer-ai-action-button.svelte';

function buttonProps(hasText: boolean) {
	return {
		hasText,
		building: false,
		disabled: false,
		ideateLabel: 'Ideate',
		buildLabel: 'Build with AI',
		buildingLabel: 'Building...',
		onclick: vi.fn()
	};
}

describe('ComposerAIActionButton', () => {
	it('keeps one button while its action changes with the source text', async () => {
		const ideateProps = buttonProps(false);
		const screen = await render(ComposerAIActionButton, ideateProps);
		const ideateButton = screen.getByRole('button', { name: 'Ideate' });
		const buttonElement = ideateButton.element();

		await expect.element(ideateButton).toBeVisible();
		expect(buttonElement.className).toContain('bg-primary');
		expect(screen.container.querySelectorAll('[data-ai-action-pill]')).toHaveLength(2);
		await ideateButton.click();
		expect(ideateProps.onclick).toHaveBeenCalledOnce();

		await screen.rerender(buttonProps(true));
		const buildButton = screen.getByRole('button', { name: 'Build with AI' });

		await expect.element(buildButton).toBeVisible();
		expect(buildButton.element()).toBe(buttonElement);
		expect(buttonElement.className).toContain('bg-secondary');
		expect(screen.container.querySelectorAll('button')).toHaveLength(1);
	});
});
