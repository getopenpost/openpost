import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { QueryClientProvider } from '@tanstack/svelte-query';
import { client, type Workspace } from '$lib/api/client';
import { queryClient } from '$lib/query/client';
import { workspaceCtx } from '$lib/stores/workspace.svelte';
import Editor from './editor.svelte';
import type { Workflow, Run } from './api';
import '../../routes/layout.css';

declare module 'vitest/browser' {
	interface BrowserCommands {
		dragPointer(selector: string, dx: number, dy: number): Promise<void>;
	}
}

const initial: Workflow = {
	id: 'sample-json',
	workspace_id: 'workspace-a',
	name: 'Sample JSON audit',
	description: '',
	enabled: false,
	revision: 1,
	published_revision: 0,
	created_at: '2026-10-02T00:00:00Z',
	updated_at: '2026-10-02T00:00:00Z',
	definition: {
		schema: 1,
		source: { kind: 'manual' },
		steps: [
			{
				id: 'parse',
				name: 'Parse sample',
				kind: 'parse_json',
				inputs: { text: { reference: 'source.body' } }
			}
		]
	}
};
const workspace: Workspace = {
	id: 'workspace-a',
	name: 'Audit',
	avatar_url: '',
	color: '#f97316',
	created_at: initial.created_at,
	organization_id: '',
	organization_name: '',
	role: 'admin',
	can_edit: true,
	sso_required: false,
	sso_authenticated: true,
	sso_identity_linked: true
};
let run: Run;
let post: MockInstance<typeof client.POST>;

beforeEach(() => {
	queryClient.clear();
	localStorage.clear();
	workspaceCtx.currentWorkspace = workspace;
	run = {
		id: 'run',
		workspace_id: initial.workspace_id,
		workflow_id: initial.id,
		workflow_name: initial.name,
		workflow_revision: 1,
		revision: 1,
		created_at: initial.created_at,
		updated_at: initial.updated_at,
		definition: initial.definition,
		mode: 'preview',
		state: 'succeeded',
		source: {},
		steps: []
	};
	// SAFETY: This public transport fixture returns the declared run or workflow-run list; no other GET is used by these cases.
	vi.spyOn(client, 'GET').mockImplementation(
		async (path) =>
			({ data: path === '/workflow-runs/{id}' ? run : [], response: new Response() }) as never
	);
	// SAFETY: Both tested POST operations return WorkflowRun; the complete fixture above satisfies that contract.
	post = vi
		.spyOn(client, 'POST')
		.mockResolvedValue({ data: run, response: new Response() } as never);
});
async function openLayout(workflow = initial) {
	const screen = await render(
		Editor,
		{ initial: workflow, accounts: [], connections: [] },
		{ wrapper: QueryClientProvider, wrapperProps: { client: queryClient } }
	);
	screen.container.style.height = '850px';
	const node = screen.container.querySelector<HTMLElement>('.svelte-flow__node[data-id="parse"]')!;
	await expect.element(node).toBeVisible();
	await expect
		.poll(() => {
			const viewport = screen.container.querySelector<HTMLElement>('.svelte-flow__viewport')!;
			return new DOMMatrixReadOnly(viewport.style.transform).m42;
		})
		.not.toBe(0);
	return { screen, node };
}

function nodePosition(node: HTMLElement) {
	const transform = new DOMMatrixReadOnly(node.style.transform);
	return { x: transform.m41, y: transform.m42 };
}

async function focusCanvasNode(node: HTMLElement) {
	for (let count = 0; document.activeElement !== node && count < 40; count++) {
		await userEvent.keyboard('{Tab}');
	}
	expect(document.activeElement).toBe(node);
}

