import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { Project } from '../project/types';
import ProjectBrowser from './project-browser.svelte';
import '../../../routes/layout.css';

async function settleUnmount(unmount: () => PromiseLike<void>): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, 200));
	await unmount();
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function project(
	id: string,
	name: string,
	updatedAt: number,
	metadata = { width: 1920, height: 1080, fps: 30 }
): Project {
	return {
		id,
		name,
		description: `${name} campaign`,
		createdAt: updatedAt - 100,
		updatedAt,
		duration: 0,
		metadata,
		timeline: { tracks: [], items: [] }
	};
}

function browserProps(projects: Project[]) {
	return {
		projects,
		thumbnailUrls: {},
		trashedProjects: [],
		loading: false,
		error: '',
		trashError: '',
		trashBusyId: null,
		emptyingTrash: false,
		creating: false,
		importing: false,
		duplicatingId: null,
		exportingId: null,
		exportingKind: null,
		bundleProgress: null,
		bundleOperation: null,
		bundleCanceling: false,
		oncreate: vi.fn(async () => true),
		onimportjson: vi.fn(async () => undefined),
		onimportbundle: vi.fn(async () => undefined),
		onopen: vi.fn(),
		onupdate: vi.fn(async () => null),
		onduplicate: vi.fn(async () => undefined),
		onexportjson: vi.fn(async () => undefined),
		onexportbundle: vi.fn(async () => undefined),
		oncancelbundle: vi.fn(),
		ondelete: vi.fn(async () => undefined),
		ondeletebatch: vi.fn(async () => []),
		onrestore: vi.fn(async () => undefined),
		onpurge: vi.fn(async () => undefined),
		onemptytrash: vi.fn(async () => undefined)
	};
}

it('keeps project search and compact actions usable at 320 pixels', async () => {
	await page.viewport(320, 720);
	const onduplicate = vi.fn(async () => undefined);
	const onexportjson = vi.fn(async () => undefined);
	const onexportbundle = vi.fn(async () => undefined);
	const screen = await render(ProjectBrowser, {
		...browserProps([project('alpha', 'Alpha launch', 100), project('beta', 'Beta update', 200)]),
		onduplicate,
		onexportjson,
		onexportbundle
	});
	screen.container.style.width = '320px';
	screen.container.style.background = 'oklch(0.145 0.008 55)';
	screen.container.style.padding = '16px';

	const search = screen.getByRole('textbox', { name: 'Search projects' });
	await search.fill('alpha');
	await expect.element(screen.getByText('Alpha launch', { exact: true })).toBeVisible();
	await expect.element(screen.getByText('Beta update', { exact: true })).not.toBeInTheDocument();
	await search.fill('');
	await page.screenshot({
		element: screen.container,
		path: '../../../../.svelte-kit/openpost-project-browser-phone.png'
	});

	await screen.getByRole('button', { name: 'Actions for Beta update' }).click();
	await screen.getByRole('menuitem', { name: 'Duplicate' }).click();
	expect(onduplicate).toHaveBeenCalledWith(expect.objectContaining({ id: 'beta' }));
	await screen.getByRole('button', { name: 'Actions for Beta update' }).click();
	await screen.getByRole('menuitem', { name: 'Export bundle' }).click();
	expect(onexportbundle).toHaveBeenCalledWith(expect.objectContaining({ id: 'beta' }));
	await screen.getByRole('button', { name: 'Actions for Beta update' }).click();
	await screen.getByRole('menuitem', { name: 'Export JSON' }).click();
	expect(onexportjson).toHaveBeenCalledWith(expect.objectContaining({ id: 'beta' }));
	await screen.getByRole('button', { name: 'Import project' }).click();
	await expect.element(screen.getByRole('menuitem', { name: 'Import bundle' })).toBeVisible();
	expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);
	await settleUnmount(screen.unmount);
});

it('opens project actions from right click without opening the project', async () => {
	const props = browserProps([project('alpha', 'Alpha launch', 100)]);
	const screen = await render(ProjectBrowser, props);
	const projectButton = screen.getByRole('button', { name: /^16:9 Alpha launch/ }).element();

	projectButton.dispatchEvent(
		new MouseEvent('contextmenu', {
			bubbles: true,
			cancelable: true,
			clientX: 120,
			clientY: 80
		})
	);

	await expect.element(screen.getByRole('menuitem', { name: 'Edit project' })).toBeVisible();
	expect(props.onopen).not.toHaveBeenCalled();
	await screen.getByRole('menuitem', { name: 'Duplicate' }).click();
	expect(props.onduplicate).toHaveBeenCalledWith(expect.objectContaining({ id: 'alpha' }));
});

