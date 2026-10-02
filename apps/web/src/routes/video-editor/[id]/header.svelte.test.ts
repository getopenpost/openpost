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

it('keeps saved feedback and workspace tabs disjoint with narrow touch controls', async () => {
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
	const project = createBlankProject('Header layout');

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
		for (const coarse of [false, true]) {
			await cdp().send('Emulation.setTouchEmulationEnabled', {
				enabled: coarse,
				maxTouchPoints: 1
			});
			await expect.poll(() => matchMedia('(pointer:coarse)').matches).toBe(coarse);
			for (const dark of [false, true]) {
				document.documentElement.classList.toggle('dark', dark);
				const feedback = saved.element().getBoundingClientRect();
				const motion = header
					.getByRole('tab', { name: 'Motion', exact: true })
					.element()
					.getBoundingClientRect();
				expect(
					feedback.left >= motion.right ||
						feedback.right <= motion.left ||
						feedback.top >= motion.bottom ||
						feedback.bottom <= motion.top
				).toBe(true);
				for (const button of header.element().querySelectorAll('button,a')) {
					const bounds = button.getBoundingClientRect();
					if (!bounds.width || !bounds.height) continue;
					expect(bounds.left).toBeGreaterThanOrEqual(0);
					expect(bounds.right).toBeLessThanOrEqual(width);
					if (coarse) {
						expect(bounds.width).toBeGreaterThanOrEqual(44);
						expect(bounds.height).toBeGreaterThanOrEqual(44);
					}
				}
				if (coarse)
					await page.screenshot({
						path: `__screenshots__/vr001-${width}-${dark ? 'dark' : 'light'}.png`
					});
			}
		}
	}
	const motion = header.getByRole('tab', { name: 'Motion', exact: true });
	motion.element().focus();
	await userEvent.keyboard('{End}');
	await expect.element(motion).toHaveAttribute('aria-selected', 'true');
	await userEvent.keyboard('{Home}');
	await expect
		.element(header.getByRole('tab', { name: 'Edit', exact: true }))
		.toHaveAttribute('aria-selected', 'true');
	await header.getByRole('button', { name: 'Exports', exact: true }).click();
	await expect.element(screen.getByRole('heading', { name: 'Exports', exact: true })).toBeVisible();
	await userEvent.keyboard('{Escape}');
	await header.getByRole('button', { name: 'Export', exact: true }).click();
	await expect
		.element(screen.getByRole('heading', { name: 'Export video', exact: true }))
		.toBeVisible();
	await userEvent.keyboard('{Escape}');
	await screen.unmount();
});