it('retains pointer placement locally on reopen without saving authored workflow content', async () => {
	await page.viewport(1280, 900);
	const put = vi.spyOn(client, 'PUT');
	const { screen, node } = await openLayout();
	const baseline = nodePosition(node);
	await commands.dragPointer('.svelte-flow__node[data-id="parse"]', 60, 50);
	await expect.poll(() => nodePosition(node)).not.toEqual(baseline);
	const moved = nodePosition(node);
	await screen.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect.poll(() => nodePosition(node)).toEqual(baseline);
	await screen.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect.poll(() => nodePosition(node)).toEqual(moved);
	await userEvent.keyboard('{Control>}s{/Control}');
	expect(put).not.toHaveBeenCalled();
	await screen.unmount();
	const reopened = await openLayout();
	await expect.poll(() => nodePosition(reopened.node)).toEqual(moved);
	await reopened.screen.getByRole('button', { name: 'Organize', exact: true }).click();
	const organizedNode = () =>
		reopened.screen.container.querySelector<HTMLElement>('.svelte-flow__node[data-id="parse"]')!;
	await expect.poll(() => nodePosition(organizedNode())).toEqual(baseline);
	await reopened.screen.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect.poll(() => nodePosition(organizedNode())).toEqual(moved);
	await reopened.screen.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect.poll(() => nodePosition(organizedNode())).toEqual(baseline);
	await reopened.screen.unmount();
	const organized = await openLayout();
	await expect.poll(() => nodePosition(organized.node)).toEqual(baseline);
	expect(put).not.toHaveBeenCalled();
});

it.each([390, 1280].flatMap((width) => ['light', 'dark'].map((scheme) => ({ width, scheme }))))(
	'records keyboard placement in local Undo history and retains it at $width in $scheme',
	async ({ width, scheme }) => {
		await page.viewport(width, 900);
		document.documentElement.classList.toggle('dark', scheme === 'dark');
		const put = vi.spyOn(client, 'PUT');
		const { screen, node } = await openLayout();
		const baseline = nodePosition(node);
		await focusCanvasNode(node);
		await userEvent.keyboard('{Enter}{ArrowRight}');
		await expect.poll(() => nodePosition(node)).toEqual({ x: baseline.x + 5, y: baseline.y });
		await userEvent.keyboard('{ArrowDown}');
		const moved = { x: baseline.x + 5, y: baseline.y + 5 };
		await expect.poll(() => nodePosition(node)).toEqual(moved);
		if (width === 1280)
			await expect.element(screen.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
		await userEvent.keyboard('{Control>}z{/Control}');
		await expect.poll(() => nodePosition(node)).toEqual({ x: baseline.x + 5, y: baseline.y });
		await userEvent.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
		await expect.poll(() => nodePosition(node)).toEqual(moved);
		await userEvent.keyboard('{Tab}{ArrowLeft}');
		await expect.poll(() => nodePosition(node)).toEqual({ x: baseline.x, y: baseline.y + 5 });
		await userEvent.keyboard('{Control>}z{/Control}');
		await expect.poll(() => nodePosition(node)).toEqual(moved);
		await screen.unmount();
		const reopened = await openLayout();
		await expect.poll(() => nodePosition(reopened.node)).toEqual(moved);
		await expect
			.element(reopened.screen.getByText('Saved in this browser', { exact: true }))
			.toBeVisible();
		expect(put).not.toHaveBeenCalled();
	}
);

it('keeps placement Undo usable and explains session-only positions when browser storage is blocked', async () => {
	await page.viewport(390, 900);
	vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
		throw new DOMException('Storage blocked', 'SecurityError');
	});
	const { screen, node } = await openLayout();
	const baseline = nodePosition(node);
	await focusCanvasNode(node);
	await userEvent.keyboard('{Enter}{ArrowRight}');
	await expect.poll(() => nodePosition(node)).toEqual({ x: baseline.x + 5, y: baseline.y });
	await expect
		.element(
			screen.getByText(
				'Canvas positions could not be saved in this browser. They will reset when you reopen this workflow.',
				{ exact: true }
			)
		)
		.toBeVisible();
	await expect
		.element(screen.getByText('Saved in this browser', { exact: true }))
		.not.toBeInTheDocument();
	await userEvent.keyboard('{Control>}z{/Control}');
	await expect.poll(() => nodePosition(node)).toEqual(baseline);
	await screen.unmount();
	const reopened = await openLayout();
	await expect.poll(() => nodePosition(reopened.node)).toEqual(baseline);
});

