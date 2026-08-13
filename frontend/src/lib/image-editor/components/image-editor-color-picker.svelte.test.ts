import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ImageEditorColorPicker from './image-editor-color-picker.svelte';

describe('OpenPost Image EditorColorPicker', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		delete (globalThis as any).window.EyeDropper;
	});

	it('keeps hex, HSL, and RGB drafts synchronized without falling back to black', async () => {
		const onChange = vi.fn();
		const screen = await render(ImageEditorColorPicker, {
			label: 'Page background',
			value: '#1e1e1e',
			brandColors: [{ id: 'orange', name: 'OpenPost orange', value: '#ff8800' }],
			onChange
		});

		await screen.getByRole('button', { name: 'Page background' }).click();
		await screen.getByRole('button', { name: 'OpenPost orange: #ff8800' }).click();

		expect(onChange).toHaveBeenLastCalledWith('#ff8800');
		await expect.element(screen.getByRole('textbox', { name: 'Hex color' })).toHaveValue('#FF8800');

		await screen.getByRole('button', { name: 'rgb' }).click();
		const channelInputs = [
			...document.querySelectorAll<HTMLInputElement>('input[inputmode="numeric"]')
		];
		expect(channelInputs.map((input) => input.value)).toEqual(['255', '136', '0']);
		expect(onChange).not.toHaveBeenCalledWith('#000000');
	});

	it('applies the picked screen color through onChange when EyeDropper is supported', async () => {
		const onChange = vi.fn();
		(globalThis as any).window.EyeDropper = class {
			async open(): Promise<{ sRGBHex: string }> {
				return { sRGBHex: '#abcdef' };
			}
		};
		const screen = await render(ImageEditorColorPicker, {
			label: 'Workspace color',
			value: '#f97316',
			onChange
		});

		await screen.getByRole('button', { name: 'Workspace color' }).click();
		await screen.getByRole('button', { name: 'Pick a color from the screen' }).click();
		await vi.waitFor(() => {
			expect(onChange).toHaveBeenCalledWith('#abcdef');
		});
	});

	it('hides the screen color picker when EyeDropper is unavailable', async () => {
		const screen = await render(ImageEditorColorPicker, {
			label: 'Workspace color',
			value: '#f97316',
			onChange: vi.fn()
		});

		await screen.getByRole('button', { name: 'Workspace color' }).click();
		const pipette = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
			(button) => button.getAttribute('aria-label') === 'Pick a color from the screen'
		);
		expect(pipette).toBeUndefined();
	});
});
