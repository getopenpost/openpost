import { beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import RepurposePanel from './RepurposePanel.svelte';
import type { prepareRepurposePreview } from '../repurpose-preview';
import type { RepurposeReviewContext } from '../repurpose-review.svelte';

const api = vi.hoisted(() => ({
	request: vi.fn(),
	read: vi.fn(),
	change: vi.fn(),
	create: vi.fn(),
	preview: vi.fn()
}));
// Deterministic responses exercise stale network completion through the real review controller.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$lib/query/repurpose', () => ({
	requestRepurposeSuggestions: api.request,
	readRepurposeSuggestions: api.read,
	changeRepurposeSuggestions: api.change
}));
// Project storage has its own real OPFS and route coverage; this boundary observes explicit admission.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('../repurpose-projects', () => ({ createRepurposeProjects: api.create }));
// Control a late media completion without adding a test-only injection prop to the product.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('../repurpose-preview', () => ({ prepareRepurposePreview: api.preview }));

function context(): RepurposeReviewContext {
	return {
		actorId: 'person',
		workspaceId: 'workspace',
		projectId: 'original',
		storage: 'cloud',
		source: {
			id: 'source',
			name: 'launch.mp4',
			size: 10,
			mimeType: 'video/mp4',
			duration: 20,
			width: 640,
			height: 360,
			videoCodec: 'avc',
			audioCodec: 'aac',
			sampleRate: 48000,
			channels: 1,
			rotation: 0,
			fps: 30,
			keyframeTimestamps: [],
			keyframeState: 'unknown',
			videoStreams: [],
			audioStreams: [{ index: 1, codec: 'aac', sampleRate: 48000, channels: 1 }],
			selectedAudioTrackIndices: [1],
			transcript: {
				audioTrackIndex: 1,
				words: [
					{ text: 'Before', start: 0, end: 1 },
					{ text: 'The useful lesson', start: 2, end: 4 },
					{ text: 'The example', start: 5, end: 7 },
					{ text: 'After', start: 8, end: 10 }
				]
			}
		}
	};
}
function ready(
	request: { source: { id: string; revision: string } },
	candidates = [
		{
			id: 'a',
			title: 'Useful lesson',
			rationale: 'A complete thought',
			context_warning: '',
			first_word: 1,
			last_word: 2,
			start: 2,
			end: 7
		},
		{
			id: 'b',
			title: 'The example',
			rationale: 'A specific example',
			context_warning: 'Review the introduction',
			first_word: 2,
			last_word: 2,
			start: 5,
			end: 7
		}
	]
) {
	return {
		id: 'suggestion',
		revision: 1,
		workspace_id: 'workspace',
		source_id: request.source.id,
		source_revision: request.source.revision,
		state: 'ready',
		candidates,
		updated_at: '2026-10-03T10:00:00Z'
	};
}
beforeEach(() => {
	localStorage.clear();
	vi.clearAllMocks();
	api.request.mockImplementation(async (request) => ready(request));
});

test('reviews, adjusts and excludes candidates before explicitly creating independent projects', async () => {
	const current = context();
	const screen = await render(RepurposePanel, {
		props: { context: current, onsave: vi.fn(), onback: vi.fn() }
	});
	await screen.getByRole('button', { name: 'Find clips', exact: true }).click();
	await expect
		.element(screen.getByRole('button', { name: 'Useful lesson', exact: true }))
		.toBeVisible();
	expect(api.create).not.toHaveBeenCalled();
	await screen.getByRole('textbox', { name: 'Start', exact: true }).fill('0');
	await userEvent.tab();
	await screen.getByRole('checkbox', { name: 'Include The example', exact: true }).click();
	await screen.getByRole('button', { name: 'Create clips (1)' }).click();
	await expect.poll(() => api.create.mock.calls.length).toBe(1);
	expect(api.create.mock.calls[0]![0].choices).toEqual([
		expect.objectContaining({ id: 'a', start: 0, end: 7 })
	]);
	expect(current.source.transcript?.words[1]?.start).toBe(2);
});

test('invalidates ready review when the transcript changes and restores only matching receipts', async () => {
	const current = context();
	const screen = await render(RepurposePanel, {
		props: { context: current, onsave: vi.fn(), onback: vi.fn() }
	});
	await screen.getByRole('button', { name: 'Find clips', exact: true }).click();
	await expect
		.element(screen.getByRole('button', { name: 'Useful lesson', exact: true }))
		.toBeVisible();
	const changed = structuredClone(current);
	changed.source.transcript!.words[1]!.text = 'Corrected words';
	await screen.rerender({ context: changed });
	await expect
		.element(
			screen.getByText(
				'The source, transcript or audio track changed. Find clips again for this version.'
			)
		)
		.toBeVisible();
	await expect
		.element(screen.getByRole('button', { name: 'Useful lesson', exact: true }))
		.not.toBeInTheDocument();
	expect(api.read).not.toHaveBeenCalled();
	expect(api.create).not.toHaveBeenCalled();
});