it('keeps positions scoped to the owning workflow and workspace', async () => {
	await page.viewport(1280, 900);
	const { screen, node } = await openLayout();
	const baseline = nodePosition(node);
	await focusCanvasNode(node);
	await userEvent.keyboard('{Enter}{ArrowRight}');
	const moved = { x: baseline.x + 5, y: baseline.y };
	await expect.poll(() => nodePosition(node)).toEqual(moved);
	await screen.unmount();
	const other = await openLayout({ ...initial, id: 'other-workflow' });
	await expect.poll(() => nodePosition(other.node)).toEqual(baseline);
	await other.screen.unmount();
	workspaceCtx.currentWorkspace = { ...workspace, id: 'workspace-b' };
	const otherWorkspace = await openLayout({
		...initial,
		workspace_id: 'workspace-b'
	});
	await expect.poll(() => nodePosition(otherWorkspace.node)).toEqual(baseline);
	await otherWorkspace.screen.unmount();
	workspaceCtx.currentWorkspace = workspace;
	const original = await openLayout();
	await expect.poll(() => nodePosition(original.node)).toEqual(moved);
});

it('keeps immutable run layout read-only and separate from device-local editor positions', async () => {
	await page.viewport(1280, 900);
	// SAFETY: These history reads return the complete declared immutable run or its list; no other GET occurs in this case.
	vi.mocked(client.GET).mockImplementation(
		async (path) =>
			({
				data: path === '/workflow-runs' ? [run] : run,
				response: new Response()
			}) as never
	);
	const put = vi.spyOn(client, 'PUT');
	const definition = structuredClone(initial.definition);
	const { screen, node } = await openLayout();
	const baseline = nodePosition(node);
	await focusCanvasNode(node);
	await userEvent.keyboard('{Enter}{ArrowRight}');
	const moved = { x: baseline.x + 5, y: baseline.y };
	await expect.poll(() => nodePosition(node)).toEqual(moved);
	await screen.getByRole('button', { name: 'Runs', exact: true }).click();
	await screen.getByRole('button', { name: /^Completed/ }).click();
	const runNode = screen.container.querySelector<HTMLElement>(
		'.svelte-flow__node[data-id="parse"]'
	)!;
	await expect.element(runNode).toBeVisible();
	await focusCanvasNode(runNode);
	await userEvent.keyboard('{Enter}{ArrowRight}');
	await expect.poll(() => nodePosition(runNode)).toEqual(baseline);
	await screen.getByRole('button', { name: 'Editor', exact: true }).click();
	const editedNode = screen.container.querySelector<HTMLElement>(
		'.svelte-flow__node[data-id="parse"]'
	)!;
	await expect.poll(() => nodePosition(editedNode)).toEqual(moved);
	expect(initial.definition).toEqual(definition);
	expect(run.definition).toEqual(definition);
	expect(put).not.toHaveBeenCalled();
	expect(post).not.toHaveBeenCalled();
});
afterEach(() => {
	queryClient.clear();
	workspaceCtx.currentWorkspace = null;
	vi.restoreAllMocks();
});

async function openSample() {
	const screen = await render(
		Editor,
		{ initial, accounts: [], connections: [] },
		{
			wrapper: QueryClientProvider,
			wrapperProps: { client: queryClient }
		}
	);
	await screen.getByRole('button', { name: 'Test data', exact: true }).click();
	return page.getByRole('dialog');
}

