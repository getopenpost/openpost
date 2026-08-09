import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type {
	MemeGeneratorAPI,
	MemePreviewResult,
	MemeRenderResult,
	MemeTemplate,
	MemeTemplateListResult
} from '$lib/meme-generator/types';
import MemeGenerator from './meme-generator.svelte';
import '../../routes/layout.css';

vi.mock('$lib/paraglide/messages', () => ({
	m: new Proxy(
		{},
		{
			get(_target, property) {
				const key = String(property);
				return (input: Record<string, string | number> = {}) => {
					const messages: Record<string, string> = {
						meme_generator_title: 'Meme generator',
						meme_generator_description: 'Choose a template and review every caption.',
						meme_generator_ideas_tab: 'Make it funny',
						meme_generator_templates_tab: 'Browse templates',
						meme_generator_idea_label: 'What should the meme say?',
						meme_generator_idea_placeholder: 'Describe the situation',
						meme_generator_tone_label: 'Tone',
						meme_generator_tone_balanced: 'Balanced',
						meme_generator_tone_dry: 'Dry',
						meme_generator_tone_sarcastic: 'Sarcastic',
						meme_generator_tone_playful: 'Playful',
						meme_generator_generate: 'Generate ideas',
						meme_generator_generating: 'Writing options…',
						meme_generator_suggestions_heading: 'Pick a direction',
						meme_generator_suggestions_description: 'Choose one, then edit it.',
						meme_generator_editor_heading: 'Make it yours',
						meme_generator_editor_description: 'Review the text before attaching.',
						meme_generator_select_first_title: 'Choose a starting point',
						meme_generator_select_first_body: 'Pick an option or browse templates.',
						meme_generator_templates_heading: 'Templates',
						meme_generator_search_label: 'Search templates',
						meme_generator_search_placeholder: 'Search by name',
						meme_generator_show_more: 'Show more',
						meme_generator_animated: 'Animated',
						meme_generator_image_slots_heading: 'Replaceable images',
						meme_generator_image_slot_empty: 'No image selected',
						meme_generator_render_attach: 'Render and attach',
						meme_generator_rendering: 'Rendering…',
						meme_generator_attached: 'Meme attached.',
						meme_generator_attach_failed:
							'The meme was saved in Media, but it could not be attached. Try attaching it again.',
						meme_generator_attach_retry: 'Try attaching again',
						meme_generator_selected: 'Selected',
						meme_generator_preview_loading: 'Updating preview…',
						meme_generator_caption_too_long:
							'Shorten this caption. Some punctuation and emoji count as more than one character in Memegen.',
						meme_generator_try_another_set: 'Try another set',
						media_picker_search_action: 'Search',
						media_preview_unavailable: 'Preview unavailable',
						common_retry: 'Try again',
						common_loading: 'Loading…'
					};
					if (key === 'meme_generator_template_select') return `Use ${input.name}`;
					if (key === 'meme_generator_candidate_select') return `Use ${input.name} suggestion`;
					if (key === 'meme_generator_preview_alt') return `${input.name} preview`;
					if (key === 'meme_generator_showing_templates') return `Showing ${input.count}`;
					if (key === 'meme_generator_caption_label') return `Caption ${input.number}`;
					if (key === 'meme_generator_caption_count') {
						return `${input.current} of ${input.maximum}`;
					}
					if (key === 'meme_generator_image_slot_label') return `Image ${input.number}`;
					if (key === 'meme_generator_choose_image') return `Choose image ${input.number}`;
					if (key === 'meme_generator_replace_image') return `Replace image ${input.number}`;
					if (key === 'meme_generator_remove_image') return `Remove image ${input.number}`;
					return messages[key] ?? key;
				};
			}
		}
	)
}));

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
	animated: false
};

function makeTemplate(
	id: string,
	name: string,
	overrides: Partial<MemeTemplate> = {}
): MemeTemplate {
	return {
		...template,
		id,
		name,
		overlays: 0,
		blank_url: '',
		source_url: '',
		keywords: [id],
		search_terms: [id, name.toLowerCase()],
		example: { text: ['first line', 'second line'], url: '' },
		...overrides
	};
}

