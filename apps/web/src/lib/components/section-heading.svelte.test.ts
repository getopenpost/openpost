import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';
import SectionHeading from './section-heading.svelte';

function textSnippet(text: string) {
	return createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));
}

describe('SectionHeading', () => {
	it('forwards id so section aria-labelledby wiring keeps working', async () => {
		const screen = await render(SectionHeading, {
			level: 2,
			size: 'section',
			id: 'workspace-templates-heading',
			children: textSnippet('Workspace templates')
		});

		await expect
			.element(screen.getByRole('heading', { name: 'Workspace templates' }))
			.toHaveAttribute('id', 'workspace-templates-heading');
	});
});
