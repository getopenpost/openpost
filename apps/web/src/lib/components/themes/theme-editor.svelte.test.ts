import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { switchLocale } from '$lib/i18n';
import { getBuiltInTheme, WebThemeRuntime, type ThemeRuntimeLoaders } from '$lib/themes';
import ThemeEditor from './theme-editor.svelte';
import { duplicateThemeManifest } from './theme-manifest.test-fixtures';
import '../../../routes/layout.css';

function previewFrame(element: Element): HTMLIFrameElement {
	if (!(element instanceof HTMLIFrameElement))
		throw new Error('Theme preview iframe is unavailable');
	return element;
}

function inputValue(element: Element): string {
	if (!(element instanceof HTMLInputElement))
		throw new Error('Expected the theme editor color field input');
	return element.value;
}

function stagedRuntime(): WebThemeRuntime {
	// Font/asset staging needs network resources the test env cannot provide;
	// these cases assert the resolved preview document, not staging.
	return new WebThemeRuntime({
		stageFonts: vi.fn(async () => ({ release: vi.fn() })),
		loadAssets: vi.fn(async () => undefined),
		loadIconPack: vi.fn(async () => undefined),
		setBrowserSurface: vi.fn(() => vi.fn())
	});
}

describe('ThemeEditor', () => {
	afterEach(() => switchLocale('en', { reload: false }));

	it('edits the accent of the selected Dither scheme when the other scheme uses a different material', async () => {
		const initialTheme = duplicateThemeManifest(getBuiltInTheme('dither'), 'custom', 'Custom');
		initialTheme.schemes.light!.components.decoration = 'none';
		const screen = render(ThemeEditor, { initialTheme });
		await screen.getByRole('button', { name: 'Dark', exact: true }).click();
		const hue = screen.getByRole('spinbutton', { name: 'Accent hue', exact: true });
		await hue.fill('305');
		await expect.element(hue).toHaveValue(305);
		await expect
			.element(screen.getByRole('slider', { name: 'Accent hue' }))
			.toHaveAttribute('aria-valuenow', '305');
	});

	it('changes a typeface as one selection and closes its menu', async () => {
		const initialTheme = duplicateThemeManifest(getBuiltInTheme('dither'), 'custom', 'Custom');
		const screen = render(ThemeEditor, { initialTheme });
		await screen.getByRole('button', { name: 'Type', exact: true }).click();
		await screen.getByRole('button', { name: /^Family / }).click();
		await screen.getByRole('option', { name: 'Inter', exact: true }).click();
		await expect.element(screen.getByRole('listbox')).not.toBeInTheDocument();
		await expect
			.element(screen.getByRole('button', { name: /^Family / }))
			.toHaveTextContent('Inter Variable');
		await screen.getByRole('button', { name: 'Undo' }).click();
		await expect
			.element(screen.getByRole('button', { name: /^Family / }))
			.toHaveTextContent('Geist Variable');
	});

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
		const canvas = screen.getByLabelText('Canvas', { exact: true });
		const originalCanvas = inputValue(canvas.element());

		await expect.element(screen.getByTestId('theme-preview')).toHaveAttribute('aria-busy', 'false');
		const preview = previewFrame(screen.getByTestId('theme-preview').element());
		const originalBackground =
			preview.contentDocument?.documentElement.style.getPropertyValue('--background') ?? '';
		expect(originalBackground).toBe(initialTheme.schemes.light!.colors.canvas);

		await canvas.fill('#F1F5FF');
		await expect.element(screen.getByText('Unsaved changes')).toBeVisible();
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
		await expect.element(screen.getByText('Unsaved changes')).not.toBeInTheDocument();
		await expect.element(canvas).toHaveValue(originalCanvas);
		await expect
			.poll(() => preview.contentDocument?.documentElement.style.getPropertyValue('--background'))
			.toBe(originalBackground);

		await screen.getByRole('button', { name: 'Redo' }).click();
		await expect.element(canvas).toHaveValue('#F1F5FF');
		await expect
			.poll(() => preview.contentDocument?.documentElement.style.getPropertyValue('--background'))
			.toBe('#F1F5FF');
	});

	it('shows complete Workshop fallback for an unsupported scheme', async () => {
		const initialTheme = duplicateThemeManifest(
			getBuiltInTheme('studio'),
			'northstar-studio',
			'Northstar Studio'
		);
		delete initialTheme.schemes.dark;
		initialTheme.supportedSchemes = ['light'];
		const screen = render(ThemeEditor, { initialTheme, runtime: stagedRuntime() });

		await screen.getByRole('button', { name: /Dark Fallback/ }).click();
		await expect.element(screen.getByText('This theme does not support dark.')).toBeVisible();
		await expect.element(screen.getByText('Workshop fallback · dark')).toBeVisible();

		const workshopDark = getBuiltInTheme('workshop').schemes.dark!;
		const preview = previewFrame(screen.getByTestId('theme-preview').element());
		await expect
			.poll(() => ({
				id: preview.contentDocument?.documentElement.dataset.themeId,
				scheme: preview.contentDocument?.documentElement.dataset.themeScheme,
				source: preview.contentDocument?.documentElement.dataset.themeSource,
				fallback: preview.contentDocument?.documentElement.dataset.themeFallback,
				background: preview.contentDocument?.documentElement.style.getPropertyValue('--background'),
				editorCanvas:
					preview.contentDocument?.documentElement.style.getPropertyValue('--editor-canvas')
			}))
			.toEqual({
				id: 'workshop',
				scheme: 'dark',
				source: 'fallback',
				fallback: 'unsupported-scheme',
				background: workshopDark.colors.canvas,
				editorCanvas: workshopDark.protectedEditor.editorCanvas
			});
	});

	it('keeps invalid manifest source out of editor history', async () => {
		const onSave = vi.fn();
		const initialTheme = duplicateThemeManifest(
			getBuiltInTheme('workshop'),
			'northstar',
			'Northstar'
		);
		const screen = render(ThemeEditor, { initialTheme, onSave });
		const canvas = screen.getByLabelText('Canvas', { exact: true });
		const originalCanvas = inputValue(canvas.element());
		const undo = screen.getByRole('button', { name: 'Undo' });

		await expect.element(undo).toBeDisabled();
		await screen.getByRole('button', { name: 'Manifest', exact: true }).click();
		await screen.getByLabelText('Theme manifest JSON').fill('{"schemaVersion":1}');
		await screen.getByRole('button', { name: 'Apply manifest' }).click();

		await expect.element(screen.getByRole('alert')).toHaveTextContent('id is required');
		await expect.element(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
		await expect.element(undo).toBeDisabled();
		await screen.getByRole('button', { name: 'Guided' }).click();
		await expect
			.element(screen.getByRole('button', { name: 'Manifest', exact: true }))
			.toHaveAttribute('aria-pressed', 'true');
		expect(onSave).not.toHaveBeenCalled();

		// Replacing the rejected source with the unchanged manifest releases the
		// guided mode instead of leaving the editor stuck in the manifest view.
		await screen.getByLabelText('Theme manifest JSON').fill(JSON.stringify(initialTheme));
		await screen.getByRole('button', { name: 'Guided' }).click();

		await expect.element(canvas).toHaveValue(originalCanvas);
		await expect.element(screen.getByText('Revision draft')).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
	});

	it('keeps server-owned manifest identity out of advanced edits', async () => {
		const initialTheme = duplicateThemeManifest(
			getBuiltInTheme('workshop'),
			'northstar',
			'Northstar'
		);
		const screen = render(ThemeEditor, { initialTheme, runtime: stagedRuntime() });
		const canvas = screen.getByLabelText('Canvas', { exact: true });
		const originalCanvas = inputValue(canvas.element());
		const undo = screen.getByRole('button', { name: 'Undo' });

		await expect.element(screen.getByTestId('theme-preview')).toHaveAttribute('aria-busy', 'false');
		const preview = previewFrame(screen.getByTestId('theme-preview').element());
		await expect
			.poll(() => preview.contentDocument?.documentElement.dataset.themeId)
			.toBe('northstar');
		await expect.element(undo).toBeDisabled();
		await screen.getByRole('button', { name: 'Manifest', exact: true }).click();
		const manifestJSON = screen.getByLabelText('Theme manifest JSON');

		const changedID = structuredClone(initialTheme);
		changedID.id = 'another-theme';
		await manifestJSON.fill(JSON.stringify(changedID));
		await screen.getByRole('button', { name: 'Apply manifest' }).click();

		await expect
			.element(screen.getByRole('alert'))
			.toHaveTextContent('Theme ID is managed by OpenPost');
		await expect.element(undo).toBeDisabled();
		await expect
			.poll(() => preview.contentDocument?.documentElement.dataset.themeId)
			.toBe('northstar');

		const changedRevision = structuredClone(initialTheme);
		changedRevision.revision = 'renamed-revision';
		await manifestJSON.fill(JSON.stringify(changedRevision));
		await screen.getByRole('button', { name: 'Apply manifest' }).click();

		await expect
			.element(screen.getByRole('alert'))
			.toHaveTextContent('Theme revision is managed by OpenPost');
		await expect.element(undo).toBeDisabled();
		await expect
			.poll(() => preview.contentDocument?.documentElement.dataset.themeId)
			.toBe('northstar');

		// The rejected paraphrases never dirtied the authored draft: re-applying the
		// original source returns to the clean server revision.
		await manifestJSON.fill(JSON.stringify(initialTheme));
		await screen.getByRole('button', { name: 'Guided' }).click();
		await expect.element(canvas).toHaveValue(originalCanvas);
		await expect.element(screen.getByText('Revision draft')).toBeVisible();
		await expect.element(screen.getByText('Unsaved changes')).not.toBeInTheDocument();
		await expect.element(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
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

		await expect.element(screen.getByLabelText('Canvas', { exact: true })).toHaveValue('#F1F5FF');
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

		await screen.getByLabelText('Canvas', { exact: true }).fill('url(https://example.com/tracker)');

		await expect.element(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
		await expect.element(screen.getByText(/current draft is incomplete/i)).toBeVisible();
		expect(onPublish).not.toHaveBeenCalled();
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

		await screen.getByLabelText('Canvas', { exact: true }).fill('#F1F5FF');
		await screen.getByRole('button', { name: 'Save draft' }).click();

		// A failed save reports the conflict and leaves the authored changes dirty.
		await expect
			.element(screen.getByRole('alert'))
			.toHaveTextContent('The draft changed on another device');
		await expect.element(screen.getByText('Unsaved changes')).toBeVisible();
		await expect.element(screen.getByLabelText('Canvas', { exact: true })).toHaveValue('#F1F5FF');

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
		const canvas = screen.getByLabelText('Canvas', { exact: true });
		const originalCanvas = inputValue(canvas.element());

		await canvas.fill('#F1F5FF');
		await expect.element(screen.getByText('Unsaved changes')).toBeVisible();
		await screen.getByRole('button', { name: 'Revisions' }).click();
		await screen.getByRole('button', { name: 'Restore' }).click();
		expect(onRollback).not.toHaveBeenCalled();
		await screen.getByRole('button', { name: 'Restore revision' }).click();

		expect(onRollback).toHaveBeenCalledWith(2);
		await expect.element(screen.getByText('Revision 3')).toBeVisible();
		// The canvas field lives on the Color panel, so leave the Revisions panel
		// before observing the restored authored value.
		await screen.getByRole('button', { name: 'Color', exact: true }).click();
		await expect.element(canvas).toHaveValue(originalCanvas);
		await expect.element(screen.getByText('Unsaved changes')).not.toBeInTheDocument();
		await expect.element(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
		await expect.element(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
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

		await screen.getByLabelText('Canvas', { exact: true }).fill('#F1F5FF');
		await expect.element(screen.getByText('Unsaved changes')).toBeVisible();
		await screen.getByRole('button', { name: 'Fonts & assets' }).click();
		await screen.getByRole('button', { name: 'Remove', exact: true }).click();
		expect(onRemoveResource).not.toHaveBeenCalled();
		await screen.getByRole('button', { name: 'Remove resource' }).click();

		expect(onRemoveResource).toHaveBeenCalledTimes(1);
		expect(onRemoveResource).toHaveBeenCalledWith(
			'paper-texture',
			expect.objectContaining({
				id: 'northstar',
				name: 'Northstar',
				revision: 'draft',
				schemes: expect.objectContaining({
					light: expect.objectContaining({
						colors: expect.objectContaining({ canvas: '#F1F5FF' })
					})
				}),
				assets: [expect.objectContaining({ id: 'paper-texture', slot: 'background-texture' })]
			})
		);
		await expect.element(screen.getByText('No uploaded resources.')).toBeVisible();
	});

	it('announces server validation issues as a named alert', async () => {
		const initialTheme = duplicateThemeManifest(
			getBuiltInTheme('workshop'),
			'northstar',
			'Northstar'
		);
		const screen = render(ThemeEditor, {
			initialTheme,
			validationIssues: [{ path: 'schemes.light.colors.canvas', message: 'invalid' }]
		});

		const alert = screen.getByRole('alert', { name: 'Validation issues' });
		await expect.element(alert).toBeVisible();
		await expect.element(alert).toHaveTextContent('schemes.light.colors.canvas');
	});
});
