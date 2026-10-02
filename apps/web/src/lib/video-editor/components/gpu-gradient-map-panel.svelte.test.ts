import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { gradientMap } from '../effects/gpu/shaders/color';
import GpuGradientMapPanel from './gpu-gradient-map-panel.svelte';
import '../../../routes/layout.css';

it.each([256, 144])('keeps every custom stop number visible in a %spx panel', async (width) => {
	const host = document.createElement('div');
	host.style.width = `${width}px`;
	document.body.append(host);
	try {
		const screen = await render(GpuGradientMapPanel, {
			target: host,
			props: {
				effectLabel: 'Gradient Map',
				definition: gradientMap,
				values: {
					preset: 'custom',
					customStops: '#000000,#ff0000,#00ff00,#0000ff,#888888,#ffffff',
					mix: 1
				},
				oncommit: vi.fn(),
				ondraft: vi.fn(),
				keyframe: () => undefined
			}
		});
		await document.fonts.ready;
		for (let number = 1; number <= 6; number++) {
			const label = screen.getByText(new RegExp(`^Custom Stops\\s*${number}$`)).element();
			const text = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
			let numberNode: Node | null = null;
			while (text.nextNode()) {
				if (
					text.currentNode.textContent?.trim() === `${number}` ||
					text.currentNode.textContent?.trim().endsWith(`${number}`)
				) {
					numberNode = text.currentNode;
				}
			}
			expect(numberNode).not.toBeNull();
			const offset = numberNode!.textContent!.lastIndexOf(`${number}`);
			const range = document.createRange();
			range.setStart(numberNode!, offset);
			range.setEnd(numberNode!, offset + `${number}`.length);
			const glyph = range.getBoundingClientRect();
			const bounds = label.getBoundingClientRect();
			expect(glyph.left).toBeGreaterThanOrEqual(bounds.left);
			expect(glyph.right).toBeLessThanOrEqual(bounds.right);
			expect(bounds.right).toBeLessThanOrEqual(host.getBoundingClientRect().right);
		}
	} finally {
		host.remove();
	}
});
