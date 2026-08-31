import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { ExportEntry } from '../workspace-fs/exports';
import SavedExportsPanel from './saved-exports-panel.svelte';
import '../../../routes/layout.css';

const first: ExportEntry = {
	name: 'Interview - Part 1.webm',
	kind: 'file',
	size: 1_572_864,
	lastModified: new Date('2026-08-24T09:30:00Z').getTime(),
	path: ['projects', 'project', 'exports', 'Interview - Part 1.webm']
};

const second: ExportEntry = {
	name: 'Portuguese product launch voiceover final.wav',
	kind: 'file',
	size: 2_048,
	lastModified: new Date('2026-08-23T09:30:00Z').getTime(),
	path: ['projects', 'project', 'exports', 'Portuguese product launch voiceover final.wav']
};

const third: ExportEntry = {
	name: 'Interview final.mp4',
	kind: 'file',
	size: 4_096,
	lastModified: new Date('2026-08-24T10:30:00Z').getTime(),
	path: ['projects', 'project', 'exports', 'Interview final.mp4']
};

const sequence: ExportEntry = {
	name: 'Interview frames__1787888000000-proof',
	kind: 'directory',
	size: 0,
	lastModified: 1_787_888_000_000,
	path: ['projects', 'project', 'exports', 'Interview frames__1787888000000-proof']
};

describe('SavedExportsPanel', () => {
	it('downloads and confirms deletion of saved project exports at phone width', async () => {
		await page.viewport(320, 720);
		let files = [sequence, first, second];
		const props = {
			projectId: 'project',
			refreshKey: 'first',
			listFiles: vi.fn(async () => files),
			readFile: vi.fn(async () => new Blob(['render'], { type: 'video/webm' })),
			deleteEntry: vi.fn(async (path: string[]) => {
				files = files.filter((entry) => entry.path.join('/') !== path.join('/'));
			}),
			getFolderName: () => 'OpenPost workspace'
		};
		const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:render');
		const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		let clickedDownload = '';
		let clickedHref = '';
		const click = vi
			.spyOn(HTMLAnchorElement.prototype, 'click')
			.mockImplementation(function (this: HTMLAnchorElement) {
				clickedDownload = this.download;
				clickedHref = this.href;
			});

		const screen = await render(SavedExportsPanel, props);
		const openContextMenu = (entry: ExportEntry) => {
			const row = screen.container.querySelector<HTMLElement>(
				`[data-export-path="${entry.path.join('/')}"]`
			);
			expect(row).not.toBeNull();
			row!.dispatchEvent(
				new MouseEvent('contextmenu', {
					bubbles: true,
					cancelable: true,
					clientX: 80,
					clientY: 80
				})
			);
		};

		await expect.element(screen.getByText(first.name)).toBeVisible();
		await expect.element(screen.getByText(second.name)).toBeVisible();
		await expect.element(screen.getByText(sequence.name)).toBeVisible();
		await expect.element(screen.getByText('Folder')).toBeVisible();
		expect(screen.getByRole('button', { name: `Download ${sequence.name}` }).query()).toBeNull();
		await expect.element(screen.getByText('1.5 MB')).toBeVisible();
		await expect.element(screen.getByText('Saved in OpenPost workspace.')).toBeVisible();
		const panel = screen.getByTestId('saved-exports-panel').element();
		expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
		await page.viewport(390, 844);
		expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
		await page.viewport(1280, 800);
		expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
		await page.viewport(320, 720);
		files = [third, ...files];
		await screen.rerender({ ...props, refreshKey: 'first\u0000third' });
		await expect.element(screen.getByText(third.name)).toBeVisible();
		expect(props.listFiles).toHaveBeenCalledTimes(2);

		openContextMenu(first);
		await screen.getByRole('menuitem', { name: `Download ${first.name}` }).click();
		expect(props.readFile).toHaveBeenCalledWith(first.path);
		expect(createObjectURL).toHaveBeenCalledOnce();
		expect(click).toHaveBeenCalledOnce();
		expect(clickedDownload).toBe(first.name);
		expect(clickedHref).toBe('blob:render');
		await vi.waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:render'));

		openContextMenu(first);
		await screen.getByRole('menuitem', { name: `Delete ${first.name}` }).click();
		await expect
			.element(screen.getByRole('heading', { name: `Delete ${first.name}?` }))
			.toBeVisible();
		expect(props.deleteEntry).not.toHaveBeenCalled();
		await screen.getByRole('button', { name: 'Delete', exact: true }).click();
		await expect.element(screen.getByText(first.name)).not.toBeInTheDocument();
		expect(props.deleteEntry).toHaveBeenCalledWith(first.path, false);
		expect(props.listFiles).toHaveBeenCalledTimes(3);

		openContextMenu(sequence);
		expect(screen.getByRole('menuitem', { name: `Download ${sequence.name}` }).query()).toBeNull();
		await screen.getByRole('menuitem', { name: `Delete ${sequence.name}` }).click();
		await screen.getByRole('button', { name: 'Delete', exact: true }).click();
		await expect.element(screen.getByText(sequence.name)).not.toBeInTheDocument();
		expect(props.deleteEntry).toHaveBeenCalledWith(sequence.path, true);

		createObjectURL.mockRestore();
		revokeObjectURL.mockRestore();
		click.mockRestore();
	});

	it('keeps listing failures visible and retries them', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const listFiles = vi
			.fn<() => Promise<ExportEntry[]>>()
			.mockRejectedValueOnce(new Error('Permission expired'))
			.mockResolvedValueOnce([]);
		const screen = await render(SavedExportsPanel, {
			projectId: 'project',
			listFiles,
			readFile: vi.fn(),
			deleteEntry: vi.fn(),
			getFolderName: () => null
		});

		await expect
			.element(screen.getByRole('alert'))
			.toHaveTextContent('Saved files could not be loaded.');
		await screen.getByRole('button', { name: 'Try again' }).click();
		await expect
			.element(screen.getByText('Rendered files saved to this project will appear here.'))
			.toBeVisible();
		expect(listFiles).toHaveBeenCalledTimes(2);
		expect(consoleError).toHaveBeenCalledOnce();
		consoleError.mockRestore();
	});
});
