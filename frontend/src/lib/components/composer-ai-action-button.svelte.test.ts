import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ComposerAIActionButton from './composer-ai-action-button.svelte';

const originalIconPack = document.documentElement.getAttribute('data-theme-icon-pack');

afterEach(() => {
	if (originalIconPack)
		document.documentElement.setAttribute('data-theme-icon-pack', originalIconPack);
	else document.documentElement.removeAttribute('data-theme-icon-pack');
});

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
		expect(buttonElement.getAttribute('data-action-intent')).toBe('primary');
		expect(screen.container.querySelectorAll('[data-ai-action-pill]')).toHaveLength(2);
		await ideateButton.click();
		expect(ideateProps.onclick).toHaveBeenCalledOnce();

		await screen.rerender(buttonProps(true));
		const buildButton = screen.getByRole('button', { name: 'Build with AI' });

		await expect.element(buildButton).toBeVisible();
		expect(buildButton.element()).toBe(buttonElement);
		expect(buttonElement.getAttribute('data-action-intent')).toBe('ordinary');
		expect(screen.container.querySelectorAll('button')).toHaveLength(1);
	});

	it('uses the active theme pack for AI actions while keeping progress protected', async () => {
		document.documentElement.setAttribute('data-theme-icon-pack', 'tabler');
		const screen = await render(ComposerAIActionButton, {
			...buttonProps(false),
			building: true
		});

		await vi.waitFor(() => {
			const actionIcons = screen.container.querySelectorAll('[data-theme-icon="sparkles"]');
			expect(actionIcons.length).toBeGreaterThan(0);
			for (const icon of actionIcons) expect(icon.getAttribute('data-icon-pack')).toBe('tabler');
			const ideaIcons = screen.container.querySelectorAll('[data-theme-icon="idea"]');
			expect(ideaIcons.length).toBeGreaterThan(0);
			for (const icon of ideaIcons) expect(icon.getAttribute('data-icon-pack')).toBe('tabler');
		});
		expect(
			screen.container.querySelectorAll('[data-protected-icon="loading"]').length
		).toBeGreaterThan(0);
		expect(screen.container.querySelector('[data-theme-icon="loading"]')).toBeNull();
	});
});
