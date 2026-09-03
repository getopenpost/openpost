import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { ImageEditorBrandKit } from '../types';
import BrandKitEditor from './brand-kit-editor.svelte';

const emptyBrandKit: ImageEditorBrandKit = {
	id: 'brand-kit',
	workspace_id: 'workspace',
	name: 'Brand kit',
	revision: 1,
	exists: true,
	can_edit: true,
	colors: [],
	text_styles: [],
	backgrounds: [],
	fonts: []
};

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	document.documentElement.removeAttribute('data-theme-icon-pack');
});

describe('BrandKitEditor icons', () => {
	it('themes font actions while keeping upload progress protected', async () => {
		vi.stubGlobal(
			'FontFace',
			class {
				load(): Promise<never> {
					return new Promise(() => undefined);
				}
			}
		);
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pending-font');
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
		document.documentElement.setAttribute('data-theme-icon-pack', 'tabler');
		const screen = await render(BrandKitEditor, {
			kit: emptyBrandKit,
			onSaved: vi.fn()
		});

		await vi.waitFor(() => {
			const upload = screen.container.querySelector('[data-theme-icon="upload"]');
			expect(upload?.getAttribute('data-icon-pack')).toBe('tabler');
		});
		await screen.getByText('Add a custom font').click();
		await screen.getByRole('textbox', { name: 'Family name' }).fill('Test Face');
		await screen.getByRole('checkbox').click();
		await screen
			.getByLabelText('Upload font')
			.upload(new File(['font'], 'test.woff2', { type: 'font/woff2' }));

		await vi.waitFor(() => {
			expect(screen.container.querySelector('[data-protected-icon="loading"]')).not.toBeNull();
		});
		expect(screen.container.querySelector('[data-theme-icon="loading"]')).toBeNull();
	});
});
