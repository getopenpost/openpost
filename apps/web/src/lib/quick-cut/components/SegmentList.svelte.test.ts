import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { QuickCutSource } from '../types';
import { createSegment } from '../model';
import SegmentList from './SegmentList.svelte';
import '../../../routes/layout.css';

const source: QuickCutSource = {
	id: 'source',
	name: 'Interview.mp4',
	size: 1024,
	mimeType: 'video/mp4',
	duration: 10,
	width: 1920,
	height: 1080,
	videoCodec: 'avc',
	audioCodec: 'aac',
	sampleRate: 48_000,
	channels: 2,
	rotation: 0,
	fps: 30,
	keyframeTimestamps: [0, 2, 4],
	keyframeState: 'known',
	videoStreams: [
		{
			index: 0,
			codec: 'avc',
			width: 1920,
			height: 1080,
			rotation: 0,
			fps: 30,
			keyframeTimestamps: [0, 2, 4],
			keyframeState: 'known'
		}
	],
	audioStreams: [{ index: 0, codec: 'aac', sampleRate: 48_000, channels: 2 }]
};

afterEach(async () => {
	await page.viewport(1280, 900);
});

test('edits one segment cut strategy without changing the project default', async () => {
	const onUpdate = vi.fn();
	const screen = await render(SegmentList, {
		segments: [createSegment(0.5, 2, { id: 'range', sourceId: source.id })],
		sources: [source],
		selectedId: 'range',
		defaultCutMode: 'nearestKeyframe',
		onSelect: vi.fn(),
		onRemove: vi.fn(),
		onUpdate,
		onMove: vi.fn(),
		exporting: false,
		canExportIndividually: true,
		onPreview: vi.fn(),
		onExport: vi.fn()
	});

	await screen.getByText('More options', { exact: true }).click();
	const strategy = screen.getByRole('button', { name: 'Cut mode 1' });
	await expect.element(strategy).toHaveTextContent('Project mode: Nearest keyframe (lossless)');
	await strategy.click();
	await screen.getByRole('option', { name: 'Exact time (may re-encode)' }).click();
	expect(onUpdate).toHaveBeenCalledExactlyOnceWith('range', {
		cutMode: 'exact'
	});
});

test('renders timecode inputs with shared Input primitive and preserves bindings', async () => {
	const screen = await render(SegmentList, {
		segments: [createSegment(1.25, 3.5, { id: 'range', sourceId: source.id })],
		sources: [source],
		selectedId: 'range',
		defaultCutMode: 'nearestKeyframe',
		onSelect: vi.fn(),
		onRemove: vi.fn(),
		onUpdate: vi.fn(),
		onMove: vi.fn(),
		exporting: false,
		canExportIndividually: true,
		onPreview: vi.fn(),
		onExport: vi.fn()
	});

	await expect.element(screen.getByRole('textbox', { name: 'Mark in 1' })).toBeVisible();
	await expect.element(screen.getByRole('textbox', { name: 'Mark out 1' })).toBeVisible();
	await expect.element(screen.getByRole('textbox', { name: 'Mark in 1' })).toHaveValue('00:01.25');
	await expect.element(screen.getByRole('textbox', { name: 'Mark out 1' })).toHaveValue('00:03.50');
});

test('offers segment actions by right click and keyboard context menu', async () => {
	const onRemove = vi.fn();
	const onUpdate = vi.fn();
	const screen = await render(SegmentList, {
		segments: [createSegment(1.25, 3.5, { id: 'range', sourceId: source.id })],
		sources: [source],
		selectedId: 'range',
		defaultCutMode: 'nearestKeyframe',
		onSelect: vi.fn(),
		onRemove,
		onUpdate,
		onMove: vi.fn(),
		exporting: false,
		canExportIndividually: true,
		onPreview: vi.fn(),
		onExport: vi.fn()
	});

	const segment = screen.getByRole('button', { name: 'Segment 1' }).element();
	segment.dispatchEvent(
		new MouseEvent('contextmenu', {
			bubbles: true,
			cancelable: true,
			clientX: 240,
			clientY: 120
		})
	);
	await expect.element(screen.getByRole('menuitem', { name: 'Disable segment' })).toBeVisible();
	await screen.getByRole('menuitem', { name: 'Disable segment' }).click();
	expect(onUpdate).toHaveBeenCalledWith('range', { enabled: false });

	segment.focus();
	await userEvent.keyboard('{Shift>}{F10}{/Shift}');
	await expect.element(screen.getByRole('menuitem', { name: 'Remove segment' })).toBeVisible();
	await screen.getByRole('menuitem', { name: 'Remove segment' }).click();
	expect(onRemove).toHaveBeenCalledWith('range');
});

