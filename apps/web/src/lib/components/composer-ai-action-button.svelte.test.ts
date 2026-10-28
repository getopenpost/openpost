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
	it('prevents a second request while generation is running', async () => {
		const props = { ...buttonProps(true), building: true };
		const screen = await render(ComposerAIActionButton, props);
		await expect.element(screen.getByRole('button', { name: props.buildingLabel })).toBeDisabled();
		expect(props.onclick).not.toHaveBeenCalled();
	});
});