it.each(
	[320, 390, 1280].flatMap((width) => ['light', 'dark'].map((scheme) => ({ width, scheme })))
)(
	'reports malformed sample JSON before node variables at $width in $scheme and recovers',
	async ({ width, scheme }) => {
		await page.viewport(width, 900);
		document.documentElement.classList.toggle('dark', scheme === 'dark');
		const dialog = await openSample();
		const sample = dialog.getByRole('textbox', { name: 'Sample input (JSON)' });
		await sample.fill('{bad');
		await dialog.getByRole('button', { name: 'Run preview', exact: true }).last().click();
		await expect.element(page.getByRole('alert')).toHaveTextContent('Enter valid JSON.');
		await expect.element(sample).toHaveValue('{bad');
		await expect.element(sample).toHaveFocus();
		await expect.element(sample).toHaveAttribute('aria-invalid', 'true');
		await expect.element(sample).toHaveAttribute('aria-describedby', 'workflow-inspector-error');
		expect(post).not.toHaveBeenCalled();
		const value = {
			body: '{"ok":true}',
			count: 7,
			enabled: false,
			nullable: null,
			values: ['é', 2]
		};
		await sample.fill(JSON.stringify(value));
		await dialog.getByRole('button', { name: 'Run preview', exact: true }).last().click();
		expect(post).toHaveBeenCalledExactlyOnceWith('/workflows/{id}/runs', {
			params: { query: { workspace_id: initial.workspace_id }, path: { id: initial.id } },
			body: { expected_revision: 1, mode: 'preview', source: value }
		});
	}
);

async function openNodeSample(workflow = initial) {
	const screen = await render(
		Editor,
		{ initial: workflow, accounts: [], connections: [] },
		{
			wrapper: QueryClientProvider,
			wrapperProps: { client: queryClient }
		}
	);
	await screen.getByRole('button', { name: /^Parse sample / }).click();
	await page.getByRole('button', { name: 'Back to canvas', exact: true }).click();
	await screen.getByRole('button', { name: 'Test data', exact: true }).click();
	return page.getByRole('dialog');
}

it('blocks malformed node-test sample data and recovers without substituting an empty source', async () => {
	await page.viewport(1280, 900);
	const dialog = await openNodeSample();
	const sample = dialog.getByRole('textbox', { name: 'Sample input (JSON)' });
	await sample.fill('{bad');
	await dialog.getByRole('button', { name: 'Test node', exact: true }).click();
	expect(post).not.toHaveBeenCalled();
	await expect.element(page.getByRole('alert')).toHaveTextContent('Enter valid JSON.');
	await expect.element(sample).toHaveFocus();
	const value = { body: '{"ok":true}', missing: null };
	await sample.fill(JSON.stringify(value));
	await userEvent.keyboard('{Tab}');
	await dialog.getByRole('button', { name: 'Test node', exact: true }).click();
	expect(post).toHaveBeenCalledExactlyOnceWith('/workflows/{id}/test-node', {
		params: { query: { workspace_id: initial.workspace_id }, path: { id: initial.id } },
		body: { expected_revision: 1, step_id: 'parse', data: { source: value } }
	});
});

it.each([{ value: 7 }, { value: null }, { value: [true, 'é', { value: null }] }])(
	'preserves valid node-test JSON $value while previews require an object',
	async ({ value }) => {
		await page.viewport(1280, 900);
		const workflow: Workflow = {
			...initial,
			definition: {
				...initial.definition,
				steps: [
					{
						id: 'parse',
						name: 'Parse sample',
						kind: 'parse_json',
						inputs: { text: { literal: '{"ok":true}' } }
					}
				]
			}
		};
		run.definition = workflow.definition;
		run.mode = 'test';
		const dialog = await openNodeSample(workflow);
		const sample = dialog.getByRole('textbox', { name: 'Sample input (JSON)' });
		await sample.fill(JSON.stringify(value));
		await dialog.getByRole('button', { name: 'Run preview', exact: true }).click();
		await expect
			.element(page.getByRole('alert'))
			.toHaveTextContent('Sample data must be a JSON object.');
		await expect.element(sample).toHaveFocus();
		await expect.element(sample).toHaveAttribute('aria-invalid', 'true');
		expect(post).not.toHaveBeenCalled();
		await dialog.getByRole('button', { name: 'Test node', exact: true }).click();
		expect(post).toHaveBeenCalledExactlyOnceWith('/workflows/{id}/test-node', {
			params: { query: { workspace_id: initial.workspace_id }, path: { id: initial.id } },
			body: { expected_revision: 1, step_id: 'parse', data: { source: value } }
		});
	}
);

