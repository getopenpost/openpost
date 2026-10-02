import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Field from './field.svelte';

it('previews interpolated JSON as valid JSON', async () => {
	const phrase = 'He said "Café"\\folder\n東京 👋';
	const screen = await render(Field, {
		id: 'workflow-fields',
		label: 'Fields (JSON)',
		json: true,
		value: {
			literal:
				'{"copied":"{{source.phrase}}","nested":["prefix {{source.phrase}} suffix"],"scalars":"{{source.number}}/{{source.flag}}"}'
		},
		references: [
			{ value: 'source.phrase', label: 'Phrase' },
			{ value: 'source.number', label: 'Number' },
			{ value: 'source.flag', label: 'Flag' }
		],
		data: { source: { phrase, number: 7, flag: false } },
		onchange: () => {}
	});

	const preview = screen.container.querySelector('pre');
	expect(preview).not.toBeNull();
	expect(JSON.parse(preview!.textContent!)).toEqual({
		copied: phrase,
		nested: [`prefix ${phrase} suffix`],
		scalars: '7/false'
	});
});

it('preserves typed whole-value JSON references and hides malformed JSON previews', async () => {
	const object = { phrase: '"quoted"\\path\n東京', values: [1, false, null] };
	const screen = await render(Field, {
		id: 'workflow-fields',
		label: 'Fields (JSON)',
		json: true,
		value: { reference: 'source.object' },
		references: [
			{ value: 'source.object', label: 'Object' },
			{ value: 'source.array', label: 'Array' }
		],
		data: { source: { object, array: [object, 2, false, null] } },
		onchange: () => {}
	});
	expect(JSON.parse(screen.container.querySelector('pre')!.textContent!)).toEqual(object);
	await screen.rerender({ value: { reference: 'source.array' } });
	expect(JSON.parse(screen.container.querySelector('pre')!.textContent!)).toEqual([
		object,
		2,
		false,
		null
	]);
	await screen.rerender({
		value: { literal: '{"copied":"{{source.object}}"}' }
	});
	expect(screen.container.querySelector('pre')).toBeNull();
	await screen.rerender({
		value: { literal: '{"copied":"{{source.object}}"' }
	});
	expect(screen.container.querySelector('pre')).toBeNull();
	await expect.element(screen.getByRole('status')).toHaveTextContent('Enter valid JSON.');
});
