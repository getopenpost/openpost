import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { switchLocale } from '$lib/i18n';
import { getBuiltInTheme, WebThemeRuntime, type ThemeRuntimeLoaders } from '$lib/themes';
import ThemeEditor from './theme-editor.svelte';
import { duplicateThemeManifest } from './theme-editor-model';
import '../../../routes/layout.css';

function previewFrame(element: Element): HTMLIFrameElement {
	if (!(element instanceof HTMLIFrameElement))
		throw new Error('Theme preview iframe is unavailable');
	return element;
}

describe('ThemeEditor', () => {
	afterEach(() => switchLocale('en', { reload: false }));

	it('edits the real scoped preview and can undo the complete change', async () => {
		const initialTheme = duplicateThemeManifest(
			getBuiltInTheme('workshop'),
			'northstar',
			'Northstar'
		);
		// Font/asset staging needs network resources the test env cannot
		// provide; stub only the loaders so the edit/undo behavior under test
		// still runs against the real preview document.
		const loaders: ThemeRuntimeLoaders = {
			stageFonts: vi.fn(async () => ({ release: vi.fn() })),
			loadAssets: vi.fn(async () => undefined),
			loadIconPack: vi.fn(async () => undefined),
			setBrowserSurface: vi.fn(() => vi.fn())
		};
		const screen = render(ThemeEditor, { initialTheme, runtime: new WebThemeRuntime(loaders) });
		const canvas = screen.getByLabelText('Canvas');

		await canvas.fill('#F1F5FF');
		await expect.element(screen.getByText('Unsaved changes')).toBeVisible();
		await expect.element(screen.getByTestId('theme-preview')).toHaveAttribute('aria-busy', 'false');
		const preview = previewFrame(screen.getByTestId('theme-preview').element());
		await expect
			.poll(() => ({
				background: preview.contentDocument?.documentElement.style.getPropertyValue('--background'),
				fallback: preview.contentDocument?.documentElement.dataset.themeFallback,
				source: preview.contentDocument?.documentElement.dataset.themeSource,
				id: preview.contentDocument?.documentElement.dataset.themeId
			}))
			.toEqual({
				background: '#F1F5FF',
				fallback: undefined,
				source: 'organization',
				id: 'northstar'
			});

		await screen.getByRole('button', { name: 'Undo' }).click();
		await expect.element(screen.getByText('Revision draft')).toBeVisible();

		await screen.getByRole('button', { name: 'Redo' }).click();
		await expect.element(canvas).toHaveValue('#F1F5FF');
	});

	it('shows complete Workshop fallback for an unsupported scheme', async () => {
		const initialTheme = duplicateThemeManifest(
			getBuiltInTheme('studio'),
			'northstar-studio',
			'Northstar Studio'
		);
		const screen = render(ThemeEditor, { initialTheme });

		await screen.getByRole('button', { name: /Dark Fallback/ }).click();
		await expect.element(screen.getByText('This theme does not support dark.')).toBeVisible();
		await expect.element(screen.getByText('Workshop fallback · dark')).toBeVisible();
	});

	it('keeps invalid manifest source out of editor history', async () => {
		const onSave = vi.fn();
		const initialTheme = duplicateThemeManifest(
			getBuiltInTheme('workshop'),
			'northstar',
			'Northstar'
		);
		const screen = render(ThemeEditor, { initialTheme, onSave });

		await screen.getByRole('button', { name: 'Manifest', exact: true }).click();
		await screen.getByLabelText('Theme manifest JSON').fill('{"schemaVersion":1}');
		await screen.getByRole('button', { name: 'Apply manifest' }).click();

		await expect.element(screen.getByRole('alert')).toHaveTextContent('id is required');
		await expect.element(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
		await screen.getByRole('button', { name: 'Guided' }).click();
		await expect
			.element(screen.getByRole('button', { name: 'Manifest', exact: true }))
			.toHaveAttribute('aria-pressed', 'true');
		expect(onSave).not.toHaveBeenCalled();
	});

	it('keeps server-owned manifest identity out of advanced edits', async () => {
		const initialTheme = duplicateThemeManifest(
			getBuiltInTheme('workshop'),
			'northstar',
			'Northstar'
		);
		const screen = render(ThemeEditor, { initialTheme });

		await screen.getByRole('button', { name: 'Manifest', exact: true }).click();
		const changed = structuredClone(initialTheme);
		changed.id = 'another-theme';
		await screen.getByLabelText('Theme manifest JSON').fill(JSON.stringify(changed));
		await screen.getByRole('button', { name: 'Apply manifest' }).click();

		await expect
			.element(screen.getByRole('alert'))
			.toHaveTextContent('Theme ID is managed by OpenPost');
	});

	it('applies valid manifest edits before returning to guided controls', async () => {
		const initialTheme = duplicateThemeManifest(
			getBuiltInTheme('workshop'),
			'northstar',
			'Northstar'
		);
		const changed = structuredClone(initialTheme);
		changed.schemes.light!.colors.canvas = '#F1F5FF';
		const screen = render(ThemeEditor, { initialTheme });

		await screen.getByRole('button', { name: 'Manifest', exact: true }).click();
		await screen.getByLabelText('Theme manifest JSON').fill(JSON.stringify(changed));
		await screen.getByRole('button', { name: 'Guided' }).click();

		await expect.element(screen.getByLabelText('Canvas')).toHaveValue('#F1F5FF');
		await expect.element(screen.getByText('Unsaved changes')).toBeVisible();
	});

	it('publishes only when permission and validation both allow it', async () => {
		const onPublish = vi.fn();
		const initialTheme = duplicateThemeManifest(
			getBuiltInTheme('workshop'),
			'northstar',
			'Northstar'
		);
		const screen = render(ThemeEditor, {
			initialTheme,
			canPublish: true,
			onPublish
		});

		await screen.getByRole('button', { name: 'Publish' }).click();
		expect(onPublish).toHaveBeenCalledOnce();
	});

	it('blocks publishing when a guided field makes the draft invalid', async () => {
		const onPublish = vi.fn();
		const initialTheme = duplicateThemeManifest(
			getBuiltInTheme('workshop'),
			'northstar',
			'Northstar'
		);
		const screen = render(ThemeEditor, {
			initialTheme,
			canPublish: true,
			onPublish
		});

		await screen.getByLabelText('Canvas').fill('url(https://example.com/tracker)');

		await expect.element(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
		await expect.element(screen.getByText(/current draft is incomplete/i)).toBeVisible();
		expect(onPublish).not.toHaveBeenCalled();
	});

	it('keeps the draft dirty and reports a failed save', async () => {
		const initialTheme = duplicateThemeManifest(
			getBuiltInTheme('workshop'),
			'northstar',
			'Northstar'
		);
		const screen = render(ThemeEditor, {
			initialTheme,
			onSave: vi.fn().mockRejectedValue(new Error('The draft changed on another device'))
		});

		await screen.getByLabelText('Canvas').fill('#F1F5FF');
		await screen.getByRole('button', { name: 'Save draft' }).click();

		await expect
			.element(screen.getByRole('alert'))
			.toHaveTextContent('The draft changed on another device');
		await expect.element(screen.getByText('Unsaved changes')).toBeVisible();
	});

	it('requires confirmation before replacing conflicted local changes', async () => {
		const initialTheme = duplicateThemeManifest(
			getBuiltInTheme('workshop'),
			'northstar',
			'Northstar'
		);
		const latestTheme = {
			...structuredClone(initialTheme),
			revision: 'draft-2'
		};
		const onReload = vi.fn().mockResolvedValue(latestTheme);
		const screen = render(ThemeEditor, {
			initialTheme,
			onSave: vi.fn().mockRejectedValue(new Error('The draft changed on another device')),
			onReload
		});

		await screen.getByLabelText('Canvas').fill('#F1F5FF');
		await screen.getByRole('button', { name: 'Save draft' }).click();
		await screen.getByRole('button', { name: 'Reload latest' }).click();

		expect(onReload).not.toHaveBeenCalled();
		await expect
			.element(screen.getByRole('heading', { name: 'Discard local changes?' }))
			.toBeVisible();
		await screen.getByRole('button', { name: 'Discard and reload' }).click();
		expect(onReload).toHaveBeenCalledOnce();
		await expect.element(screen.getByText('Revision draft-2')).toBeVisible();
	});

	it('confirms rollback and treats the server revision as the clean draft', async () => {
		const initialTheme = duplicateThemeManifest(
			getBuiltInTheme('workshop'),
			'northstar',
			'Northstar'
		);
		const restored = { ...structuredClone(initialTheme), revision: '3' };
		const onRollback = vi.fn().mockResolvedValue(restored);
		const screen = render(ThemeEditor, {
			initialTheme,
			revisions: [{ revision: 2, label: 'Revision 2', publishedAt: 'Today' }],
			onRollback
		});

		await screen.getByRole('button', { name: 'Revisions' }).click();
		await screen.getByRole('button', { name: 'Restore' }).click();
		expect(onRollback).not.toHaveBeenCalled();
		await screen.getByRole('button', { name: 'Restore revision' }).click();

		expect(onRollback).toHaveBeenCalledWith(2);
		await expect.element(screen.getByText('Revision 3')).toBeVisible();
	});

	it('confirms resource detachment and submits the exact current draft', async () => {
		const initialTheme = duplicateThemeManifest(
			getBuiltInTheme('workshop'),
			'northstar',
			'Northstar'
		);
		initialTheme.assets = [
			{
				id: 'paper-texture',
				slot: 'background-texture',
				sourceUrl: 'asset:paper-texture',
				mimeType: 'image/png',
				alt: ''
			}
		];
		const onRemoveResource = vi.fn().mockImplementation((_resourceID, currentDraft) => ({
			...currentDraft,
			assets: []
		}));
		const screen = render(ThemeEditor, { initialTheme, onRemoveResource });

		await screen.getByRole('button', { name: 'Fonts & assets' }).click();
		await screen.getByRole('button', { name: 'Remove', exact: true }).click();
		expect(onRemoveResource).not.toHaveBeenCalled();
		await screen.getByRole('button', { name: 'Remove resource' }).click();

		expect(onRemoveResource).toHaveBeenCalledWith(
			'paper-texture',
			expect.objectContaining({
				assets: [expect.objectContaining({ id: 'paper-texture' })]
			})
		);
		await expect.element(screen.getByText('No uploaded resources.')).toBeVisible();
	});
});
