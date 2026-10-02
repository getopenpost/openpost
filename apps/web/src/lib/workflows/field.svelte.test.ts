import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
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

it('replaces the empty list default with a typed array from the ordinary variable picker', async () => {
	const onchange = vi.fn();
	const screen = await render(Field, {
		id: 'workflow-items',
		label: 'Items',
		json: true,
		value: { literal: [] },
		references: [{ value: 'parse.data', label: 'Parse JSON: data' }],
		data: {
			parse: {
				data: [
					{ title: 'B', score: 2 },
					{ title: 'A', score: 1 }
				]
			}
		},
		onchange
	});
	await screen.getByRole('button', { name: 'Insert variable', exact: true }).click();
	await screen.getByRole('option', { name: 'Parse JSON: data' }).click();
	expect(onchange).toHaveBeenLastCalledWith({ reference: 'parse.data' });
	await screen.rerender({ value: { reference: 'parse.data' } });
	expect(JSON.parse(screen.container.querySelector('pre')!.textContent!)).toEqual([
		{ title: 'B', score: 2 },
		{ title: 'A', score: 1 }
	]);
	expect(screen.container.querySelector('[role="status"]')).toBeNull();
});

it('keeps caret insertion inside authored JSON rather than replacing the object', async () => {
	const onchange = vi.fn();
	const screen = await render(Field, {
		id: 'workflow-fields',
		label: 'Fields (JSON)',
		json: true,
		value: { literal: '{"copied":""}' },
		references: [{ value: 'source.title', label: 'Title' }],
		data: { source: { title: 'Café' } },
		onchange
	});
	await screen.getByRole('textbox', { name: 'Fields (JSON)', exact: true }).click();
	await userEvent.keyboard('{End}{ArrowLeft}{ArrowLeft}');
	await screen.getByRole('button', { name: 'Insert variable', exact: true }).click();
	await screen.getByRole('option', { name: /^Title/ }).click();
	expect(onchange).toHaveBeenLastCalledWith({ literal: '{"copied":"{{source.title}}"}' });
});
