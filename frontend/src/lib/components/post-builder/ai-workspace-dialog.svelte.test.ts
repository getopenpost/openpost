import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet, type ComponentProps } from 'svelte';
import AIWorkspaceDialog from './ai-workspace-dialog.svelte';
import type { AIAngle, AIOpportunity, AIWorkspaceDialogCopy } from './ai-workspace-types';
import '../../../routes/layout.css';

const copy: AIWorkspaceDialogCopy = {
	ideateTitle: 'Find a post worth writing',
	ideateDescription: 'Start with a brief, then choose an idea.',
	buildTitle: 'Choose how to tell it',
	buildDescription: 'Compare the directions before building drafts.',
	back: 'Back to ideas',
	dismiss: 'Dismiss',
	getIdeas: 'Get ideas',
	continue: 'Continue',
	findMore: 'Find more',
	findingMore: 'Finding more...',
	buildDrafts: 'Build drafts',
	cancel: 'Cancel build',
	cancelling: 'Cancelling...',
	retry: 'Try again',
	keepEdits: 'Keep my edits',
	reviewApply: 'Review and apply',
	opportunities: {
		heading: 'Good options right now',
		description: 'Ranked for the selected destinations.',
		whyItFits: 'Why it fits',
		bestFor: 'Best for',
		media: 'Media',
		noMedia: 'No media needed',
		loading: 'Finding ideas...',
		emptyTitle: 'No ideas yet',
		emptyDescription: 'Try again.',
		selected: 'Selected idea'
	},
	angles: {
		heading: 'Five ways to make the point',
		description: 'Choose one direction.',
		loading: 'Planning directions...',
		emptyTitle: 'No directions yet',
		emptyDescription: 'Try again.',
		recommended: 'Recommended',
		bestFor: 'Aim',
		evidence: 'Uses',
		media: 'Media',
		noMedia: 'No media needed',
		selected: 'Selected angle'
	},
	progress: {
		heading: 'Building your publication',
		description: 'The build is running.'
	}
};

const opportunity: AIOpportunity = {
	id: 'idea-1',
	title: 'Explain the launch tradeoff',
	premise: 'Show what became simpler and why.'
};

const angle: AIAngle = {
	id: 'recommended',
	title: 'Lead with the tradeoff',
	premise: 'Explain what became simpler and what the change cost.',
	recommended: true
};

const briefContext = createRawSnippet(() => ({
	render: () => `
		<label class="mx-auto grid max-w-2xl gap-2 text-sm font-medium">
			Brief (optional)
			<textarea
				class="min-h-24 w-full resize-none rounded-md border border-input bg-input/20 px-2 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
				rows="5"
				placeholder="A topic, launch, lesson, or goal"
			></textarea>
		</label>
	`
}));

type DialogProps = ComponentProps<typeof AIWorkspaceDialog>;

function dialogProps(overrides: Partial<DialogProps> = {}): DialogProps {
	return {
		open: true,
		entry: 'ideate' as const,
		step: 'opportunities' as const,
		copy,
		opportunities: [opportunity],
		onSelectOpportunity: vi.fn(),
		onSelectAngle: vi.fn(),
		onBuild: vi.fn(),
		...overrides
	};
}

describe('AI workspace dialog', () => {
	it('waits for Continue after an opportunity is selected', async () => {
		const onSelectOpportunity = vi.fn();
		const onContinue = vi.fn();
		const screen = await render(AIWorkspaceDialog, {
			props: dialogProps({ onSelectOpportunity, onContinue })
		});

		await screen.getByText(opportunity.title).click();
		expect(onSelectOpportunity).toHaveBeenCalledWith(opportunity);
		expect(onContinue).not.toHaveBeenCalled();

		await screen.rerender(
			dialogProps({
				onSelectOpportunity,
				onContinue,
				selectedOpportunityId: opportunity.id
			})
		);
		await screen.getByRole('button', { name: copy.continue }).click();
		expect(onContinue).toHaveBeenCalledOnce();
	});

	it('shows one recovery action when discovery fails', async () => {
		const onRetry = vi.fn();
		const screen = await render(AIWorkspaceDialog, {
			props: dialogProps({
				opportunities: [],
				error: 'Publication discovery timed out',
				onFindMore: vi.fn(),
				onContinue: vi.fn(),
				onRetry
			})
		});

		await expect
			.element(screen.getByRole('alert'))
			.toHaveTextContent('Publication discovery timed out');
		await screen.getByRole('button', { name: copy.retry }).click();
		expect(onRetry).toHaveBeenCalledOnce();
		await expect
			.element(screen.getByRole('button', { name: copy.dismiss }))
			.not.toBeInTheDocument();
		await expect
			.element(screen.getByRole('button', { name: copy.findMore }))
			.not.toBeInTheDocument();
		await expect.element(screen.getByText(copy.opportunities.emptyTitle)).not.toBeInTheDocument();
	});

	it('keeps a rejected create request on angle selection without Cancel', async () => {
		const screen = await render(AIWorkspaceDialog, {
			props: dialogProps({
				entry: 'build',
				step: 'angles',
				opportunities: [],
				angles: [angle],
				selectedAngleId: angle.id,
				error: 'direction.angle exceeds its safe text limit',
				canCancel: false,
				onCancel: vi.fn()
			})
		});

		await expect.element(screen.getByRole('alert')).toBeVisible();
		await expect.element(screen.getByTestId('ai-angle-grid')).toBeVisible();
		await expect.element(screen.getByRole('button', { name: copy.buildDrafts })).toBeEnabled();
		await expect.element(screen.getByTestId('ai-generation-progress')).not.toBeInTheDocument();
		await expect.element(screen.getByRole('button', { name: copy.cancel })).not.toBeInTheDocument();
	});

	it('offers another discovery request when no ideas are returned', async () => {
		const onFindMore = vi.fn();
		const screen = await render(AIWorkspaceDialog, {
			props: dialogProps({ opportunities: [], onFindMore })
		});

		await screen.getByRole('button', { name: copy.retry }).click();
		expect(onFindMore).toHaveBeenCalledOnce();
	});

	it('starts ideation only after Get ideas is pressed', async () => {
		const onDiscover = vi.fn();
		const screen = await render(AIWorkspaceDialog, {
			props: dialogProps({ step: 'brief', opportunities: [], context: briefContext, onDiscover })
		});

		await expect.element(screen.getByTestId('ai-opportunity-grid')).not.toBeInTheDocument();
		await screen.getByRole('button', { name: copy.getIdeas }).click();
		expect(onDiscover).toHaveBeenCalledOnce();
	});
});
