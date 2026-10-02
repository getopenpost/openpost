import type {} from '@vitest/browser-playwright';
import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { cdp, page, userEvent } from 'vitest/browser';
import { QueryClientProvider } from '@tanstack/svelte-query';
import { queryClient } from '$lib/query/client';
import { createBlankProject } from '$lib/video-editor/project/defaults';
import { createProject, getProject } from '$lib/video-editor/workspace-fs/projects';
import { setWorkspaceRoot } from '$lib/video-editor/workspace-fs/root';
import { saveWorkspaceHandleRecord } from '$lib/video-editor/workspace-fs/handles-db';
import { listExportEntries } from '$lib/video-editor/workspace-fs/exports';
import { editorSession } from '$lib/video-editor/editor.svelte';
import VideoEditorPage from './+page.svelte';
import '../../layout.css';

const route = vi.hoisted(() => ({
	params: { id: '' },
	url: new URL('https://example.com/video-editor')
}));
// SvelteKit supplies route identity in the app; the component runner has no router.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$app/state', () => ({ page: route }));

let permissionPrototype: object;
let originalPermission: PropertyDescriptor | undefined;

afterEach(async () => {
	await cdp().send('Emulation.setTouchEmulationEnabled', { enabled: false });
	document.documentElement.classList.remove('dark');
	editorSession.stopAutosaveTimers();
	await editorSession.flushAutosave();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	if (permissionPrototype) {
		if (originalPermission)
			Object.defineProperty(permissionPrototype, 'queryPermission', originalPermission);
		else Reflect.deleteProperty(permissionPrototype, 'queryPermission');
	}
});

it('opens export settings from the advertised shortcut without starting a render', async () => {
	await page.viewport(1280, 850);
	const root = await (
		await navigator.storage.getDirectory()
	).getDirectoryHandle(crypto.randomUUID(), { create: true });
	vi.stubGlobal('showDirectoryPicker', async () => root);
	vi.stubGlobal('showOpenFilePicker', async () => []);
	permissionPrototype = Object.getPrototypeOf(root);
	originalPermission = Object.getOwnPropertyDescriptor(permissionPrototype, 'queryPermission');
	Object.defineProperty(permissionPrototype, 'queryPermission', {
		configurable: true,
		value: async () => 'granted'
	});
	setWorkspaceRoot(root);
	await saveWorkspaceHandleRecord(root);
	const project = createBlankProject('Export shortcut');

	if (!project.timeline) throw new Error('Blank project has no timeline');
	project.timeline.items = [
		{
			id: 'title',
			type: 'text',
			trackId: project.timeline.tracks[0]!.id,
			from: 0,
			durationInFrames: 30,
			label: 'Hello',
			text: 'Hello',
			fontSize: 60,
			color: '#ffffff',
			transform: { x: 960, y: 540, width: 600, height: 100, opacity: 1 }
		}
	];
	await createProject(project);
	route.params.id = project.id;
	route.url = new URL(`https://example.com/video-editor/${project.id}`);
	const screen = await render(
		VideoEditorPage,
		{},
		{
			wrapper: QueryClientProvider,
			wrapperProps: { client: queryClient }
		}
	);
	await expect.poll(() => editorSession.project?.id).toBe(project.id);
	await screen
		.getByRole('textbox', { name: 'Project name', exact: true })
		.fill('Saved header project');
	await userEvent.keyboard('{Tab}');
	await editorSession.flushAutosave();
	expect((await getProject(project.id))?.name).toBe('Saved header project');
	const header = screen.getByRole('banner');
	const saved = header.getByRole('status');
	await expect.element(saved).toHaveAttribute('data-state', 'saved');
	for (const width of [1280, 390, 320]) {
		await page.viewport(width, 850);
		await cdp().send('Emulation.setTouchEmulationEnabled', {
			enabled: width !== 1280,
			maxTouchPoints: 1
		});
		for (const dark of [false, true]) {
			document.documentElement.classList.toggle('dark', dark);
			header.getByRole('tab', { name: 'Edit', exact: true }).element().focus();
			await userEvent.keyboard('{Meta>}{Shift>}e{/Shift}{/Meta}');
			await expect
				.element(screen.getByRole('heading', { name: 'Export video', exact: true }))
				.toBeVisible();
			await expect
				.element(screen.getByRole('button', { name: 'Render now', exact: true }))
				.toBeVisible();
			await expect.element(screen.getByText('WebM', { exact: true })).toBeVisible();
			expect(await listExportEntries(project.id)).toEqual([]);
			await page.screenshot({
				path: `__screenshots__/esk001-${width}-${dark ? 'dark' : 'light'}.png`
			});
			await userEvent.keyboard('{Escape}');
			await header.getByRole('button', { name: 'More actions', exact: true }).click();
			await screen.getByRole('menuitem', { name: 'Export', exact: true }).click();
			await expect
				.element(screen.getByRole('heading', { name: 'Export video', exact: true }))
				.toBeVisible();
			await userEvent.keyboard('{Escape}');
			expect(await listExportEntries(project.id)).toEqual([]);
		}
	}
	expect((await getProject(project.id))?.timeline?.items).toEqual(project.timeline.items);
	await screen.unmount();
});
