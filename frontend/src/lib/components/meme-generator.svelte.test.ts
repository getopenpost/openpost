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
import { m } from '$lib/paraglide/messages';
import MemeGenerator from './meme-generator.svelte';
import '../../routes/layout.css';

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
			provider_key: 'openpost',
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
			renderer_key: 'openpost',
			template_id: selectedTemplate.id,
			template_name: selectedTemplate.name,
			created_at: '2026-08-09T12:00:00Z',
			recipe: {
				schema_version: 1,
				renderer_key: 'openpost',
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
		thumbnailURL: vi
			.fn()
			.mockReturnValue(
				`data:image/svg+xml;base64,${memeImageBase64(['NOT SURE IF', 'OR JUST CAREFUL'])}`
			),
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

		await screen.getByRole('tab', { name: m.meme_generator_templates_tab() }).click();
		await screen
			.getByRole('button', {
				name: m.meme_generator_template_select({ name: template.name })
			})
			.click();
		await screen.getByLabelText(m.meme_generator_caption_label({ number: 1 })).fill('CI passed');
		await screen
			.getByLabelText(m.meme_generator_caption_label({ number: 2 }))
			.fill('production disagreed');
		await screen
			.getByRole('button', {
				name: m.meme_generator_choose_image({ number: 1 })
			})
			.click();
		const attachButton = screen.getByRole('button', {
			name: m.meme_generator_render_attach()
		});
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
			expect.objectContaining({
				media: expect.objectContaining({ id: 'media-meme-1' })
			})
		);
		await expect.element(screen.getByText(m.meme_generator_attached()).first()).toBeVisible();
		expectNoVisibleComponentOverflow(generator, 390);
	});

	it('opens a seeded recommendation without requesting another suggestion or preview', async () => {
		const api = mockAPI();
		const initialCandidate = {
			template_id: template.id,
			caption_lines: ['The plan', 'What production did'],
			rationale: 'The contrast carries the joke.',
			alt_text: 'Futurama Fry meme. Text: The plan; What production did.',
			template
		};
		const screen = await render(MemeGenerator, {
			props: {
				workspaceId: 'workspace-1',
				api,
				onAttach: vi.fn(),
				initialIdea: 'A release that ignored the plan',
				initialCandidate,
				initialPreview: `data:image/svg+xml;base64,${memeImageBase64(initialCandidate.caption_lines)}`
			}
		});

		await expect
			.element(screen.getByLabelText(m.meme_generator_caption_label({ number: 1 })))
			.toHaveValue('The plan');
		await expect
			.element(screen.getByLabelText(m.meme_generator_caption_label({ number: 2 })))
			.toHaveValue('What production did');
		expect(api.suggest).not.toHaveBeenCalled();
		expect(api.preview).not.toHaveBeenCalled();
		await expect
			.element(screen.getByRole('button', { name: m.meme_generator_render_attach() }))
			.toBeEnabled();
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
			.getByLabelText(m.meme_generator_idea_label())
			.fill('Tests passed but users found it');
		await screen.getByRole('button', { name: m.meme_generator_generate() }).click();
		const candidateButton = screen.getByRole('button', {
			name: m.meme_generator_candidate_select({ name: template.name })
		});
		await expect.element(candidateButton).toBeVisible();
		const candidateBox = candidateButton.element().getBoundingClientRect();
		expect(candidateBox.width).toBeGreaterThan(160);
		expect(candidateBox.height).toBeGreaterThan(150);

		await candidateButton.click();
		await expect
			.element(screen.getByLabelText(m.meme_generator_caption_label({ number: 1 })))
			.toHaveValue('tests are green');
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

		await screen.getByRole('tab', { name: m.meme_generator_templates_tab() }).click();
		const templateButton = screen.getByRole('button', {
			name: m.meme_generator_template_select({ name: template.name })
		});
		await expect.element(templateButton).toBeVisible();
		const templateBox = templateButton.element().getBoundingClientRect();
		expect(templateBox.width).toBeGreaterThan(160);
		expect(templateBox.height).toBeGreaterThan(150);
	});

	it('recovers failed and canceled candidate previews without leaving cards pending', async () => {
		await page.viewport(1280, 900);
		const candidateTemplates = [
			makeTemplate('first', 'First Template'),
			makeTemplate('second', 'Second Template'),
			makeTemplate('third', 'Third Template'),
			makeTemplate('fourth', 'Fourth Template')
		];
		const candidates = candidateTemplates.map((candidateTemplate, index) => ({
			template_id: candidateTemplate.id,
			caption_lines: [`setup ${index + 1}`, `punchline ${index + 1}`],
			alt_text: `${candidateTemplate.name} meme.`,
			rationale: `Direction ${index + 1}`,
			template: candidateTemplate
		}));
		const canceledBackgroundPreview = deferred<MemePreviewResult>();
		const preview = vi
			.fn()
			.mockResolvedValueOnce(previewResult(candidates[0].caption_lines, 'first'))
			.mockResolvedValueOnce(previewResult(candidates[1].caption_lines, 'second'))
			.mockRejectedValueOnce(new Error('Temporary renderer failure'))
			.mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => {
				signal?.addEventListener(
					'abort',
					() =>
						canceledBackgroundPreview.reject(
							new DOMException('Preview request canceled', 'AbortError')
						),
					{ once: true }
				);
				return canceledBackgroundPreview.promise;
			})
			.mockResolvedValueOnce(previewResult(candidates[3].caption_lines, 'fourth'))
			.mockResolvedValueOnce(previewResult(candidates[2].caption_lines, 'third'));
		const api = mockAPI({
			suggest: vi.fn().mockResolvedValue({ candidates }),
			preview
		});
		const screen = await render(MemeGenerator, {
			props: { workspaceId: 'workspace-1', api, onAttach: vi.fn() }
		});

		await screen.getByLabelText(m.meme_generator_idea_label()).fill('Four preview states');
		await screen.getByRole('button', { name: m.meme_generator_generate() }).click();
		const firstCandidate = screen.getByRole('button', {
			name: m.meme_generator_candidate_select({
				name: candidateTemplates[0].name
			})
		});
		const secondCandidate = screen.getByRole('button', {
			name: m.meme_generator_candidate_select({
				name: candidateTemplates[1].name
			})
		});
		await vi.waitFor(() => {
			expect(firstCandidate.element().querySelector('img')).not.toBeNull();
			expect(secondCandidate.element().querySelector('img')).not.toBeNull();
		});
		await expect
			.element(screen.getByText(m.meme_generator_candidate_preview_failed()))
			.toBeVisible();
		await expect
			.element(
				screen.getByRole('button', {
					name: m.meme_generator_candidate_preview_retry()
				})
			)
			.toBeVisible();
		expect(screen.container.textContent).not.toContain('Preview pending');

		await screen
			.getByRole('button', {
				name: m.meme_generator_candidate_select({
					name: candidateTemplates[3].name
				})
			})
			.click();
		await expect
			.element(screen.getByRole('button', { name: m.meme_generator_render_attach() }))
			.toBeEnabled();
		await vi.waitFor(() =>
			expect(
				screen
					.getByRole('button', {
						name: m.meme_generator_candidate_select({
							name: candidateTemplates[3].name
						})
					})
					.element()
					.querySelector('img')
			).not.toBeNull()
		);

		await screen.getByRole('button', { name: m.meme_generator_candidate_preview_retry() }).click();
		await vi.waitFor(() =>
			expect(
				screen
					.getByRole('button', {
						name: m.meme_generator_candidate_select({
							name: candidateTemplates[2].name
						})
					})
					.element()
					.querySelector('img')
			).not.toBeNull()
		);
		await expect
			.element(screen.getByRole('button', { name: m.meme_generator_render_attach() }))
			.toBeEnabled();
		expect(screen.container.textContent).not.toContain('Preview pending');
	});

	it('keeps an AI-only template editable after the candidate copy changes', async () => {
		await page.viewport(1000, 800);
		const aiOnlyTemplate = makeTemplate('doge', 'Doge', {
			example: {
				text: ['release looked quiet', 'alerts joined the chat'],
				url: ''
			}
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

		await screen.getByLabelText(m.meme_generator_idea_label()).fill('A noisy release');
		await screen.getByRole('button', { name: m.meme_generator_generate() }).click();
		await screen
			.getByRole('button', {
				name: m.meme_generator_candidate_select({ name: aiOnlyTemplate.name })
			})
			.click();
		await screen
			.getByLabelText(m.meme_generator_caption_label({ number: 1 }))
			.fill('release stayed quiet');

		await expect
			.element(screen.getByLabelText(m.meme_generator_caption_label({ number: 2 })))
			.toHaveValue('alerts joined the chat');
		await expect
			.element(screen.getByRole('button', { name: m.meme_generator_render_attach() }))
			.toBeEnabled();
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

		await screen.getByRole('tab', { name: m.meme_generator_templates_tab() }).click();
		await screen
			.getByRole('button', {
				name: m.meme_generator_template_select({ name: template.name })
			})
			.click();
		const attachButton = screen.getByRole('button', {
			name: m.meme_generator_render_attach()
		});
		await expect.element(attachButton).toBeEnabled();

		await screen.getByLabelText(m.meme_generator_caption_label({ number: 1 })).fill('first edit');
		await vi.waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
		await screen.getByLabelText(m.meme_generator_caption_label({ number: 1 })).fill('current edit');
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

		await screen.getByRole('tab', { name: m.meme_generator_templates_tab() }).click();
		await screen
			.getByRole('button', {
				name: m.meme_generator_template_select({ name: template.name })
			})
			.click();
		const renderButton = screen.getByRole('button', {
			name: m.meme_generator_render_attach()
		});
		await expect.element(renderButton).toBeEnabled();
		await renderButton.click();

		await expect
			.element(
				screen.getByText(
					'The meme was saved in Media, but it could not be attached. Try attaching it again.'
				)
			)
			.toBeVisible();
		const retryButton = screen.getByRole('button', {
			name: m.meme_generator_attach_retry()
		});
		await expect.element(retryButton).toBeEnabled();
		expect(api.render).toHaveBeenCalledTimes(1);
		expect(onAttach).toHaveBeenCalledTimes(1);

		await retryButton.click();
		await expect.element(screen.getByText(m.meme_generator_attached()).first()).toBeVisible();
		expect(api.render).toHaveBeenCalledTimes(1);
		expect(onAttach).toHaveBeenCalledTimes(2);
	});

	it('keeps the rendered meme for retry when attachment is explicitly rejected', async () => {
		await page.viewport(900, 800);
		const api = mockAPI();
		const onAttach = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
		const screen = await render(MemeGenerator, {
			props: { workspaceId: 'workspace-1', api, onAttach }
		});

		await screen.getByRole('tab', { name: m.meme_generator_templates_tab() }).click();
		await screen
			.getByRole('button', {
				name: m.meme_generator_template_select({ name: template.name })
			})
			.click();
		await screen.getByRole('button', { name: m.meme_generator_render_attach() }).click();

		await expect.element(screen.getByText(m.meme_generator_attach_failed())).toBeVisible();
		const retryButton = screen.getByRole('button', {
			name: m.meme_generator_attach_retry()
		});
		await expect.element(retryButton).toBeEnabled();
		expect(api.render).toHaveBeenCalledTimes(1);
		expect(onAttach).toHaveBeenCalledTimes(1);

		await retryButton.click();
		await expect.element(screen.getByText(m.meme_generator_attached()).first()).toBeVisible();
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
			thumbnailURL: vi
				.fn()
				.mockReturnValue(
					`data:image/svg+xml;base64,${memeImageBase64(animatedTemplate.example.text)}`
				),
			render: vi.fn().mockResolvedValue(renderResult(animatedTemplate, 'gif'))
		});
		const onAttach = vi.fn();
		const screen = await render(MemeGenerator, {
			props: { workspaceId: 'workspace-1', api, onAttach }
		});

		await screen.getByRole('tab', { name: m.meme_generator_templates_tab() }).click();
		await screen
			.getByRole('button', {
				name: m.meme_generator_template_select({ name: animatedTemplate.name })
			})
			.click();
		const attachButton = screen.getByRole('button', {
			name: m.meme_generator_render_attach()
		});
		await expect.element(attachButton).toBeEnabled();
		await attachButton.click();

		expect(api.render).toHaveBeenCalledWith(
			expect.objectContaining({ templateId: 'animated-drake', format: 'gif' })
		);
		expect(onAttach).toHaveBeenCalledOnce();
	});

	it('loads later templates with Show more', async () => {
		await page.viewport(1000, 800);
		const allTemplates = Array.from({ length: 49 }, (_, index) =>
			makeTemplate(
				`template-${index + 1}`,
				index === 48 ? 'Late Template' : `Template ${String(index + 1).padStart(2, '0')}`
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

		await screen.getByRole('tab', { name: m.meme_generator_templates_tab() }).click();
		await expect
			.element(screen.getByText(m.meme_generator_showing_templates({ count: 48 })))
			.toBeVisible();
		await screen.getByRole('button', { name: m.meme_generator_show_more() }).click();

		await expect
			.element(
				screen.getByRole('button', {
					name: m.meme_generator_template_select({ name: 'Late Template' })
				})
			)
			.toBeVisible();
		expect(listTemplates).toHaveBeenLastCalledWith(
			expect.objectContaining({ query: '', limit: 96 })
		);
	});

	it('counts visible caption characters without penalizing punctuation at 320px', async () => {
		await page.viewport(320, 720);
		const target = widthConstrainedTarget(320);
		const api = mockAPI();
		const screen = await render(MemeGenerator, {
			target,
			props: { workspaceId: 'workspace-1', api, onAttach: vi.fn() }
		});
		const generator = componentRoot(screen.container);

		await screen.getByRole('tab', { name: m.meme_generator_templates_tab() }).click();
		await screen
			.getByRole('button', {
				name: m.meme_generator_template_select({ name: template.name })
			})
			.click();
		await screen
			.getByLabelText(m.meme_generator_caption_label({ number: 1 }))
			.fill('?'.repeat(101));

		await expect
			.element(screen.getByText(m.meme_generator_caption_count({ current: 101, maximum: 200 })))
			.toBeVisible();
		await expect
			.element(screen.getByRole('button', { name: m.meme_generator_render_attach() }))
			.toBeEnabled();
		expect(api.render).not.toHaveBeenCalled();
		expectNoVisibleComponentOverflow(generator, 320);
	});
});