it('creates a project from a compact canvas preset at 320 pixels', async () => {
	await page.viewport(320, 760);
	const oncreate = vi.fn(async () => true);
	const screen = await render(ProjectBrowser, {
		...browserProps([]),
		oncreate
	});
	screen.container.style.width = '320px';
	screen.container.style.padding = '16px';

	await screen.getByRole('button', { name: 'New project' }).click();
	await screen.getByRole('button', { name: /Shorts, TikTok and Reels.*1080.*1920/ }).click();
	await screen.getByRole('textbox', { name: 'Project name' }).fill('Launch vertical');
	await page.screenshot({
		element: screen.container,
		path: '../../../../.svelte-kit/openpost-project-create-phone.png'
	});
	await screen.getByRole('button', { name: 'Create' }).click();

	expect(oncreate).toHaveBeenCalledWith('Launch vertical', {
		width: 1080,
		height: 1920,
		fps: 30
	});
	expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);
	await settleUnmount(screen.unmount);
});

it('edits all project details, keeps failures visible, and fits at 320 pixels', async () => {
	await page.viewport(320, 760);
	const source = project('alpha', 'Alpha launch', 100);
	const onupdate = vi
		.fn()
		.mockResolvedValueOnce('Workspace write failed.')
		.mockResolvedValueOnce(null);
	const screen = await render(ProjectBrowser, {
		...browserProps([source]),
		onupdate
	});
	screen.container.style.width = '320px';
	screen.container.style.overflow = 'hidden';

	await expect.element(screen.getByText('Alpha launch campaign')).toBeVisible();
	await screen.getByRole('button', { name: 'Actions for Alpha launch' }).click();
	await screen.getByRole('menuitem', { name: 'Edit project' }).click();
	const dialog = screen.getByRole('dialog');
	await expect.element(dialog).toBeVisible();
	await dialog.getByRole('textbox', { name: 'Project name' }).fill('Vertical launch');
	await dialog.getByRole('textbox', { name: 'Description' }).fill('Approved social cut');
	await dialog.getByRole('spinbutton', { name: 'Width' }).fill('1080');
	await dialog.getByRole('spinbutton', { name: 'Height' }).fill('1920');
	await dialog.getByRole('button', { name: 'Frame rate' }).click();
	await page.getByRole('option', { name: '60 fps' }).click();
	await dialog.getByRole('button', { name: 'Save changes' }).click();

	await expect.element(dialog.getByText('Workspace write failed.')).toBeVisible();
	expect(onupdate).toHaveBeenCalledWith(source, {
		name: 'Vertical launch',
		description: 'Approved social cut',
		metadata: { width: 1080, height: 1920, fps: 60 },
		duration: 0
	});
	expect(dialog.element().scrollWidth).toBeLessThanOrEqual(dialog.element().clientWidth);
	expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);
	await page.screenshot({
		path: '../../../../.svelte-kit/openpost-project-details-phone.png'
	});

	await dialog.getByRole('button', { name: 'Save changes' }).click();
	await expect.element(dialog).not.toBeInTheDocument();
	expect(onupdate).toHaveBeenCalledTimes(2);
	await settleUnmount(screen.unmount);
});

it('creates a project with custom canvas settings', async () => {
	const oncreate = vi.fn(async () => true);
	const screen = await render(ProjectBrowser, {
		...browserProps([]),
		oncreate
	});

	await screen.getByRole('button', { name: 'New project' }).click();
	await screen.getByRole('button', { name: /Custom/ }).click();
	await screen.getByRole('spinbutton', { name: 'Width' }).fill('200');
	await expect.element(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
	await screen.getByRole('spinbutton', { name: 'Width' }).fill('2048');
	await screen.getByRole('spinbutton', { name: 'Height' }).fill('858');
	await screen.getByRole('button', { name: 'Frame rate: 30 fps' }).click();
	await screen.getByRole('option', { name: '24 fps' }).click();
	await screen.getByRole('button', { name: 'Create' }).click();

	expect(oncreate).toHaveBeenCalledWith('', {
		width: 2048,
		height: 858,
		fps: 24
	});
	await settleUnmount(screen.unmount);
});

it('reports bundle progress and lets the user cancel at 320 pixels', async () => {
	await page.viewport(320, 720);
	const oncancelbundle = vi.fn();
	const screen = await render(ProjectBrowser, {
		...browserProps([project('alpha', 'Alpha launch', 100)]),
		exportingId: 'alpha',
		exportingKind: 'bundle',
		bundleProgress: {
			stage: 'packaging',
			percent: 42,
			currentFile: 'launch.mp4'
		},
		bundleOperation: 'export',
		oncancelbundle
	});

	await expect.element(screen.getByText('42%')).toBeVisible();
	await expect.element(screen.getByText('launch.mp4')).toHaveAttribute('title', 'launch.mp4');
	const progress = screen.getByRole('progressbar', {
		name: 'Exporting bundle'
	});
	await expect.element(progress).toHaveAttribute('aria-valuenow', '42');
	await screen.getByRole('button', { name: 'Cancel' }).click();
	expect(oncancelbundle).toHaveBeenCalledOnce();
	await expect.element(screen.getByRole('button', { name: 'Import project' })).toBeDisabled();
	expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);
	await settleUnmount(screen.unmount);
});

