import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { switchLocale } from '$lib/i18n';
import { getBuiltInTheme, type ThemeFamilyId } from '$lib/themes';
import ThemeLibrary from './theme-library.svelte';
import { duplicateThemeManifest } from './theme-editor-model';
import { builtInManifestReference } from './theme-library-model';
import '../../../routes/layout.css';

function currentBuiltInReference(id: ThemeFamilyId) {
	const manifest = getBuiltInTheme(id);
	return builtInManifestReference(manifest.id, manifest.revision);
}

const workshop = currentBuiltInReference('workshop');

describe('ThemeLibrary', () => {
	afterEach(() => switchLocale('en', { reload: false }));

	it('shows the current workspace choice and applies another built-in theme', async () => {
		const onSelect = vi.fn();
		const screen = render(ThemeLibrary, {
			selectedReference: currentBuiltInReference('studio'),
			workspaceReference: currentBuiltInReference('studio'),
			organizationDefaultReference: workshop,
			canManageWorkspace: true,
			onSelect
		});

		await expect
			.element(screen.getByRole('button', { name: 'Test Studio' }))
			.toHaveAttribute('aria-pressed', 'true');
		await screen.getByRole('button', { name: 'Test Notebook' }).click();
		expect(onSelect).not.toHaveBeenCalled();
		await screen.getByRole('button', { name: 'Apply Notebook' }).click();
		expect(onSelect).toHaveBeenCalledWith(currentBuiltInReference('notebook'));
	});

	it('clears the workspace override when the organization default is chosen', async () => {
		const onInherit = vi.fn();
		const screen = render(ThemeLibrary, {
			selectedReference: currentBuiltInReference('studio'),
			workspaceReference: currentBuiltInReference('studio'),
			organizationDefaultReference: workshop,
			canManageWorkspace: true,
			onInherit
		});

		await screen.getByRole('button', { name: 'Test Workshop' }).click();
		await screen.getByRole('button', { name: 'Use organization default' }).click();

		expect(onInherit).toHaveBeenCalledOnce();
	});

	it('prevents workspace overrides while organization selection is locked', async () => {
		const screen = render(ThemeLibrary, {
			selectedReference: workshop,
			workspaceSelectionLocked: true,
			canManageWorkspace: true
		});

		await screen.getByRole('button', { name: 'Test Notebook' }).click();
		const assignment = screen.getByRole('button', { name: 'Use Notebook' });
		await expect.element(assignment).toBeDisabled();
		await expect
			.element(assignment)
			.toHaveAttribute('aria-describedby', 'theme-assignment-disabled-reason');
		await expect.element(screen.getByText(/Set by organization/)).toBeVisible();
		await expect
			.element(screen.getByText('The organization has locked workspace theme selection.'))
			.toBeVisible();
	});

	it('requires confirmation before clearing workspace theme choices', async () => {
		const onToggleLock = vi.fn();
		const screen = render(ThemeLibrary, {
			canManageOrganization: true,
			onToggleLock
		});

		await expect.element(screen.getByText(/clear workspace overrides/i)).toBeVisible();
		await screen.getByRole('switch', { name: 'Lock workspace theme selection' }).click();

		expect(onToggleLock).not.toHaveBeenCalled();
		await expect
			.element(screen.getByRole('heading', { name: 'Lock theme selection?' }))
			.toBeVisible();
		await screen.getByRole('button', { name: 'Lock and clear choices' }).click();
		expect(onToggleLock).toHaveBeenCalledWith(true);
	});

	it('names a duplicate and submits its immutable source reference', async () => {
		const onCreate = vi.fn();
		const screen = render(ThemeLibrary, {
			canManageOrganization: true,
			onCreate
		});

		await screen.getByRole('button', { name: 'Test Notebook' }).click();
		await screen.getByRole('button', { name: 'Duplicate' }).click();
		await expect.element(screen.getByLabelText('Theme name')).toHaveValue('Notebook copy');
		await screen.getByRole('button', { name: 'Create draft' }).click();

		expect(onCreate).toHaveBeenCalledWith({
			name: 'Notebook copy',
			source: currentBuiltInReference('notebook')
		});
	});

	it('does not assign drafts and guards themes that are still in use from deletion', async () => {
		const draft = duplicateThemeManifest(getBuiltInTheme('studio'), 'northstar', 'Northstar');
		const onDelete = vi.fn();
		const screen = render(ThemeLibrary, {
			organizationThemes: [
				{
					manifest: draft,
					reference: { kind: 'custom', id: 'northstar', version: 1 },
					source: 'organization',
					state: 'draft',
					assignedWorkspaces: 2
				}
			],
			canManageOrganization: true,
			canManageWorkspace: true,
			onDelete
		});

		await screen.getByRole('button', { name: 'Test Northstar' }).click();
		await expect.element(screen.getByRole('button', { name: 'Use Northstar' })).toBeDisabled();
		await expect.element(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
		expect(onDelete).not.toHaveBeenCalled();
	});

	it('does not offer an unpublished draft as an immutable copy source', async () => {
		const draft = duplicateThemeManifest(getBuiltInTheme('studio'), 'northstar', 'Northstar');
		const screen = render(ThemeLibrary, {
			organizationThemes: [
				{
					manifest: draft,
					reference: { kind: 'custom', id: 'northstar', version: 1 },
					source: 'organization',
					state: 'draft'
				}
			],
			canManageOrganization: true,
			onCreate: vi.fn()
		});

		await screen.getByRole('button', { name: 'Create theme' }).click();
		await screen.getByRole('button', { name: 'Starting point' }).click();
		await expect.element(screen.getByRole('option', { name: /Northstar/ })).not.toBeInTheDocument();
	});

	it('requires confirmation before deleting an unused custom theme', async () => {
		const customTheme = duplicateThemeManifest(
			getBuiltInTheme('notebook'),
			'northstar',
			'Northstar'
		);
		const onDelete = vi.fn();
		const screen = render(ThemeLibrary, {
			organizationThemes: [
				{
					manifest: customTheme,
					reference: { kind: 'custom', id: 'northstar', version: 1 },
					source: 'organization',
					state: 'published',
					assignedWorkspaces: 0
				}
			],
			canManageOrganization: true,
			onDelete
		});

		await screen.getByRole('button', { name: 'Delete' }).click();
		expect(onDelete).not.toHaveBeenCalled();
		await expect.element(screen.getByRole('heading', { name: 'Delete Northstar?' })).toBeVisible();

		await screen.getByRole('button', { name: 'Delete theme' }).click();
		expect(onDelete).toHaveBeenCalledWith('northstar');
	});

	it('keeps a default theme protected when list and settings revisions are briefly stale', async () => {
		const customTheme = duplicateThemeManifest(
			getBuiltInTheme('notebook'),
			'northstar',
			'Northstar'
		);
		const screen = render(ThemeLibrary, {
			organizationThemes: [
				{
					manifest: customTheme,
					reference: { kind: 'custom', id: 'northstar', version: 4 },
					source: 'organization',
					state: 'published',
					assignedWorkspaces: 0
				}
			],
			organizationDefaultReference: {
				kind: 'custom',
				id: 'northstar',
				version: 3
			},
			canManageOrganization: true,
			onDelete: vi.fn()
		});

		await expect.element(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
	});

	it('keeps failed workspace changes visible instead of leaking a rejected promise', async () => {
		const screen = render(ThemeLibrary, {
			selectedReference: workshop,
			canManageWorkspace: true,
			onSelect: vi.fn().mockRejectedValue(new Error('The workspace changed on another device'))
		});

		await screen.getByRole('button', { name: 'Test Notebook' }).click();
		await screen.getByRole('button', { name: 'Use Notebook' }).click();

		await expect
			.element(screen.getByRole('alert'))
			.toHaveTextContent('The workspace changed on another device');
	});

	it('switches to a supported scheme when testing a single-scheme theme', async () => {
		const onSchemeChange = vi.fn();
		const screen = render(ThemeLibrary, {
			scheme: 'dark',
			onSchemeChange
		});

		await screen.getByRole('button', { name: 'Test Notebook' }).click();

		expect(onSchemeChange).toHaveBeenCalledWith('light');
	});
});
