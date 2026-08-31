import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { ImageEditorMediaItem } from '$lib/image-editor/types';
import type { MemeTemplate, MemeTemplateListResult } from '$lib/meme-generator/types';
import { m } from '$lib/paraglide/messages';
import MediaPicker from './media-picker.svelte';

const mocks = {
	listMedia: vi.fn(),
	listTags: vi.fn(),
	listTemplates: vi.fn(),
	thumbnailURL: vi.fn(),
	suggest: vi.fn(),
	preview: vi.fn(),
	render: vi.fn()
};

const services = {
	listMedia: mocks.listMedia,
	listTags: mocks.listTags,
	listTemplates: mocks.listTemplates,
	memeAPI: {
		listTemplates: mocks.listTemplates,
		thumbnailURL: mocks.thumbnailURL,
		suggest: mocks.suggest,
		preview: mocks.preview,
		render: mocks.render
	}
};

const template: MemeTemplate = {
	id: 'fry',
	name: 'Futurama Fry',
	lines: 2,
	overlays: 1,
	styles: ['default'],
	blank_url: '',
	example: { text: ['not sure if', 'or just careful'], url: '' },
	source_url: 'https://knowyourmeme.com/memes/futurama-fry-not-sure-if',
	keywords: ['fry'],
	search_terms: ['fry', 'futurama'],
	animated: false,
	semantic: {
		visual: 'Fry squints at an uncertain situation.',
		meaning: 'Doubt between two explanations.',
		mechanism: 'setup_payoff',
		caption_roles: ['uncertain setup', 'alternative explanation'],
		tags: ['doubt', 'comparison']
	}
};

const overlayMedia: ImageEditorMediaItem = {
	id: 'media-team-photo',
	workspace_id: 'workspace-1',
	mime_type: 'image/png',
	size: 1024,
	original_filename: 'Team photo.png',
	width: 640,
	height: 480,
	alt_text: 'The team after a successful release.',
	is_favorite: false,
	created_at: '2026-08-09T12:00:00Z',
	url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M/wHwAF/gL+Xw4J5QAAAABJRU5ErkJggg==',
	thumbnail_url:
		'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M/wHwAF/gL+Xw4J5QAAAABJRU5ErkJggg==',
	usage_count: 0,
	can_delete: true,
	processing_status: 'ready',
	processing_progress: 100,
	analysis_status: 'ready',
	duration_ms: 0,
	frame_rate: 0,
	source: 'upload',
	asset_kind: 'library',
	tags: []
};

function svgBase64(label: string): string {
	return btoa(
		`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#29292f"/><text x="320" y="240" text-anchor="middle" fill="white" font-size="32">${label}</text></svg>`
	);
}

function templateResult(configured = true): MemeTemplateListResult {
	return {
		templates: configured ? [template] : [],
		configured,
		ai_configured: configured,
		catalog: {
			provider_key: 'openpost',
			returned: configured ? 1 : 0,
			revision: 'catalog-1',
			stale: false,
			total_templates: configured ? 1 : 0
		}
	};
}

function renderPicker(
	enableMeme: boolean,
	compactNavigation = false,
	memeSeed: {
		initialMode?: 'library' | 'meme';
		memeInitialIdea?: string;
		memeInitialCandidate?: {
			template_id: string;
			caption_lines: string[];
			rationale: string;
			alt_text: string;
			template: MemeTemplate;
		};
		memeInitialPreview?: string;
	} = {},
	onConfirm: (
		mediaIDs: string[],
		media: ImageEditorMediaItem[]
	) => void | boolean | Promise<void | boolean> = vi.fn()
) {
	return render(MediaPicker, {
		props: {
			open: true,
			workspaceId: 'workspace-1',
			accept: ['image/*'],
			maxSelection: 4,
			multiple: true,
			showCreate: false,
			enableMeme,
			compactNavigation,
			...memeSeed,
			services,
			onConfirm
		}
	});
}

function constrainDialogsDuringTest(maximumWidth: number): () => void {
	const style = document.createElement('style');
	style.dataset.mediaPickerTest = 'width';
	style.textContent = `[data-slot="dialog-content"] { width: ${maximumWidth}px !important; max-width: ${maximumWidth}px !important; min-width: 0 !important; left: 0 !important; transform: none !important; }`;
	document.head.append(style);
	return () => style.remove();
}

