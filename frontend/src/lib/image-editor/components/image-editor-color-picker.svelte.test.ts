import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { OpenPostEyeDropper } from '$lib/browser-capabilities';
import ImageEditorColorPicker from './image-editor-color-picker.svelte';

describe('OpenPost Image EditorColorPicker', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		delete window.EyeDropper;
		document.documentElement.removeAttribute('data-theme-icon-pack');
	});

	afterEach(() => {
		document.documentElement.removeAttribute('data-theme-icon-pack');
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
		window.EyeDropper = class implements OpenPostEyeDropper {
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

	it('themes the selected swatch without replacing the editor eyedropper glyph', async () => {
		window.EyeDropper = class implements OpenPostEyeDropper {
			async open(): Promise<{ sRGBHex: string }> {
				return { sRGBHex: '#ff8800' };
			}
		};
		document.documentElement.setAttribute('data-theme-icon-pack', 'tabler');
		const screen = await render(ImageEditorColorPicker, {
			label: 'Page background',
			value: '#ff8800',
			brandColors: [{ id: 'orange', name: 'OpenPost orange', value: '#ff8800' }],
			onChange: vi.fn()
		});

		await screen.getByRole('button', { name: 'Page background' }).click();
		await vi.waitFor(() => {
			const selectedSwatch = document.querySelector('[data-theme-icon="check"]');
			expect(selectedSwatch?.getAttribute('data-icon-pack')).toBe('tabler');
		});

		const eyedropper = screen
			.getByRole('button', {
				name: 'Pick a color from the screen'
			})
			.element();
		const eyedropperGlyph = eyedropper.querySelector('svg');
		expect(eyedropperGlyph?.getAttribute('data-theme-icon')).toBeNull();
		expect(eyedropperGlyph?.getAttribute('data-protected-icon')).toBeNull();
		expect(document.querySelector('[data-protected-icon="success"]')).toBeNull();
	});
});
