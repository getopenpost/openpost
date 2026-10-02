import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { QueryClientProvider } from '@tanstack/svelte-query';
import { client, type Workspace } from '$lib/api/client';
import { queryClient } from '$lib/query/client';
import { workspaceCtx } from '$lib/stores/workspace.svelte';
import Editor from './editor.svelte';
import type { Workflow, Run } from './api';
import '../../routes/layout.css';

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
let post: ReturnType<typeof vi.spyOn<typeof client, 'POST'>>;

beforeEach(() => {
	queryClient.clear();
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
	await screen.getByRole('button', { name: /^Parse sample/ }).click();
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