function memeImageBase64(lines: string[]): string {
	const [top = '', bottom = ''] = lines;
	return btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
		<rect width="640" height="480" fill="#232329"/>
		<circle cx="320" cy="250" r="142" fill="#d8792f" opacity=".88"/>
		<circle cx="275" cy="220" r="12" fill="#19191e"/>
		<circle cx="365" cy="220" r="12" fill="#19191e"/>
		<path d="M255 295 Q320 335 385 295" fill="none" stroke="#19191e" stroke-width="14" stroke-linecap="round"/>
		<text x="320" y="58" text-anchor="middle" font-family="Arial, sans-serif" font-size="32" font-weight="700" fill="white">${top}</text>
		<text x="320" y="447" text-anchor="middle" font-family="Arial, sans-serif" font-size="32" font-weight="700" fill="white">${bottom}</text>
	</svg>`);
}

function previewResult(lines: string[] = [], templateId = 'fry'): MemePreviewResult {
	return {
		template_id: templateId,
		mime_type: 'image/svg+xml',
		data_base64: memeImageBase64(lines)
	};
}

function templateListResult(
	templates: MemeTemplate[],
	totalTemplates = templates.length
): MemeTemplateListResult {
	return {
		templates,
		configured: true,
		ai_configured: true,
		catalog: {
			provider_key: 'memegen',
			returned: templates.length,
			revision: 'catalog-1',
			stale: false,
			total_templates: totalTemplates
		}
	};
}

function renderResult(
	selectedTemplate: MemeTemplate = template,
	format: 'png' | 'gif' = 'png'
): MemeRenderResult {
	const mimeType = format === 'gif' ? 'image/gif' : 'image/png';
	return {
		media: {
			id: 'media-meme-1',
			alt_text: `${selectedTemplate.name} meme.`,
			analysis_status: 'ready',
			asset_kind: 'library',
			deduped: false,
			mime_type: mimeType,
			original_filename: `${selectedTemplate.id}.${format}`,
			processing_progress: 100,
			processing_status: 'ready',
			retention_class: 'library',
			size: 128,
			source: 'meme_generator',
			url: '/media/media-meme-1'
		},
		recipe: {
			media_id: 'media-meme-1',
			workspace_id: 'workspace-1',
			created_by_id: 'user-1',
			kind: 'meme',
			renderer_key: 'memegen',
			template_id: selectedTemplate.id,
			template_name: selectedTemplate.name,
			created_at: '2026-08-09T12:00:00Z',
			recipe: {
				schema_version: 1,
				renderer_key: 'memegen',
				catalog_revision: 'catalog-1',
				template: {
					id: selectedTemplate.id,
					name: selectedTemplate.name,
					lines: selectedTemplate.lines,
					overlays: selectedTemplate.overlays
				},
				captions: selectedTemplate.example.text,
				overlay_media_ids: selectedTemplate.overlays > 0 ? ['overlay-1'] : [],
				format,
				rendered_mime_type: mimeType
			}
		}
	};
}

function mockAPI(overrides: Partial<MemeGeneratorAPI> = {}): MemeGeneratorAPI {
	return {
		listTemplates: vi.fn().mockResolvedValue(templateListResult([template])),
		thumbnail: vi.fn().mockResolvedValue({
			template_id: 'fry',
			mime_type: 'image/svg+xml',
			data_base64: memeImageBase64(['NOT SURE IF', 'OR JUST CAREFUL'])
		}),
		suggest: vi.fn().mockResolvedValue({ candidates: [] }),
		preview: vi
			.fn()
			.mockImplementation(({ captions, templateId }) =>
				Promise.resolve(previewResult(captions, templateId))
			),
		render: vi.fn().mockResolvedValue(renderResult()),
		...overrides
	};
}

function widthConstrainedTarget(width: number): HTMLElement {
	const target = document.createElement('div');
	target.style.width = `${width}px`;
	target.style.maxWidth = `${width}px`;
	target.style.minWidth = '0';
	target.style.position = 'absolute';
	target.style.inset = '0 auto auto 0';
	document.body.append(target);
	return target;
}

function componentRoot(container: HTMLElement): HTMLElement {
	const generator = container.querySelector<HTMLElement>('.meme-generator');
	if (!generator) throw new Error('Meme generator root was not rendered.');
	return generator;
}

function expectNoVisibleComponentOverflow(generator: HTMLElement, maximumWidth: number): void {
	const rootBounds = generator.getBoundingClientRect();
	expect(rootBounds.width).toBeLessThanOrEqual(maximumWidth);
	const visibleOverflow = Array.from(generator.querySelectorAll<HTMLElement>('*'))
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

	const activePanel = generator.querySelector<HTMLElement>(
		'[role="tabpanel"][data-state="active"]'
	);
	if (activePanel) expect(activePanel.scrollWidth).toBeLessThanOrEqual(activePanel.clientWidth);
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (cause: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

describe('MemeGenerator', () => {
	it('edits a manual template, fills an image slot, and attaches without overflow at 390px', async () => {
		await page.viewport(390, 844);
		const target = widthConstrainedTarget(390);
		const api = mockAPI();
		const onAttach = vi.fn();
		const onPickOverlay = vi.fn().mockResolvedValue({
			media_id: 'overlay-1',
			preview_url: 'data:image/png;base64,b3ZlcmxheQ==',
			name: 'Team photo'
		});
		const screen = await render(MemeGenerator, {
			target,
			props: { workspaceId: 'workspace-1', api, onAttach, onPickOverlay }
		});
		const generator = componentRoot(screen.container);

		await screen.getByRole('tab', { name: 'Browse templates' }).click();
		await screen.getByRole('button', { name: 'Use Futurama Fry' }).click();
		await screen.getByLabelText('Caption 1').fill('CI passed');
		await screen.getByLabelText('Caption 2').fill('production disagreed');
		await screen.getByRole('button', { name: 'Choose image 1' }).click();
		const attachButton = screen.getByRole('button', { name: 'Render and attach' });
		await expect.element(attachButton).toBeEnabled();
		await attachButton.click();

		expect(onPickOverlay).toHaveBeenCalledWith(0, null);
		expect(api.render).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceId: 'workspace-1',
				templateId: 'fry',
				captions: ['CI passed', 'production disagreed'],
				overlayMediaIds: ['overlay-1'],
				format: 'png'
			})
		);
		expect(onAttach).toHaveBeenCalledWith(
			expect.objectContaining({ media: expect.objectContaining({ id: 'media-meme-1' }) })
		);
		await expect.element(screen.getByText('Meme attached.').first()).toBeVisible();
		expectNoVisibleComponentOverflow(generator, 390);
	});

	it('keeps candidate and template cards usable at desktop size', async () => {
		await page.viewport(1280, 900);
		const target = widthConstrainedTarget(1200);
		const candidate = {
			template_id: 'fry',
			caption_lines: ['tests are green', 'users found the other branch'],
			alt_text: 'Futurama Fry doubts a green test suite.',
			rationale: 'A dry contrast between the signal and reality.',
			template
		};
		const api = mockAPI({
			suggest: vi.fn().mockResolvedValue({ candidates: [candidate] })
		});
		const screen = await render(MemeGenerator, {
			target,
			props: { workspaceId: 'workspace-1', api, onAttach: vi.fn() }
		});

		await screen
			.getByLabelText('What should the meme say?')
			.fill('Tests passed but users found it');
		await screen.getByRole('button', { name: 'Generate ideas' }).click();
		const candidateButton = screen.getByRole('button', {
			name: 'Use Futurama Fry suggestion'
		});
		await expect.element(candidateButton).toBeVisible();
		const candidateBox = candidateButton.element().getBoundingClientRect();
		expect(candidateBox.width).toBeGreaterThan(160);
		expect(candidateBox.height).toBeGreaterThan(150);

		await candidateButton.click();
		await expect.element(screen.getByLabelText('Caption 1')).toHaveValue('tests are green');
		await expect
			.element(screen.getByText('A dry contrast between the signal and reality.'))
			.toBeVisible();
		expect(api.suggest).toHaveBeenCalledWith(
			expect.objectContaining({
				idea: 'Tests passed but users found it',
				tone: 'balanced',
				language: 'en',
				count: 4
			})
		);
		expect(api.preview).toHaveBeenCalledWith(
			expect.objectContaining({ format: 'webp', templateId: 'fry' })
		);
		expect(screen.container.textContent).not.toContain('memegen.link');

		await screen.getByRole('tab', { name: 'Browse templates' }).click();
		const templateButton = screen.getByRole('button', { name: 'Use Futurama Fry' });
		await expect.element(templateButton).toBeVisible();
		const templateBox = templateButton.element().getBoundingClientRect();
		expect(templateBox.width).toBeGreaterThan(160);
		expect(templateBox.height).toBeGreaterThan(150);
	});

	it('keeps an AI-only template editable after the candidate copy changes', async () => {
		await page.viewport(1000, 800);
		const aiOnlyTemplate = makeTemplate('doge', 'Doge', {
			example: { text: ['release looked quiet', 'alerts joined the chat'], url: '' }
		});
		const candidate = {
			template_id: aiOnlyTemplate.id,
			caption_lines: ['release looked quiet', 'alerts joined the chat'],
			alt_text: 'Doge watches a release become noisy.',
			rationale: 'The template is not in the first catalog page.',
			template: aiOnlyTemplate
		};
		const api = mockAPI({
			suggest: vi.fn().mockResolvedValue({ candidates: [candidate] })
		});
		const screen = await render(MemeGenerator, {
			props: { workspaceId: 'workspace-1', api, onAttach: vi.fn() }
		});

		await screen.getByLabelText('What should the meme say?').fill('A noisy release');
		await screen.getByRole('button', { name: 'Generate ideas' }).click();
		await screen.getByRole('button', { name: 'Use Doge suggestion' }).click();
		await screen.getByLabelText('Caption 1').fill('release stayed quiet');

		await expect.element(screen.getByLabelText('Caption 2')).toHaveValue('alerts joined the chat');
		await expect.element(screen.getByRole('button', { name: 'Render and attach' })).toBeEnabled();
		expect(api.preview).toHaveBeenCalledWith(
			expect.objectContaining({
				templateId: 'doge',
				captions: ['release stayed quiet', 'alerts joined the chat']
			})
		);
	});

	it('does not attach a stale preview and remains disabled when the current preview fails', async () => {
		await page.viewport(900, 800);
		const stalePreview = deferred<MemePreviewResult>();
		const currentPreview = deferred<MemePreviewResult>();
		const preview = vi
			.fn()
			.mockResolvedValueOnce(previewResult(template.example.text))
			.mockImplementationOnce(() => stalePreview.promise)
			.mockImplementationOnce(() => currentPreview.promise);
		const api = mockAPI({ preview });
		const screen = await render(MemeGenerator, {
			props: { workspaceId: 'workspace-1', api, onAttach: vi.fn() }
		});

		await screen.getByRole('tab', { name: 'Browse templates' }).click();
		await screen.getByRole('button', { name: 'Use Futurama Fry' }).click();
		const attachButton = screen.getByRole('button', { name: 'Render and attach' });
		await expect.element(attachButton).toBeEnabled();

		await screen.getByLabelText('Caption 1').fill('first edit');
		await vi.waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
		await screen.getByLabelText('Caption 1').fill('current edit');
		await expect.element(attachButton).toBeDisabled();
		await vi.waitFor(() => expect(preview).toHaveBeenCalledTimes(3));

		stalePreview.resolve(previewResult(['first edit', 'or just careful']));
		await expect.element(attachButton).toBeDisabled();
		currentPreview.reject(new Error('Preview service unavailable'));
		await expect.element(screen.getByText('Preview service unavailable')).toBeVisible();
		await expect.element(attachButton).toBeDisabled();
		expect(api.render).not.toHaveBeenCalled();
	});

	it('retries only attachment when the rendered meme is already saved', async () => {
		await page.viewport(900, 800);
		const api = mockAPI();
		const onAttach = vi
			.fn()
			.mockRejectedValueOnce(new Error('Composer unavailable'))
			.mockResolvedValueOnce(undefined);
		const screen = await render(MemeGenerator, {
			props: { workspaceId: 'workspace-1', api, onAttach }
		});

		await screen.getByRole('tab', { name: 'Browse templates' }).click();
		await screen.getByRole('button', { name: 'Use Futurama Fry' }).click();
		const renderButton = screen.getByRole('button', { name: 'Render and attach' });
		await expect.element(renderButton).toBeEnabled();
		await renderButton.click();

		await expect
			.element(
				screen.getByText(
					'The meme was saved in Media, but it could not be attached. Try attaching it again.'
				)
			)
			.toBeVisible();
		const retryButton = screen.getByRole('button', { name: 'Try attaching again' });
		await expect.element(retryButton).toBeEnabled();
		expect(api.render).toHaveBeenCalledTimes(1);
		expect(onAttach).toHaveBeenCalledTimes(1);

		await retryButton.click();
		await expect.element(screen.getByText('Meme attached.').first()).toBeVisible();
		expect(api.render).toHaveBeenCalledTimes(1);
		expect(onAttach).toHaveBeenCalledTimes(2);
	});

	it('renders animated templates as GIFs', async () => {
		await page.viewport(900, 800);
		const animatedTemplate = makeTemplate('animated-drake', 'Animated Drake', {
			animated: true
		});
		const api = mockAPI({
			listTemplates: vi.fn().mockResolvedValue(templateListResult([animatedTemplate])),
			thumbnail: vi.fn().mockResolvedValue({
				template_id: animatedTemplate.id,
				mime_type: 'image/svg+xml',
				data_base64: memeImageBase64(animatedTemplate.example.text)
			}),
			render: vi.fn().mockResolvedValue(renderResult(animatedTemplate, 'gif'))
		});
		const onAttach = vi.fn();
		const screen = await render(MemeGenerator, {
			props: { workspaceId: 'workspace-1', api, onAttach }
		});

		await screen.getByRole('tab', { name: 'Browse templates' }).click();
		await screen.getByRole('button', { name: 'Use Animated Drake' }).click();
		const attachButton = screen.getByRole('button', { name: 'Render and attach' });
		await expect.element(attachButton).toBeEnabled();
		await attachButton.click();

		expect(api.render).toHaveBeenCalledWith(
			expect.objectContaining({ templateId: 'animated-drake', format: 'gif' })
		);
		expect(onAttach).toHaveBeenCalledOnce();
	});

	it('loads later templates with Show more', async () => {
		await page.viewport(1000, 800);
		const allTemplates = Array.from({ length: 25 }, (_, index) =>
			makeTemplate(
				`template-${index + 1}`,
				index === 24 ? 'Late Template' : `Template ${String(index + 1).padStart(2, '0')}`
			)
		);
		const listTemplates = vi
			.fn()
			.mockImplementation(({ limit = 24 }) =>
				Promise.resolve(templateListResult(allTemplates.slice(0, limit), allTemplates.length))
			);
		const api = mockAPI({ listTemplates });
		const screen = await render(MemeGenerator, {
			props: { workspaceId: 'workspace-1', api, onAttach: vi.fn() }
		});

		await screen.getByRole('tab', { name: 'Browse templates' }).click();
		await expect.element(screen.getByText('Showing 24')).toBeVisible();
		await screen.getByRole('button', { name: 'Show more' }).click();

		await expect.element(screen.getByRole('button', { name: 'Use Late Template' })).toBeVisible();
		expect(listTemplates).toHaveBeenLastCalledWith(
			expect.objectContaining({ query: '', limit: 48 })
		);
	});

	it("explains Memegen's encoded caption limit without component overflow at 320px", async () => {
		await page.viewport(320, 720);
		const target = widthConstrainedTarget(320);
		const api = mockAPI();
		const screen = await render(MemeGenerator, {
			target,
			props: { workspaceId: 'workspace-1', api, onAttach: vi.fn() }
		});
		const generator = componentRoot(screen.container);

		await screen.getByRole('tab', { name: 'Browse templates' }).click();
		await screen.getByRole('button', { name: 'Use Futurama Fry' }).click();
		await screen.getByLabelText('Caption 1').fill('?'.repeat(101));

		await expect.element(screen.getByText('202 of 200')).toBeVisible();
		await expect
			.element(
				screen.getByText(
					'Shorten this caption. Some punctuation and emoji count as more than one character in Memegen.'
				)
			)
			.toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Render and attach' })).toBeDisabled();
		expect(api.render).not.toHaveBeenCalled();
		expectNoVisibleComponentOverflow(generator, 320);
	});
});
