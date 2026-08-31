import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import '../../../routes/layout.css';
import type { TimelineTrack } from '$lib/video-editor/project/types';
import { keyboardShortcuts } from '$lib/video-editor/settings/keyboard-shortcuts.svelte';
import TimelineTrackHeader from './timeline-track-header.svelte';

function track(overrides: Partial<TimelineTrack> = {}): TimelineTrack {
	return {
		id: 'video-1',
		name: 'Video 1',
		kind: 'video',
		height: 64,
		locked: false,
		syncLock: true,
		visible: true,
		muted: false,
		solo: false,
		order: 0,
		...overrides
	};
}

describe('TimelineTrackHeader', () => {
	beforeEach(() => keyboardShortcuts.resetAll());

	it('exposes every track state as a named control', async () => {
		const callbacks = {
			onvisibility: vi.fn(),
			onmute: vi.fn(),
			onsolo: vi.fn(),
			onlock: vi.fn(),
			onsynclock: vi.fn(),
			ondelete: vi.fn()
		};
		const screen = await render(TimelineTrackHeader, {
			track: track(),
			itemCount: 3,
			canDelete: true,
			...callbacks
		});

		await expect.element(screen.getByText('Video 1')).toBeVisible();
		await expect.element(screen.getByText('3')).toBeVisible();
		for (const [name, callback] of [
			['Hide track', callbacks.onvisibility],
			['Lock track', callbacks.onlock]
		] as const) {
			await screen.getByRole('button', { name }).click();
			expect(callback, `${name} callback`).toHaveBeenCalledOnce();
		}
		for (const [name, callback] of [
			['Mute track', callbacks.onmute],
			['Solo track', callbacks.onsolo],
			['Disable sync lock', callbacks.onsynclock],
			['Delete track and clips', callbacks.ondelete]
		] as const) {
			await screen.getByRole('button', { name: 'More track actions' }).click();
			await screen.getByRole('menuitem', { name }).click();
			expect(callback, `${name} callback`).toHaveBeenCalledOnce();
		}
	});

	it('keeps the last remaining track', async () => {
		const screen = await render(TimelineTrackHeader, {
			track: track(),
			itemCount: 0,
			canDelete: false,
			onvisibility: vi.fn(),
			onmute: vi.fn(),
			onsolo: vi.fn(),
			onlock: vi.fn(),
			onsynclock: vi.fn(),
			ondelete: vi.fn()
		});

		await screen.getByRole('button', { name: 'More track actions' }).click();
		await expect
			.element(screen.getByRole('menuitem', { name: 'Delete track and clips' }))
			.toBeDisabled();
	});

	it('shows compact group controls and separates ungroup from destructive deletion', async () => {
		const callbacks = {
			oncollapse: vi.fn(),
			onungroup: vi.fn(),
			ondeletegroup: vi.fn()
		};
		const screen = await render(TimelineTrackHeader, {
			track: track({
				id: 'group',
				name: 'Dialogue',
				kind: undefined,
				isGroup: true,
				isCollapsed: true
			}),
			itemCount: 2,
			canDelete: true,
			onvisibility: vi.fn(),
			onmute: vi.fn(),
			onsolo: vi.fn(),
			onlock: vi.fn(),
			onsynclock: vi.fn(),
			ondelete: vi.fn(),
			...callbacks
		});

		await screen.getByRole('button', { name: 'Expand track group' }).click();
		const moreActions = screen.getByRole('button', { name: 'More track actions' });
		await moreActions.click();
		await expect.element(moreActions).toHaveAttribute('aria-expanded', 'true');
		await screen.getByRole('menuitem', { name: 'Ungroup and keep tracks' }).click();
		await screen.getByRole('button', { name: 'More track actions' }).click();
		await screen.getByRole('menuitem', { name: 'Delete group and tracks' }).click();
		expect(callbacks.oncollapse).toHaveBeenCalledOnce();
		expect(callbacks.onungroup).toHaveBeenCalledOnce();
		expect(callbacks.ondeletegroup).toHaveBeenCalledOnce();
		await expect
			.element(screen.getByRole('button', { name: 'Disable sync lock' }))
			.not.toBeInTheDocument();
	});

	it('makes inherited group state visible and prevents misleading child toggles', async () => {
		const child = track({ parentTrackId: 'group' });
		const screen = await render(TimelineTrackHeader, {
			track: child,
			effectiveTrack: {
				...child,
				locked: true,
				visible: false,
				muted: true,
				solo: true
			},
			itemCount: 1,
			canDelete: true,
			child: true,
			inheritedLocked: true,
			inheritedVisible: true,
			inheritedMuted: true,
			inheritedSolo: true,
			onvisibility: vi.fn(),
			onmute: vi.fn(),
			onsolo: vi.fn(),
			onlock: vi.fn(),
			onsynclock: vi.fn(),
			ondelete: vi.fn()
		});
		for (const name of ['Show track', 'Unlock track']) {
			await expect.element(screen.getByRole('button', { name })).toBeDisabled();
		}
		await screen.getByRole('button', { name: 'More track actions' }).click();
		await expect.element(screen.getByRole('menuitem', { name: 'Unmute track' })).toBeDisabled();
		await expect.element(screen.getByRole('menuitem', { name: 'Unsolo track' })).toBeDisabled();
	});

	it('renames and reorders from the track name without adding more toolbar buttons', async () => {
		const onrename = vi.fn();
		const onmovedown = vi.fn();
		const screen = await render(TimelineTrackHeader, {
			track: track(),
			itemCount: 0,
			canDelete: true,
			onrename,
			onmovedown,
			onvisibility: vi.fn(),
			onmute: vi.fn(),
			onsolo: vi.fn(),
			onlock: vi.fn(),
			onsynclock: vi.fn(),
			ondelete: vi.fn()
		});
		const name = screen.getByRole('button', { name: 'Video 1' });
		await name.dblClick();
		const input = screen.getByRole('textbox', { name: 'Rename track' });
		await input.fill('Primary video');
		await userEvent.keyboard('{Enter}');
		expect(onrename).toHaveBeenCalledWith('Primary video');
		await screen.getByRole('button', { name: 'Video 1' }).click();
		await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
		expect(onmovedown).toHaveBeenCalledOnce();
	});

	it('uses remapped track commands and stops accepting their old bindings', async () => {
		keyboardShortcuts.setBinding('TRACK_RENAME', 'alt+8');
		keyboardShortcuts.setBinding('TRACK_MOVE_DOWN', 'alt+9');
		const onmovedown = vi.fn();
		const screen = await render(TimelineTrackHeader, {
			track: track(),
			itemCount: 0,
			canDelete: true,
			onrename: vi.fn(),
			onmovedown,
			onvisibility: vi.fn(),
			onmute: vi.fn(),
			onsolo: vi.fn(),
			onlock: vi.fn(),
			onsynclock: vi.fn(),
			ondelete: vi.fn()
		});
		const name = screen.getByRole('button', { name: 'Video 1' });
		await name.click();
		await userEvent.keyboard('{F2}');
		await expect
			.element(screen.getByRole('textbox', { name: 'Rename track' }))
			.not.toBeInTheDocument();
		await userEvent.keyboard('{Alt>}{8}{/Alt}');
		await expect.element(screen.getByRole('textbox', { name: 'Rename track' })).toBeVisible();
		await userEvent.keyboard('{Escape}');

		await name.click();
		await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
		expect(onmovedown).not.toHaveBeenCalled();
		await userEvent.keyboard('{Alt>}{9}{/Alt}');
		expect(onmovedown).toHaveBeenCalledOnce();
	});
});
