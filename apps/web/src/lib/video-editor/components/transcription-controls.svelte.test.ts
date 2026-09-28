import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import TranscriptionControls from './transcription-controls.svelte';

it('starts captions with the chosen language while keeping engine settings optional', async () => {
	const onstart = vi.fn();
	const screen = await render(TranscriptionControls, {
		canTranscribe: true,
		busy: false,
		progress: null,
		backend: null,
		fallback: null,
		onstart,
		oncancel: vi.fn()
	});
	await expect
		.element(screen.getByRole('button', { name: 'Speech model', exact: true }))
		.not.toBeInTheDocument();
	await screen.getByRole('button', { name: 'Language', exact: true }).click();
	await screen.getByRole('option', { name: 'English', exact: true }).click();
	await screen.getByRole('button', { name: 'Auto-captions', exact: true }).click();
	expect(onstart).toHaveBeenCalledWith(expect.objectContaining({ language: 'en' }));
	await screen.getByRole('button', { name: 'Advanced', exact: true }).click();
	await expect
		.element(screen.getByRole('button', { name: 'Speech model', exact: true }))
		.toBeVisible();
	await expect
		.element(screen.getByRole('button', { name: 'Model quality', exact: true }))
		.toBeVisible();
});

it('leaves room for existing words and keeps generation errors visible', async () => {
	const screen = await render(TranscriptionControls, {
		hasTranscript: true,
		canTranscribe: true,
		busy: false,
		progress: null,
		backend: null,
		fallback: null,
		onstart: vi.fn(),
		oncancel: vi.fn()
	});
	await expect
		.element(screen.getByRole('button', { name: 'Language', exact: true }))
		.not.toBeInTheDocument();
	await screen.getByRole('button', { name: 'Auto-captions', exact: true }).click();
	await expect.element(screen.getByRole('button', { name: 'Language', exact: true })).toBeVisible();
	await screen.getByRole('button', { name: 'Auto-captions', exact: true }).first().click();
	await screen.rerender({ error: 'Model download failed' });
	await expect.element(screen.getByRole('alert')).toHaveTextContent('Model download failed');
});