test('handles an empty result without creating clips and permits another search', async () => {
	api.request.mockImplementation(async (request) => ready(request, []));
	const screen = await render(RepurposePanel, {
		props: { context: context(), onsave: vi.fn(), onback: vi.fn() }
	});
	await screen.getByRole('button', { name: 'Find clips', exact: true }).click();
	await expect
		.element(
			screen.getByText(
				'No clear standalone clips found. Try a topic, or adjust the transcript and find again.'
			)
		)
		.toBeVisible();
	await expect.element(screen.getByRole('button', { name: 'Find again' })).toBeEnabled();
	expect(api.create).not.toHaveBeenCalled();
});

test('a late AI receipt cannot populate a different workspace', async () => {
	let finish!: (value: ReturnType<typeof ready>) => void;
	api.request.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			})
	);
	const current = context();
	const screen = await render(RepurposePanel, {
		props: { context: current, onsave: vi.fn(), onback: vi.fn() }
	});
	await screen.getByRole('button', { name: 'Find clips', exact: true }).click();
	await expect.poll(() => api.request.mock.calls.length).toBe(1);
	await screen.rerender({ context: { ...current, workspaceId: 'another-workspace' } });
	finish(ready(api.request.mock.calls[0]![0]));
	await expect
		.element(screen.getByRole('button', { name: 'Find clips', exact: true }))
		.toBeEnabled();
	await expect
		.element(screen.getByRole('button', { name: 'Useful lesson', exact: true }))
		.not.toBeInTheDocument();
	expect(api.create).not.toHaveBeenCalled();
});

test('resumes a ready review from the durable suggestion receipt after reopening', async () => {
	const current = context();
	const screen = await render(RepurposePanel, {
		props: { context: current, onsave: vi.fn(), onback: vi.fn() }
	});
	await screen.getByRole('button', { name: 'Find clips', exact: true }).click();
	await expect
		.element(screen.getByRole('button', { name: 'Useful lesson', exact: true }))
		.toBeVisible();
	api.read.mockResolvedValue(ready(api.request.mock.calls[0]![0]));
	await screen.unmount();
	const reopened = await render(RepurposePanel, {
		props: { context: current, onsave: vi.fn(), onback: vi.fn() }
	});
	await expect
		.element(reopened.getByRole('button', { name: 'Useful lesson', exact: true }))
		.toBeVisible();
	expect(api.request).toHaveBeenCalledTimes(1);
	expect(api.read).toHaveBeenCalledWith(
		'workspace',
		'person',
		'suggestion',
		expect.any(AbortSignal)
	);
});

test('shows a failed search and retries the same durable job', async () => {
	api.request.mockImplementation(async (request) => ({
		...ready(request, []),
		state: 'failed',
		error_message: 'The model was unavailable.'
	}));
	api.change.mockImplementation(async (_workspace, _actor, previous) => ({
		...previous,
		state: 'ready',
		error_message: undefined,
		candidates: []
	}));
	const screen = await render(RepurposePanel, {
		props: { context: context(), onsave: vi.fn(), onback: vi.fn() }
	});
	await screen.getByRole('button', { name: 'Find clips', exact: true }).click();
	await expect.element(screen.getByRole('alert')).toHaveTextContent('The model was unavailable.');
	await screen.getByRole('button', { name: 'Try again', exact: true }).click();
	await expect
		.element(
			screen.getByText(
				'No clear standalone clips found. Try a topic, or adjust the transcript and find again.'
			)
		)
		.toBeVisible();
	expect(api.change).toHaveBeenCalledWith(
		'workspace',
		'person',
		expect.objectContaining({ id: 'suggestion', revision: 1 }),
		'retry'
	);
});