function expectNoVisibleOverflow(root: HTMLElement, maximumWidth: number): void {
	const rootBounds = root.getBoundingClientRect();
	expect(rootBounds.width).toBeGreaterThan(0);
	expect(rootBounds.width).toBeLessThanOrEqual(maximumWidth);
	const visibleOverflow = Array.from(root.querySelectorAll<HTMLElement>('*'))
		.filter((element) => element.getClientRects().length > 0)
		.map((element) => {
			const bounds = element.getBoundingClientRect();
			return {
				tag: element.tagName,
				left: Math.round(bounds.left - rootBounds.left),
				right: Math.round(bounds.right - rootBounds.left)
			};
		})
		.filter((bounds) => bounds.left < -1 || bounds.right > rootBounds.width + 1);
	expect(visibleOverflow).toEqual([]);
}

function requireHTMLElement(element: HTMLElement | SVGElement): HTMLElement {
	if (!(element instanceof HTMLElement)) throw new Error('Expected an HTML element.');
	return element;
}

describe('MediaPicker meme source', () => {
	afterEach(() => {
		document.querySelectorAll('style[data-media-picker-test]').forEach((style) => style.remove());
	});

	beforeEach(() => {
		mocks.listMedia.mockReset().mockResolvedValue([]);
		mocks.listTags.mockReset().mockResolvedValue({ tags: [], canEdit: true });
		mocks.listTemplates.mockReset().mockResolvedValue(templateResult());
		mocks.thumbnailURL
			.mockReset()
			.mockReturnValue(`data:image/svg+xml;base64,${svgBase64('Futurama Fry')}`);
		mocks.suggest.mockReset().mockResolvedValue({ candidates: [] });
		mocks.preview.mockReset().mockImplementation(({ captions }) =>
			Promise.resolve({
				mime_type: 'image/svg+xml',
				data_base64: svgBase64(captions.join(' / '))
			})
		);
		mocks.render.mockReset();
	});

	it('never probes or shows Meme when the calling surface does not enable it', async () => {
		await page.viewport(390, 844);
		const screen = await renderPicker(false);

		await expect.element(screen.getByRole('tab', { name: 'Library' })).toBeVisible();
		await expect.element(screen.getByRole('tab', { name: 'Meme' })).not.toBeInTheDocument();
		expect(mocks.listTemplates).not.toHaveBeenCalled();
		await screen.getByRole('button', { name: 'Close' }).click();
		await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
	});

	it('keeps the picker open when the caller rejects a selection', async () => {
		mocks.listMedia.mockResolvedValue([overlayMedia]);
		const onConfirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
		const screen = await renderPicker(false, false, {}, onConfirm);

		await screen.getByRole('button', { name: 'Select Team photo.png' }).click();
		await screen.getByRole('button', { name: m.media_picker_add_media() }).click();

		await expect.element(screen.getByRole('dialog')).toBeVisible();
		await expect.element(screen.getByRole('alert')).toHaveTextContent(m.media_picker_add_failed());
		expect(onConfirm).toHaveBeenCalledTimes(1);

		await screen.getByRole('button', { name: m.media_picker_add_media() }).click();
		await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
		expect(onConfirm).toHaveBeenCalledTimes(2);
	});

	it('keeps Meme hidden when the renderer is not configured', async () => {
		mocks.listTemplates.mockResolvedValue(templateResult(false));
		const screen = await renderPicker(true);

		await vi.waitFor(() =>
			expect(mocks.listTemplates).toHaveBeenCalledWith(
				expect.objectContaining({ workspaceId: 'workspace-1', limit: 1 })
			)
		);
		await expect.element(screen.getByRole('tab', { name: 'Meme' })).not.toBeInTheDocument();
		await screen.getByRole('button', { name: 'Close' }).click();
		await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
	});

	it('shows the configured Meme source without overflowing at 390px', async () => {
		await page.viewport(390, 844);
		const releaseWidth = constrainDialogsDuringTest(390);
		try {
			const screen = await renderPicker(true);
			const memeTab = screen.getByRole('tab', { name: 'Meme' });

			await expect.element(memeTab).toBeVisible();
			await memeTab.click();
			await expect.element(screen.getByRole('heading', { name: 'Make a meme' })).toBeVisible();

			const dialog = requireHTMLElement(screen.getByRole('dialog').element());
			expectNoVisibleOverflow(dialog, 390);
			await page.screenshot({
				element: dialog,
				path: '../../../.svelte-kit/openpost-media-picker-meme-390.png'
			});
			await screen.getByRole('button', { name: 'Close' }).click();
			await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
		} finally {
			releaseWidth();
		}
	});

	it('opens a seeded meme recommendation after the availability check', async () => {
		const initialCandidate = {
			template_id: template.id,
			caption_lines: ['The plan', 'What production did'],
			rationale: 'The contrast carries the joke.',
			alt_text: 'Futurama Fry meme. Text: The plan; What production did.',
			template
		};
		const screen = await renderPicker(true, false, {
			initialMode: 'meme',
			memeInitialIdea: 'A release that ignored the plan',
			memeInitialCandidate: initialCandidate,
			memeInitialPreview: `data:image/svg+xml;base64,${svgBase64('The plan / What production did')}`
		});

		await expect
			.element(screen.getByRole('tab', { name: m.media_picker_meme() }))
			.toHaveAttribute('aria-selected', 'true');
		await expect
			.element(screen.getByLabelText(m.meme_generator_caption_label({ number: 1 })))
			.toHaveValue('The plan');
		expect(mocks.suggest).not.toHaveBeenCalled();
		expect(mocks.preview).not.toHaveBeenCalled();
	});

	it('uses the desktop viewport for a full Meme workbench', async () => {
		await page.viewport(1280, 900);
		const screen = await renderPicker(true);

		await screen.getByRole('tab', { name: 'Meme' }).click();
		await expect.element(screen.getByRole('heading', { name: 'Make a meme' })).toBeVisible();
		const dialog = requireHTMLElement(screen.getByRole('dialog').element());
		const generator = dialog.querySelector<HTMLElement>('.meme-generator');
		if (!generator) throw new Error('Expected the Meme generator in the media picker.');
		const dialogBox = dialog.getBoundingClientRect();
		const generatorBox = generator.getBoundingClientRect();

		expect(dialogBox.width).toBeGreaterThanOrEqual(1100);
		expect(dialogBox.height).toBeGreaterThanOrEqual(800);
		expect(generatorBox.height).toBeGreaterThanOrEqual(700);
		await screen.getByRole('button', { name: 'Close' }).click();
		await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
	});

	it('expands compact source navigation when the dialog has desktop space', async () => {
		await page.viewport(1280, 900);
		const screen = await renderPicker(true, true);

		await expect.element(screen.getByRole('tab', { name: 'Stock media' })).toBeVisible();
		await expect.element(screen.getByRole('tab', { name: 'Meme' })).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'More' })).not.toBeInTheDocument();
		await screen.getByRole('button', { name: 'Close' }).click();
		await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
	});

	it('keeps a degraded Meme path usable and recovers an overlay picker at 320px', async () => {
		await page.viewport(320, 780);
		const releaseWidth = constrainDialogsDuringTest(320);
		let overlayRequests = 0;
		mocks.listTemplates.mockImplementation(({ limit }) =>
			limit === 1
				? Promise.reject(new Error('The availability check timed out.'))
				: Promise.resolve(templateResult())
		);
		mocks.listMedia.mockImplementation(
			(_workspaceId: string, _search: string, _type: string, options: { sort?: string } = {}) => {
				if (options.sort !== 'recently_used') return Promise.resolve([]);
				overlayRequests += 1;
				return overlayRequests === 1
					? Promise.reject(new Error('Media is temporarily unavailable.'))
					: Promise.resolve([overlayMedia]);
			}
		);
		const screen = await renderPicker(true);
		const memeTab = screen.getByRole('tab', { name: 'Meme' });

		await expect.element(memeTab).toBeVisible();
		const pickerDialog = screen.getByRole('dialog');
		await memeTab.click();
		await screen.getByRole('tab', { name: 'Templates' }).click();
		await screen.getByRole('button', { name: 'Use the Futurama Fry template' }).click();
		await screen.getByRole('button', { name: 'Choose image 1' }).click();

		const overlayDialog = screen.getByRole('dialog', { name: 'Replaceable images' });
		await expect
			.element(overlayDialog.getByRole('alert'))
			.toHaveTextContent('Media is temporarily unavailable.');
		expectNoVisibleOverflow(requireHTMLElement(overlayDialog.element()), 320);
		await overlayDialog.getByRole('button', { name: 'Device' }).first().click();
		await expect
			.element(overlayDialog.getByText('Drop files here or choose from your device'))
			.toBeVisible();

		await overlayDialog.getByRole('button', { name: 'Library' }).click();
		await overlayDialog.getByRole('button', { name: 'Select Team photo.png' }).click();
		await expect.element(screen.getByText('Team photo.png')).toBeVisible();
		await expect.element(overlayDialog).not.toBeInTheDocument();

		await pickerDialog.getByRole('button', { name: 'Close' }).click();
		await expect.element(pickerDialog).not.toBeInTheDocument();
		releaseWidth();
	});
});
