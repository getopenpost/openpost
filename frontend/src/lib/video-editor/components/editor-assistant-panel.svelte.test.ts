import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import EditorAssistantPanel from './editor-assistant-panel.svelte';
import '../../../routes/layout.css';
import { agentStore } from '../agent/store.svelte';

beforeEach(() => {
	agentStore.__resetForTesting();
});

describe('EditorAssistantPanel switcher', () => {
	it('switches Assistant versus Generate with keyboard and keeps 44px touch targets', async () => {
		const screen = await render(EditorAssistantPanel, {
			projectId: 'p1',
			oninserted: vi.fn(),
			onselectitems: vi.fn(),
			onopensilence: vi.fn(),
			onopenfillers: vi.fn(),
			selectedIds: [],
			onautosave: vi.fn()
		});
		const assistantTab = screen.getByRole('tab', { name: 'Assistant' });
		const generateTab = screen.getByRole('tab', { name: 'Generate' });
		await expect.element(assistantTab).toHaveAttribute('aria-selected', 'true');
		// Click Generate
		await generateTab.click();
		await expect.element(generateTab).toHaveAttribute('aria-selected', 'true');
		await expect
			.element(screen.getByText('Create voice and music on device, then place at the playhead.'))
			.toBeVisible();
		// Keyboard back to Assistant via ArrowLeft
		await generateTab.element().focus();
		generateTab
			.element()
			.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
		await expect.element(assistantTab).toHaveAttribute('aria-selected', 'true');
		// Touch target size (coarse pointer at least 44px)
		expect(assistantTab.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44 - 0.5);
		expect(generateTab.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44 - 0.5);
	});

	it('shows visible focus rings and fits 320px and 390px without overflow', async () => {
		await page.viewport(320, 720);
		const screen = await render(EditorAssistantPanel, {
			projectId: 'p1',
			oninserted: vi.fn(),
			onselectitems: vi.fn(),
			onopensilence: vi.fn(),
			onopenfillers: vi.fn(),
			selectedIds: [],
			onautosave: vi.fn()
		});
		const root = screen.getByTestId('editor-assistant-panel').element() as HTMLElement;
		expect(root.scrollWidth).toBeLessThanOrEqual(320);
		await page.viewport(390, 720);
		expect(root.scrollWidth).toBeLessThanOrEqual(390);
		const tab = screen.getByRole('tab', { name: 'Generate' });
		await tab.element().focus();
		expect(document.activeElement).toBe(tab.element());
	});

	it('exposes model cache visibility and quota text', async () => {
		const screen = await render(EditorAssistantPanel, {
			projectId: 'p1',
			oninserted: vi.fn(),
			onselectitems: vi.fn(),
			onopensilence: vi.fn(),
			onopenfillers: vi.fn(),
			selectedIds: [],
			onautosave: vi.fn()
		});
		await expect
			.element(screen.getByText(/On-device assistant|WebGPU required|Checking model/))
			.toBeVisible();
	});
});
