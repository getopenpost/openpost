import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { WebThemeRuntime } from '$lib/themes/runtime';
import { resolveBuiltInTheme } from '@openpost/ui/themes/builtins';
import { createBlankProject } from '../project/defaults';
import type { CloudVideoProject } from '../cloud/project-repository';
import type { Project } from '../project/types';
import CloudProjectBrowser from './cloud-project-browser.svelte';
import '../../../routes/layout.css';

function project(name: string): CloudVideoProject<Project> {
	const document = createBlankProject(name);
	return {
		id: document.id,
		workspaceId: 'library',
		name,
		headRevision: 1,
		document,
		syncStatus: 'synced',
		attentionReason: '',
		trashedAt: '',
		updatedAt: '2026-10-03T10:00:00Z'
	};
}
function props() {
	return {
		projects: [project('Launch'), project('Tutorial')],
		trashedProjects: [{ ...project('Archived'), trashedAt: '2026-10-03T10:00:00Z' }],
		loading: false,
		error: '',
		onopen: vi.fn(),
		ontrash: vi.fn(),
		onrestore: vi.fn(),
		localProjects: [],
		importingId: null,
		onimportlocal: vi.fn(),
		exportingId: null,
		onexport: vi.fn(),
		offlineProjectIds: [],
		offlineBusyId: null,
		ontoggleoffline: vi.fn(),
		onrefresh: vi.fn()
	};
}
it('explains unmatched project search and restores the inventory with keyboard clear', async () => {
	const callbacks = props();
	const screen = await render(CloudProjectBrowser, callbacks);
	const theme = new WebThemeRuntime();
	try {
		const search = screen.getByRole('textbox', { name: 'Search projects', exact: true });
		await expect
			.element(screen.getByRole('button', { name: 'Open project', exact: true }).first())
			.toBeVisible();
		for (const scheme of ['light', 'dark'] as const) {
			await theme.apply(resolveBuiltInTheme('dither', scheme), document.documentElement);
			for (const width of [1280, 390, 320]) {
				await page.viewport(width, 844);
				screen.container.style.maxWidth = '900px';
				await search.fill('No match 東京');
				await expect
					.element(screen.getByText('No projects match this search.', { exact: true }))
					.toBeVisible();
				await expect
					.element(
						screen.getByText(
							'No OpenPost Video Editor projects have been saved to this workspace.',
							{ exact: true }
						)
					)
					.not.toBeInTheDocument();
				await expect
					.element(screen.getByRole('button', { name: 'Open project', exact: true }))
					.not.toBeInTheDocument();
				await expect.element(screen.getByText('Archived', { exact: true })).toBeVisible();
				const clear = screen.getByRole('button', { name: 'Clear search', exact: true });
				clear.element().focus();
				await page.screenshot({ path: `eld001-${scheme}-${width}.png` });
				await userEvent.keyboard('{Enter}');
				await expect.element(search).toHaveValue('');
				await expect.element(search).toHaveFocus();
				await expect.element(screen.getByText('Launch', { exact: true })).toBeVisible();
				await expect.element(screen.getByText('Tutorial', { exact: true })).toBeVisible();
			}
		}
		await search.fill('tutor');
		await expect.element(screen.getByText('Tutorial', { exact: true })).toBeVisible();
		await expect.element(screen.getByText('Launch', { exact: true })).not.toBeInTheDocument();
		for (const callback of [
			callbacks.onopen,
			callbacks.ontrash,
			callbacks.onrestore,
			callbacks.onexport,
			callbacks.ontoggleoffline
		])
			expect(callback).not.toHaveBeenCalled();
	} finally {
		await screen.unmount();
		theme.clear(document.documentElement);
	}
}, 30_000);

it('keeps genuine empty, loading and failed libraries distinct from a search miss', async () => {
	const empty = 'No OpenPost Video Editor projects have been saved to this workspace.';
	for (const state of [
		{ projects: [], loading: false, error: '' },
		{ projects: [], loading: true, error: '' },
		{ projects: [], loading: false, error: 'Library unavailable' }
	]) {
		const screen = await render(CloudProjectBrowser, { ...props(), ...state, trashedProjects: [] });
		try {
			if (state.loading) await expect.element(screen.getByRole('status')).toBeVisible();
			else if (state.error)
				await expect.element(screen.getByRole('alert')).toHaveTextContent(state.error);
			else await expect.element(screen.getByText(empty, { exact: true })).toBeVisible();
			await expect
				.element(screen.getByRole('button', { name: 'Clear search', exact: true }))
				.not.toBeInTheDocument();
			await expect
				.element(screen.getByText('No projects match this search.', { exact: true }))
				.not.toBeInTheDocument();
		} finally {
			await screen.unmount();
		}
	}
});