test('a delayed cancellation cannot replace a newer completed search', async () => {
	let finishCancel!: (value: ReturnType<typeof ready>) => void;
	api.request.mockImplementationOnce(async (request) => ({
		...ready(request, []),
		id: 'old-search',
		state: 'queued'
	}));
	api.change.mockImplementation(
		() =>
			new Promise((resolve) => {
				finishCancel = resolve;
			})
	);
	const screen = await render(RepurposePanel, {
		props: { context: context(), onsave: vi.fn(), onback: vi.fn() }
	});
	await screen.getByRole('button', { name: 'Find clips', exact: true }).click();
	await screen.getByRole('button', { name: 'Cancel', exact: true }).click();
	await screen.getByRole('button', { name: 'Find again', exact: true }).click();
	await expect
		.element(screen.getByRole('button', { name: 'Useful lesson', exact: true }))
		.toBeVisible();
	finishCancel({
		...ready(api.request.mock.calls[0]![0], []),
		id: 'old-search',
		state: 'cancelled'
	});
	await expect
		.element(screen.getByRole('button', { name: 'Useful lesson', exact: true }))
		.toBeVisible();
	await expect
		.element(screen.getByText('Clip search cancelled. You can find clips again.'))
		.not.toBeInTheDocument();
	expect(
		JSON.parse(
			localStorage.getItem('openpost:repurpose:["person","workspace","original","source","cloud"]')!
		).id
	).toBe('suggestion');
});

test('a cancelled search offers retry without an error message', async () => {
	api.request.mockImplementation(async (request) => ({
		...ready(request, []),
		state: 'cancelled'
	}));
	const screen = await render(RepurposePanel, {
		props: { context: context(), onsave: vi.fn(), onback: vi.fn() }
	});
	await screen.getByRole('button', { name: 'Find clips', exact: true }).click();
	await expect
		.element(screen.getByRole('button', { name: 'Try again', exact: true }))
		.toBeEnabled();
	await expect.element(screen.getByRole('alert')).not.toBeInTheDocument();
});

test('reopening retains completed clip links and only creates remaining candidates', async () => {
	const current = context();
	api.create.mockImplementation(async (input) =>
		input.onCreated({
			candidateId: 'a',
			projectId: '67e0ea31-7157-4c61-8aa5-9f36c7bec6f3',
			name: 'Useful lesson',
			storage: 'cloud'
		})
	);
	const screen = await render(RepurposePanel, {
		props: { context: current, onsave: vi.fn(), onback: vi.fn() }
	});
	await screen.getByRole('button', { name: 'Find clips', exact: true }).click();
	await screen.getByRole('textbox', { name: 'Start', exact: true }).fill('0');
	await userEvent.tab();
	await screen.getByRole('checkbox', { name: 'Include The example', exact: true }).click();
	await screen.getByRole('button', { name: 'Create clips (1)', exact: true }).click();
	await expect.element(screen.getByRole('link', { name: 'Open clip project' })).toBeVisible();
	api.read.mockResolvedValue(ready(api.request.mock.calls[0]![0]));
	await screen.unmount();
	const reopened = await render(RepurposePanel, {
		props: { context: current, onsave: vi.fn(), onback: vi.fn() }
	});
	await expect.element(reopened.getByRole('link', { name: 'Open clip project' })).toBeVisible();
	await expect
		.element(reopened.getByRole('textbox', { name: 'Start', exact: true }))
		.toHaveValue('00:00.00');
	await expect
		.element(reopened.getByRole('checkbox', { name: 'Include The example', exact: true }))
		.not.toBeChecked();
	await reopened.getByRole('checkbox', { name: 'Include The example', exact: true }).click();
	await reopened.getByRole('button', { name: 'Create clips (1)', exact: true }).click();
	expect(api.create.mock.calls[1]![0].choices).toEqual([expect.objectContaining({ id: 'b' })]);
});

test('changing bounds cancels the old preview and disposes a late prepared result', async () => {
	let finish!: (value: Awaited<ReturnType<typeof prepareRepurposePreview>>) => void;
	api.preview.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			})
	);
	const screen = await render(RepurposePanel, {
		props: { context: context(), onsave: vi.fn(), onback: vi.fn() }
	});
	await screen.getByRole('button', { name: 'Find clips', exact: true }).click();
	await screen.getByRole('button', { name: 'Preview clip', exact: true }).click();
	await expect.poll(() => api.preview.mock.calls.length).toBe(1);
	await screen.getByRole('textbox', { name: 'Start', exact: true }).fill('0');
	await userEvent.tab();
	expect(api.preview.mock.calls[0]![3].aborted).toBe(true);
	const dispose = vi.fn(async () => {});
	finish({ url: 'blob:expired-preview', dispose });
	await expect.poll(() => dispose.mock.calls.length).toBe(1);
	await expect.element(screen.getByLabelText('Preview Useful lesson')).not.toBeInTheDocument();
});
