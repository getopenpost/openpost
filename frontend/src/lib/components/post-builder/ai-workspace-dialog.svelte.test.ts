import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
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

async function expectWithinViewport(dialog: HTMLElement): Promise<void> {
	await vi.waitFor(() => {
		const bounds = dialog.getBoundingClientRect();
		expect(bounds.left).toBeGreaterThanOrEqual(-0.5);
		expect(bounds.top).toBeGreaterThanOrEqual(-0.5);
		expect(bounds.right).toBeLessThanOrEqual(window.innerWidth + 0.5);
		expect(bounds.bottom).toBeLessThanOrEqual(window.innerHeight + 0.5);
	});
}

describe('AI workspace dialog', () => {
	it('waits for Continue after an opportunity is selected', async () => {
		await page.viewport(1280, 900);
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
		const dialog = document.querySelector<HTMLElement>('[data-testid="ai-workspace-dialog"]');
		if (!dialog) throw new Error('AI workspace dialog did not render.');
		await expectWithinViewport(dialog);
		await page.screenshot({
			element: dialog,
			path: '../../../.svelte-kit/openpost-ai-workspace-opportunities-1280.png'
		});
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
		await page.viewport(390, 844);
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
		const dialog = document.querySelector<HTMLElement>('[data-testid="ai-workspace-dialog"]');
		if (!dialog) throw new Error('AI workspace dialog did not render.');
		await expectWithinViewport(dialog);
		await page.screenshot({
			element: dialog,
			path: '../../../.svelte-kit/openpost-ai-workspace-rejection-390.png'
		});
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
		await page.viewport(1280, 900);
		const onDiscover = vi.fn();
		const screen = await render(AIWorkspaceDialog, {
			props: dialogProps({ step: 'brief', opportunities: [], context: briefContext, onDiscover })
		});

		await expect.element(screen.getByTestId('ai-opportunity-grid')).not.toBeInTheDocument();
		const dialog = document.querySelector<HTMLElement>('[data-testid="ai-workspace-dialog"]');
		if (!dialog) throw new Error('AI workspace dialog did not render.');
		await expectWithinViewport(dialog);
		const briefBounds = dialog.getBoundingClientRect();
		expect(briefBounds.width).toBeGreaterThanOrEqual(620);
		expect(briefBounds.width).toBeLessThanOrEqual(680);
		expect(briefBounds.height).toBeLessThan(window.innerHeight * 0.55);
		await page.screenshot({
			element: dialog,
			path: '../../../.svelte-kit/openpost-ai-workspace-brief-1280.png'
		});
		await screen.getByRole('button', { name: copy.getIdeas }).click();
		expect(onDiscover).toHaveBeenCalledOnce();

		await screen.rerender(dialogProps({ step: 'opportunities', onDiscover }));
		expect(document.querySelector('[data-testid="ai-workspace-dialog"]')).toBe(dialog);
		const transitionProperties = getComputedStyle(dialog)
			.transitionProperty.split(',')
			.map((property) => property.trim());
		expect(transitionProperties).toEqual(expect.arrayContaining(['width', 'height']));
		const transitionDuration = Math.max(
			...getComputedStyle(dialog)
				.transitionDuration.split(',')
				.map((duration) => Number.parseFloat(duration))
		);
		expect(transitionDuration).toBeGreaterThanOrEqual(0.2);
		await vi.waitFor(() => {
			const expandedBounds = dialog.getBoundingClientRect();
			expect(expandedBounds.width).toBeGreaterThan(briefBounds.width + 400);
			expect(expandedBounds.height).toBeGreaterThan(briefBounds.height + 250);
		});
	});

	it('keeps the compact brief inside phone viewports in both themes', async () => {
		await page.viewport(390, 844);
		document.documentElement.classList.add('dark');
		const screen = await render(AIWorkspaceDialog, {
			props: dialogProps({
				step: 'brief',
				opportunities: [],
				context: briefContext,
				onDiscover: vi.fn()
			})
		});
		const dialog = document.querySelector<HTMLElement>('[data-testid="ai-workspace-dialog"]');
		if (!dialog) throw new Error('AI workspace dialog did not render.');
		await expectWithinViewport(dialog);
		const briefBounds = dialog.getBoundingClientRect();
		expect(briefBounds.left).toBeGreaterThanOrEqual(15.5);
		expect(window.innerWidth - briefBounds.right).toBeGreaterThanOrEqual(15.5);
		expect(getComputedStyle(dialog).transitionProperty).toBe('none');
		await expect.element(screen.getByRole('textbox')).toBeVisible();
		await expect.element(screen.getByRole('button', { name: copy.getIdeas })).toBeVisible();
		await page.screenshot({
			element: dialog,
			path: '../../../.svelte-kit/openpost-ai-workspace-brief-dark-390.png'
		});

		await screen.rerender(dialogProps({ step: 'opportunities', onDiscover: vi.fn() }));
		await vi.waitFor(() => {
			const expandedBounds = dialog.getBoundingClientRect();
			expect(expandedBounds.left).toBeLessThanOrEqual(0.5);
			expect(expandedBounds.top).toBeLessThanOrEqual(0.5);
			expect(expandedBounds.right).toBeGreaterThanOrEqual(window.innerWidth - 0.5);
			expect(expandedBounds.bottom).toBeGreaterThanOrEqual(window.innerHeight - 0.5);
		});
		await page.screenshot({
			element: dialog,
			path: '../../../.svelte-kit/openpost-ai-workspace-opportunities-dark-390.png'
		});

		document.documentElement.classList.remove('dark');
		await page.viewport(320, 568);
		await screen.rerender(
			dialogProps({
				step: 'brief',
				opportunities: [],
				context: briefContext,
				onDiscover: vi.fn()
			})
		);
		await expectWithinViewport(dialog);
		await page.screenshot({
			element: dialog,
			path: '../../../.svelte-kit/openpost-ai-workspace-brief-light-320.png'
		});
	});
});