it.each(
	[320, 390, 1280].flatMap((width) => ['light', 'dark'].map((scheme) => ({ width, scheme })))
)(
	'updates the saved-run card from the selected newer run at $width in $scheme',
	async ({ width, scheme }) => {
		await page.viewport(width, 900);
		document.documentElement.classList.toggle('dark', scheme === 'dark');
		const queued: Run = { ...run, mode: 'test', state: 'queued', revision: 1 };
		run = { ...queued, state: 'succeeded', revision: 2 };
		// SAFETY: The editor reads only the run list and run detail in this case; both fixtures satisfy their declared response shapes.
		vi.mocked(client.GET).mockImplementation(
			async (path) =>
				({ data: path === '/workflow-runs' ? [queued] : run, response: new Response() }) as never
		);
		const screen = await render(
			Editor,
			{ initial, accounts: [], connections: [] },
			{ wrapper: QueryClientProvider, wrapperProps: { client: queryClient } }
		);
		await screen.getByRole('button', { name: 'Runs', exact: true }).click();
		await screen.getByRole('button', { name: /^Queued/ }).click();
		await expect.element(screen.getByText('Workflow revision 1 · Test node')).toBeVisible();
		await expect.element(screen.getByText('Completed', { exact: true }).last()).toBeVisible();
		if (width === 1280)
			await expect.element(screen.getByRole('button', { name: /^Completed/ })).toBeVisible();
		const back = screen.getByRole('main').getByRole('button', { name: 'Runs', exact: true });
		await back.click();
		await expect.element(screen.getByRole('button', { name: /^Completed/ })).toBeVisible();
		await expect.element(screen.getByRole('button', { name: /^Queued/ })).not.toBeInTheDocument();
		await screen.getByRole('button', { name: /^Completed/ }).click();
		back.element().focus();
		await userEvent.keyboard('{Enter}');
		await expect.element(screen.getByRole('button', { name: /^Completed/ })).toBeVisible();
		expect(post).not.toHaveBeenCalled();
	}
);

it.each(
	[320, 390, 1280].flatMap((width) => ['light', 'dark'].map((scheme) => ({ width, scheme })))
)(
	'explains retained child states under a cancelled run at $width in $scheme',
	async ({ width, scheme }) => {
		await page.viewport(width, 900);
		document.documentElement.classList.toggle('dark', scheme === 'dark');
		run = {
			...run,
			mode: 'live',
			state: 'cancelled',
			revision: 4,
			current_step_id: 'wait',
			source: { body: '{"ok":true}' },
			definition: {
				...initial.definition,
				steps: [
					...(initial.definition.steps ?? []),
					{ id: 'wait', name: 'Wait', kind: 'wait', inputs: { minutes: { literal: 1 } } }
				]
			},
			steps: [
				{
					step_id: 'parse',
					kind: 'parse_json',
					name: 'Parse sample',
					state: 'succeeded',
					started_at: '2026-10-02T00:00:00Z',
					completed_at: '2026-10-02T00:00:01Z',
					inputs: { text: '{"ok":true}' },
					output: { value: { ok: true } }
				},
				{
					step_id: 'wait',
					kind: 'wait',
					name: 'Wait',
					state: 'waiting',
					started_at: '2026-10-02T00:00:01Z',
					inputs: { minutes: 1 },
					output: { until: '2026-10-02T00:01:00Z' }
				}
			]
		};
		// SAFETY: Both history endpoints return the complete immutable run fixture; no other GET is used by this case.
		vi.mocked(client.GET).mockImplementation(
			async (path) =>
				({ data: path === '/workflow-runs' ? [run] : run, response: new Response() }) as never
		);
		const screen = await render(
			Editor,
			{ initial, accounts: [], connections: [] },
			{ wrapper: QueryClientProvider, wrapperProps: { client: queryClient } }
		);
		await screen.getByRole('button', { name: 'Runs', exact: true }).click();
		await screen.getByRole('button', { name: /^Cancelled/ }).click();
		await expect
			.element(
				screen.getByText(
					'This run was cancelled. Step states below show the last recorded state.',
					{ exact: true }
				)
			)
			.toBeVisible();
		await expect.element(screen.getByText(/^Parse sample\s+Completed$/)).toBeVisible();
		const waiting = screen.getByText(/^Wait\s+Waiting$/);
		await expect.element(waiting).toBeVisible();
		waiting.element().focus();
		await userEvent.keyboard('{Enter}');
		await expect.element(screen.getByText(/"minutes": 1/)).toBeVisible();
		await expect
			.element(screen.getByRole('button', { name: 'Cancel remaining steps', exact: true }))
			.not.toBeInTheDocument();
		expect(post).not.toHaveBeenCalled();
	}
);