it('filters project metadata and completes restore and permanent-delete flows', async () => {
	await page.viewport(1280, 900);
	const alpha = project('alpha', 'Alpha launch', 100);
	alpha.duration = 65;
	const beta = project('beta', 'Beta update', 200, {
		width: 1280,
		height: 720,
		fps: 24
	});
	const onrestore = vi.fn(async () => undefined);
	const onpurge = vi.fn(async () => undefined);
	const trashed = {
		id: 'old',
		marker: { deletedAt: 1_700_000_000_000, originalName: 'Old campaign' }
	};
	const screen = await render(ProjectBrowser, {
		...browserProps([alpha, beta]),
		thumbnailUrls: {
			alpha: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
		},
		trashedProjects: [trashed],
		onrestore,
		onpurge
	});
	screen.container.style.width = '1000px';
	screen.container.style.background = 'oklch(0.145 0.008 55)';
	screen.container.style.padding = '24px';

	await expect.element(screen.getByRole('img', { name: 'Preview for Alpha launch' })).toBeVisible();
	await expect.element(screen.getByText('1:05 long')).toBeVisible();
	await screen.getByText('All resolutions').click();
	await screen.getByRole('option', { name: '1280×720' }).click();
	await expect.element(screen.getByText('Beta update', { exact: true })).toBeVisible();
	await expect.element(screen.getByText('Alpha launch', { exact: true })).not.toBeInTheDocument();

	await screen.getByRole('button', { name: /Trash/ }).click();
	await page.screenshot({
		element: screen.container,
		path: '../../../../.svelte-kit/openpost-project-browser-desktop.png'
	});
	await screen.getByRole('button', { name: 'Restore' }).click();
	expect(onrestore).toHaveBeenCalledWith('old', 'Old campaign');
	await screen.getByRole('button', { name: 'Delete forever' }).click();
	const dialog = screen.getByRole('dialog');
	await expect.element(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Delete forever', exact: true }).click();
	expect(onpurge).toHaveBeenCalledWith(trashed);
	await settleUnmount(screen.unmount);
});

it('selects a range and keeps failed projects selected after a bulk trash action', async () => {
	await page.viewport(1280, 900);
	const projects = [
		project('alpha', 'Alpha launch', 300),
		project('beta', 'Beta update', 200),
		project('gamma', 'Gamma lesson', 100)
	];
	const ondeletebatch = vi.fn(async () => ['beta']);
	const screen = await render(ProjectBrowser, {
		...browserProps(projects),
		ondeletebatch
	});

	await screen.getByRole('checkbox', { name: 'Select Alpha launch' }).click();
	await screen
		.getByRole('checkbox', { name: 'Select Gamma lesson' })
		.click({ modifiers: ['Shift'] });
	await expect.element(screen.getByText('3 selected')).toBeVisible();
	await screen.getByRole('button', { name: 'Move selected to trash' }).click();
	const dialog = screen.getByRole('dialog');
	await expect.element(dialog.getByText(/Move all 3 selected projects/)).toBeVisible();
	await dialog.getByRole('button', { name: 'Move selected to trash' }).click();
	expect(ondeletebatch).toHaveBeenCalledWith(projects);
	await expect.element(screen.getByText('1 selected')).toBeVisible();
	await expect
		.element(screen.getByRole('checkbox', { name: 'Deselect Beta update' }))
		.toHaveAttribute('aria-checked', 'true');
	await settleUnmount(screen.unmount);
});