test('keeps range timestamps on one line in a narrow cuts panel', async () => {
	await page.viewport(330, 800);
	const screen = await render(SegmentList, {
		segments: [
			createSegment(1.25, 3.5, { id: 'range', sourceId: source.id }),
			createSegment(5, 7, { id: 'second', sourceId: source.id })
		],
		sources: [source],
		selectedId: null,
		defaultCutMode: 'nearestKeyframe',
		onSelect: vi.fn(),
		onRemove: vi.fn(),
		onUpdate: vi.fn(),
		onMove: vi.fn(),
		exporting: false,
		canExportIndividually: true,
		onPreview: vi.fn(),
		onExport: vi.fn()
	});
	const range = screen.getByText(/00:01.25 → 00:03.50/).element();
	const bounds = range.getBoundingClientRect();
	expect(bounds.height).toBeLessThanOrEqual(parseFloat(getComputedStyle(range).lineHeight) + 1);
	expect(bounds.right).toBeLessThanOrEqual(330);
});

test('keeps focus on the moved segment when its reorder control becomes disabled', async () => {
	let segments = [
		createSegment(0, 2, {
			id: 'first',
			sourceId: source.id,
			name: 'First part'
		}),
		createSegment(6, 8, { id: 'last', sourceId: source.id, name: 'Last part' })
	];
	const onMove = vi.fn((from: number, to: number) => {
		const next = [...segments];
		const moved = next.splice(from, 1)[0]!;
		next.splice(to, 0, moved);
		segments = next;
		void screen.rerender({ segments });
	});
	const screen = await render(SegmentList, {
		segments,
		sources: [source],
		selectedId: null,
		defaultCutMode: 'nearestKeyframe',
		onSelect: vi.fn(),
		onRemove: vi.fn(),
		onUpdate: vi.fn(),
		onMove,
		exporting: false,
		canExportIndividually: true,
		onPreview: vi.fn(),
		onExport: vi.fn()
	});
	screen.getByRole('button', { name: 'Move up', exact: true }).nth(1).element().focus();
	await userEvent.keyboard('{Enter}');
	await expect
		.element(screen.getByRole('button', { name: 'Segment 1', exact: true }))
		.toHaveFocus();
	await expect
		.element(screen.getByRole('button', { name: 'Segment 1', exact: true }))
		.toHaveTextContent('Last part');
	expect(onMove).toHaveBeenLastCalledWith(1, 0);

	screen.getByRole('button', { name: 'Move down', exact: true }).nth(0).element().focus();
	await userEvent.keyboard('{Enter}');
	await expect
		.element(screen.getByRole('button', { name: 'Segment 2', exact: true }))
		.toHaveFocus();
	await expect
		.element(screen.getByRole('button', { name: 'Segment 2', exact: true }))
		.toHaveTextContent('Last part');
	expect(onMove).toHaveBeenLastCalledWith(0, 1);
});

test('focuses the next or previous segment after removal and the list when none remain', async () => {
	let segments = [
		createSegment(0, 2, {
			id: 'first',
			sourceId: source.id,
			name: 'First part'
		}),
		createSegment(3, 5, {
			id: 'middle',
			sourceId: source.id,
			name: 'Middle part'
		}),
		createSegment(6, 8, { id: 'last', sourceId: source.id, name: 'Last part' })
	];
	const screen = await render(SegmentList, {
		segments,
		sources: [source],
		selectedId: null,
		defaultCutMode: 'nearestKeyframe',
		onSelect: vi.fn(),
		onRemove: (id) => {
			segments = segments.filter((segment) => segment.id !== id);
			void screen.rerender({ segments });
		},
		onUpdate: vi.fn(),
		onMove: vi.fn(),
		exporting: false,
		canExportIndividually: true,
		onPreview: vi.fn(),
		onExport: vi.fn()
	});
	screen.getByRole('button', { name: 'Remove segment', exact: true }).nth(2).element().focus();
	await userEvent.keyboard('{Enter}');
	await expect
		.element(screen.getByRole('button', { name: 'Segment 2', exact: true }))
		.toHaveFocus();
	await expect
		.element(screen.getByRole('button', { name: 'Segment 2', exact: true }))
		.toHaveTextContent('Middle part');

	screen.getByRole('button', { name: 'Remove segment', exact: true }).nth(0).element().focus();
	await userEvent.keyboard('{Enter}');
	await expect
		.element(screen.getByRole('button', { name: 'Segment 1', exact: true }))
		.toHaveFocus();
	await expect
		.element(screen.getByRole('button', { name: 'Segment 1', exact: true }))
		.toHaveTextContent('Middle part');

	screen.getByRole('button', { name: 'Remove segment', exact: true }).element().focus();
	await userEvent.keyboard('{Enter}');
	await expect.element(screen.getByRole('list', { name: 'Segments', exact: true })).toHaveFocus();
});
