import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { client } from '$lib/api/client';
import type { ScreenshotDocument } from '@openpost/query-catalog';
import type {
	MemeGeneratorAPI,
	MemePreviewResult,
	MemeTemplate,
	MemeTemplateListResult
} from '$lib/meme-generator/types';
import { m } from '$lib/paraglide/messages';
import MemeBrowser from '$lib/meme-generator/browser.svelte';
import MemeGenerator from './meme-generator.svelte';
import '../../routes/layout.css';

afterEach(() => vi.restoreAllMocks());

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

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
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
		render: vi.fn(),
		...overrides
	};
}

describe('Meme template browsing', () => {
	it('sends the idea and preview request shape when generating candidates', async () => {
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
		const screen = await render(MemeBrowser, {
			props: { workspaceId: 'workspace-1', api, onSelect: vi.fn() }
		});

		await screen.getByRole('tab', { name: m.meme_generator_ideas_tab() }).click();
		await screen
			.getByLabelText(m.meme_generator_idea_label())
			.fill('Tests passed but users found it');
		await screen.getByRole('button', { name: m.meme_generator_generate() }).click();
		const candidateButton = screen.getByRole('button', {
			name: m.meme_generator_candidate_select({ name: template.name })
		});
		await expect.element(candidateButton).toBeVisible();

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
	});

	it('queues candidate previews within the server render limit', async () => {
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
		let activeRenders = 0;
		const preview = vi.fn().mockImplementation(async ({ captions, templateId }) => {
			if (activeRenders >= 2) throw new Error('another meme render is still running');
			activeRenders += 1;
			await new Promise((resolve) => setTimeout(resolve, 20));
			activeRenders -= 1;
			return previewResult(captions, templateId);
		});
		const api = mockAPI({
			suggest: vi.fn().mockResolvedValue({ candidates }),
			preview
		});
		const screen = await render(MemeBrowser, {
			props: { workspaceId: 'workspace-1', api, onSelect: vi.fn() }
		});

		await screen.getByRole('tab', { name: m.meme_generator_ideas_tab() }).click();
		await screen.getByLabelText(m.meme_generator_idea_label()).fill('Four reliable previews');
		await screen.getByRole('button', { name: m.meme_generator_generate() }).click();

		await vi.waitFor(() => {
			for (const candidateTemplate of candidateTemplates) {
				const candidateButton = screen.getByRole('button', {
					name: m.meme_generator_candidate_select({ name: candidateTemplate.name })
				});
				expect(candidateButton.element().querySelector('img')).not.toBeNull();
			}
		});
		expect(
			screen.getByRole('button', { name: m.meme_generator_candidate_preview_retry() }).elements()
		).toHaveLength(0);
		expect(preview).toHaveBeenCalledTimes(4);
	});

	it('passes a chosen template and captions into the shared editor, and allows retry after draft creation fails', async () => {
		const onSelect = vi
			.fn()
			.mockRejectedValueOnce(new Error('Draft could not be saved'))
			.mockResolvedValue(undefined);
		const screen = await render(MemeBrowser, {
			props: { workspaceId: 'workspace-1', api: mockAPI(), onSelect }
		});
		const choice = screen.getByRole('button', {
			name: m.meme_generator_template_select({ name: template.name })
		});
		await choice.click();
		await expect.element(screen.getByText('Draft could not be saved')).toBeVisible();
		await choice.click();
		expect(onSelect).toHaveBeenCalledTimes(2);
		expect(onSelect).toHaveBeenLastCalledWith(template, ['not sure if', 'or just careful'], '');
	});
	it('opens seeded AI captions without regenerating suggestions', async () => {
		const api = mockAPI();
		const onSelect = vi.fn();
		const candidate = {
			template_id: 'fry',
			template,
			caption_lines: ['The plan', 'Reality'],
			alt_text: 'Launch joke',
			rationale: 'Contrast'
		};
		await render(MemeBrowser, {
			props: { workspaceId: 'workspace-1', api, onSelect, initialCandidate: candidate }
		});
		await vi.waitFor(() =>
			expect(onSelect).toHaveBeenCalledWith(template, ['The plan', 'Reality'], 'Launch joke')
		);
		expect(api.suggest).not.toHaveBeenCalled();
	});

	it('exposes the template loading skeletons as a live status', async () => {
		const listTemplates = vi
			.fn()
			.mockImplementation(() => deferred<MemeTemplateListResult>().promise);
		const api = mockAPI({ listTemplates });
		const screen = await render(MemeGenerator, {
			props: { workspaceId: 'workspace-1', api, onAttach: vi.fn() }
		});

		await screen.getByRole('tab', { name: m.meme_generator_templates_tab() }).click();
		await expect.element(screen.getByRole('status', { name: m.common_loading() })).toBeVisible();
	});
});

it('returns from a seeded meme to its original suggestions without creating another draft', async () => {
	const post = vi.fn(
		async (
			_path: string,
			options: { body: { workspace_id: string; document: ScreenshotDocument } }
		) => {
			const { workspace_id, document } = options.body;
			return {
				data: {
					id: 'seeded-draft',
					workspace_id,
					document,
					title: document.title,
					template_id: document.template_id,
					revision: 1,
					can_edit: true,
					created_at: '2026-09-27T00:00:00Z',
					updated_at: '2026-09-27T00:00:00Z'
				},
				response: new Response()
			};
		}
	);
	vi.spyOn(client, 'POST').mockImplementation(post);
	const candidate = {
		template_id: 'fry',
		template,
		caption_lines: ['Launch plan', 'Reality'],
		alt_text: 'Launch joke',
		rationale: 'Contrast'
	};
	const screen = await render(MemeGenerator, {
		props: {
			workspaceId: 'workspace-1',
			api: mockAPI(),
			initialCandidate: candidate,
			onAttach: vi.fn()
		}
	});
	await expect
		.element(screen.getByLabelText(m.meme_generator_caption_label({ number: 1 })))
		.toHaveValue('Launch plan');
	await screen.getByRole('button', { name: m.common_back(), exact: true }).click();
	await expect
		.element(
			screen.getByRole('button', {
				name: m.meme_generator_candidate_select({ name: template.name })
			})
		)
		.toBeVisible();
	expect(post).toHaveBeenCalledExactlyOnceWith('/screenshot-templates/designs', {
		body: { workspace_id: 'workspace-1', document: expect.any(Object) }
	});
});
