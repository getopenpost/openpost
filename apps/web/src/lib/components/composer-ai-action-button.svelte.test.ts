import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ComposerAIActionButton from './composer-ai-action-button.svelte';
import '../../routes/layout.css';

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
	it('reserves the same action width while building with a longer localized label', async () => {
		const props = { ...buttonProps(true), buildingLabel: 'Preparing your destination drafts...' };
		const screen = await render(ComposerAIActionButton, props);
		const button = screen.getByRole('button', { name: props.buildLabel }).element();
		await expect.poll(() => button.getBoundingClientRect().width).toBeGreaterThan(40);
		await Promise.all(button.getAnimations().map((animation) => animation.finished));
		const width = button.getBoundingClientRect().width;
		await screen.rerender({ ...props, building: true });
		await expect
			.element(screen.getByRole('button', { name: props.buildingLabel }))
			.toHaveAttribute('aria-busy', 'true');
		await Promise.all(button.getAnimations().map((animation) => animation.finished));
		expect(Math.abs(button.getBoundingClientRect().width - width)).toBeLessThan(1);
	});
	it('keeps one button while its action changes with the source text', async () => {
		const ideateProps = buttonProps(false);
		const screen = await render(ComposerAIActionButton, ideateProps);
		const ideateButton = screen.getByRole('button', { name: 'Ideate' });
		const buttonElement = ideateButton.element();

		await expect.element(ideateButton).toBeVisible();
		expect(buttonElement.getAttribute('data-action-intent')).toBe('primary');
		await ideateButton.click();
		expect(ideateProps.onclick).toHaveBeenCalledOnce();

		await screen.rerender(buttonProps(true));
		const buildButton = screen.getByRole('button', { name: 'Build with AI' });

		await expect.element(buildButton).toBeVisible();
		expect(buildButton.element()).toBe(buttonElement);
		expect(buttonElement.getAttribute('data-action-intent')).toBe('ordinary');
		expect(screen.container.querySelectorAll('button')).toHaveLength(1);
	});
});