it.each(['Run preview', 'Test node'])(
	'preserves literal JSON keys through %s sample admission',
	async (action) => {
		await page.viewport(1280, 900);
		document.documentElement.classList.remove('dark');
		const dialog = await openNodeSample();
		const value = JSON.parse(
			'{"body":"{}","__proto__":{"label":"data"},"constructor":"literal","nested":{"__proto__":"keep"},"a.b":"dot"}'
		);
		await dialog.getByRole('textbox', { name: 'Sample input (JSON)' }).fill(JSON.stringify(value));
		await dialog.getByRole('button', { name: action, exact: true }).click();
		expect(post).toHaveBeenCalledExactlyOnceWith(
			action === 'Run preview' ? '/workflows/{id}/runs' : '/workflows/{id}/test-node',
			{
				params: { query: { workspace_id: initial.workspace_id }, path: { id: initial.id } },
				body:
					action === 'Run preview'
						? { expected_revision: 1, mode: 'preview', source: value }
						: { expected_revision: 1, step_id: 'parse', data: { source: value } }
			}
		);
	}
);

it('guides an untested Wait node to its available simulated preview rather than an unavailable node test', async () => {
	await page.viewport(1280, 900);
	const workflow: Workflow = {
		...initial,
		definition: {
			schema: 1,
			source: { kind: 'manual' },
			steps: [{ id: 'wait', name: 'Wait audit', kind: 'wait', inputs: { minutes: { literal: 1 } } }]
		}
	};
	const screen = await render(
		Editor,
		{ initial: workflow, accounts: [], connections: [] },
		{
			wrapper: QueryClientProvider,
			wrapperProps: { client: queryClient }
		}
	);
	screen.container.style.height = '850px';
	await screen.getByRole('button', { name: /^Wait audit / }).click();
	expect(screen.getByRole('button', { name: 'Test node', exact: true }).query()).toBeNull();
	await expect
		.element(screen.getByText("Run preview to see this node's sample output.", { exact: true }))
		.toBeVisible();
	expect(post).not.toHaveBeenCalled();
});

