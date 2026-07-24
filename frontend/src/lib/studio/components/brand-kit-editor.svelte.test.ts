import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import BrandKitEditor from './brand-kit-editor.svelte';
import type { StudioBrandKit } from '../types';

const kit: StudioBrandKit = {
	id: 'brand-kit-1',
	workspace_id: 'workspace-1',
	name: 'OpenPost',
	revision: 1,
	exists: true,
	can_edit: true,
	colors: [{ id: 'color-1', name: 'Primary', value: '#f97316' }],
	backgrounds: ['#ffffff'],
	text_styles: [
		{
			id: 'text-style-1',
			name: 'Heading',
			font_family: 'Geist Variable',
			font_weight: 700,
			font_style: 'normal',
			font_size: 64,
			color: '#171717',
			line_height: 1.1,
			letter_spacing: 0
		}
	],
	assets: [],
	fonts: []
};

describe('BrandKitEditor', () => {
	it('keeps editable rows mounted while their values change', async () => {
		const screen = await render(BrandKitEditor, {
			kit,
			onSaved: vi.fn()
		});
		const colorName = screen.getByPlaceholder('Color name');

		await colorName.fill('');
		await colorName.click();
		await userEvent.keyboard('Accent');

		await expect.element(colorName).toHaveValue('Accent');
		await expect.element(colorName).toHaveFocus();
	});
});
