import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import FilmstripTile from './filmstrip-tile.svelte';

describe('FilmstripTile', () => {
	it('falls back to the persisted frame when its bitmap was detached', async () => {
		const source = document.createElement('canvas');
		source.width = 2;
		source.height = 2;
		source.getContext('2d')?.fillRect(0, 0, 2, 2);
		const bitmap = await createImageBitmap(source);
		bitmap.close();

		const screen = await render(FilmstripTile, {
			bitmap,
			url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
			style: 'left: 0'
		});

		expect(screen.container.querySelector('[data-filmstrip-tile]')?.tagName).toBe('IMG');
	});
});