it.each(['test', 'preview'] as const)(
	'marks historical %s output after a draft input edit without changing its result',
	async (mode) => {
		await page.viewport(1280, 900);
		const workflow: Workflow = {
			...initial,
			definition: {
				...initial.definition,
				steps: [
					{
						id: 'parse',
						name: 'Parse sample',
						kind: 'parse_json',
						inputs: { text: { literal: '{"value":1}' } }
					},
					{ id: 'other', name: 'Other', kind: 'parse_json', inputs: { text: { literal: '{}' } } }
				]
			}
		};
		run = {
			...run,
			mode,
			definition:
				mode === 'test'
					? { schema: 1, source: { kind: 'manual' }, steps: [workflow.definition.steps![0]] }
					: workflow.definition,
			steps: [
				{
					step_id: 'parse',
					kind: 'parse_json',
					name: 'Parse sample',
					state: 'succeeded',
					started_at: initial.created_at,
					inputs: { text: '{"value":1}' },
					output: { data: { value: 1 } }
				}
			]
		};
		// SAFETY: This save fixture returns the declared complete Workflow after the one independently authored literal change.
		vi.spyOn(client, 'PUT').mockResolvedValue({
			data: { ...workflow, revision: 2 },
			response: new Response()
		} as never);
		// SAFETY: This complete immutable Run is the declared response of the public execution fixture.
		post.mockResolvedValue({ data: run, response: new Response() } as never);
		const originalRun = structuredClone(run);
		const screen = await render(
			Editor,
			{ initial: workflow, accounts: [], connections: [] },
			{ wrapper: QueryClientProvider, wrapperProps: { client: queryClient } }
		);
		screen.container.style.height = '850px';
		await screen.getByRole('button', { name: /^Parse sample / }).click();
		if (mode === 'test')
			await page
				.getByRole('dialog')
				.getByRole('button', { name: 'Test node', exact: true })
				.click();
		else {
			await page.getByRole('button', { name: 'Back to canvas', exact: true }).click();
			await screen.getByRole('button', { name: 'Run preview', exact: true }).click();
			await screen.getByRole('button', { name: 'Editor', exact: true }).click();
			await screen.getByRole('button', { name: /^Parse sample / }).click();
		}
		const output = page.getByRole('region', { name: 'Output', exact: true });
		await output.getByRole('button', { name: 'JSON', exact: true }).click();
		expect(JSON.parse(output.element().querySelector('pre')!.textContent!)).toEqual({
			data: { value: 1 }
		});
		expect(
			page
				.getByText(
					'Configuration or test data changed since this result. Run again to check the current draft.',
					{ exact: true }
				)
				.query()
		).toBeNull();
		await page.getByRole('textbox', { name: 'Text', exact: true }).fill('{"value":2}');
		await expect
			.element(
				output.getByText(
					'Configuration or test data changed since this result. Run again to check the current draft.',
					{ exact: true }
				)
			)
			.toBeVisible();
		await expect.element(output.getByText('Completed', { exact: true })).toBeVisible();
		expect(JSON.parse(output.element().querySelector('pre')!.textContent!)).toEqual({
			data: { value: 1 }
		});
		expect(run).toEqual(originalRun);
	}
);

it.each([
	{ mode: 'preview' as const, label: 'Preview', width: 1280 },
	{ mode: 'live' as const, label: 'Live', width: 390 },
	{ mode: 'test' as const, label: 'Test node', width: 320 }
])(
	'identifies $mode and its revision before opening run history',
	async ({ mode, label, width }) => {
		await page.viewport(width, 900);
		run = { ...run, mode, workflow_revision: 7 };
		vi.mocked(client.GET).mockImplementation(
			async (path) =>
				({ data: path === '/workflow-runs' ? [run] : run, response: new Response() }) as never
		);
		const screen = await render(
			Editor,
			{ initial, accounts: [], connections: [] },
			{
				wrapper: QueryClientProvider,
				wrapperProps: { client: queryClient }
			}
		);
		await screen.getByRole('button', { name: 'Runs', exact: true }).click();
		const card = screen.getByRole('button', { name: /^Completed/ });
		await expect.element(card).toBeVisible();
		await expect.element(card.getByText(label, { exact: true })).toBeVisible();
		await expect.element(card.getByText('Workflow revision 7', { exact: true })).toBeVisible();
		card.element().focus();
		await userEvent.keyboard('{Enter}');
		await expect.element(screen.getByText(`Workflow revision 7 · ${label}`)).toBeVisible();
		expect(post).not.toHaveBeenCalled();
	}
);
