import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { MemeSuggestionCandidate, MemeTemplate } from '$lib/meme-generator/types';
import AIMemeRecommendation from './ai-meme-recommendation.svelte';
import type {
	AIMemeRecommendationCandidate,
	AIMemeRecommendationCopy
} from './ai-meme-recommendation';
import '../../../routes/layout.css';

const copy: AIMemeRecommendationCopy = {
	title: 'A meme fits this angle',
	description: 'Compare the options. Nothing is attached until you choose one.',
	recommendedLabel: 'Recommended',
	alternativesLabel: 'Alternatives',
	useLabel: 'Use this meme',
	usingLabel: 'Adding meme',
	editLabel: 'Edit',
	editingLabel: 'Opening editor',
	retryLabel: 'Retry preview',
	retryingLabel: 'Retrying preview',
	previewLoading: 'Loading preview',
	previewUnavailable: 'The preview could not be loaded.',
	emptyTitle: 'No meme options',
	emptyDescription: 'Try the recommendation again.',
	actionFailed: 'The meme action failed.',
	selectAlternative: (templateName, position) => `Choose option ${position}: ${templateName}`
};

function template(id: string, name: string): MemeTemplate {
	return {
		id,
		name,
		lines: 2,
		overlays: 0,
		styles: ['default'],
		blank_url: '',
		example: { text: ['first', 'second'], url: '' },
		source_url: '',
		keywords: [id],
		search_terms: [id, name],
		animated: false,
		semantic: {
			visual: 'Two contrasting choices.',
			meaning: 'One choice wins over another.',
			mechanism: 'contrast',
			caption_roles: ['first choice', 'second choice'],
			tags: ['contrast']
		}
	};
}

function suggestion(id: string, name: string): MemeSuggestionCandidate {
	return {
		template_id: id,
		caption_lines: [`${name} setup`, `${name} payoff`],
		rationale: `${name} makes the trade-off clear without explaining the joke.`,
		alt_text: `${name} meme with a setup and payoff.`,
		template: template(id, name)
	};
}

function preview(label: string): string {
	return `data:image/svg+xml;base64,${btoa(
		`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#29292f"/><text x="320" y="240" text-anchor="middle" fill="white" font-size="32">${label}</text></svg>`
	)}`;
}

function candidate(
	id: string,
	name: string,
	state: AIMemeRecommendationCandidate['previewState'] = 'ready'
): AIMemeRecommendationCandidate {
	return {
		id,
		suggestion: suggestion(id, name),
		previewState: state,
		previewUrl: state === 'ready' ? preview('Preview') : undefined
	};
}

describe('AI meme recommendation', () => {
	it('selects an alternative without using it and requires an explicit Use action', async () => {
		const candidates = [
			candidate('drake', 'Drake Hotline Bling'),
			candidate('rollsafe', 'Roll Safe'),
			candidate('stonks', 'Stonks')
		];
		const onSelect = vi.fn();
		const onUse = vi.fn();
		const onEdit = vi.fn();
		const onRetry = vi.fn();
		const screen = await render(AIMemeRecommendation, {
			props: { candidates, copy, onSelect, onUse, onEdit, onRetry }
		});

		await expect
			.element(screen.getByRole('img', { name: candidates[0].suggestion.alt_text }))
			.toBeVisible();
		expect(onUse).not.toHaveBeenCalled();

		await screen.getByRole('button', { name: copy.selectAlternative('Roll Safe', 1) }).click();
		expect(onSelect).toHaveBeenCalledWith(candidates[1]);
		expect(onUse).not.toHaveBeenCalled();

		await screen.getByRole('button', { name: copy.editLabel }).click();
		await vi.waitFor(() => expect(onEdit).toHaveBeenCalledWith(candidates[1]));
		expect(onUse).not.toHaveBeenCalled();

		await screen.getByRole('button', { name: copy.useLabel }).click();
		await vi.waitFor(() => expect(onUse).toHaveBeenCalledWith(candidates[1]));
	});

	it('keeps Use disabled until a failed preview is retried', async () => {
		const failed = candidate('drake', 'Drake Hotline Bling', 'failed');
		const onRetry = vi.fn();
		const screen = await render(AIMemeRecommendation, {
			props: {
				candidates: [failed],
				copy,
				onSelect: vi.fn(),
				onUse: vi.fn(),
				onEdit: vi.fn(),
				onRetry
			}
		});

		await expect.element(screen.getByRole('button', { name: copy.useLabel })).toBeDisabled();
		await screen.getByRole('button', { name: copy.retryLabel }).click();
		await vi.waitFor(() => expect(onRetry).toHaveBeenCalledWith(failed));
	});
});
