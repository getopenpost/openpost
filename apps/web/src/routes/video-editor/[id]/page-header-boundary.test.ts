import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pagePath = fileURLToPath(new URL('./+page.svelte', import.meta.url));
const shellPath = fileURLToPath(
	new URL('../../../lib/image-editor/components/image-editor-shell.svelte', import.meta.url)
);

describe('OpenPost Video Editor project header boundary', () => {
	it('keeps the shared menubar component alive for the image editor shell', async () => {
		const shell = await readFile(shellPath, 'utf8');

		expect(shell).toContain('<EditorMenubar');
	});

	it('keeps Save reachable without the menubar', async () => {
		const source = await readFile(pagePath, 'utf8');

		// Keyboard shortcut plus autosave.
		expect(source).toContain("matches('SAVE')");
		expect(source).toContain('scheduleAutosave');
		// Overflow project menu entry.
		expect(source).toContain('onclick={saveProject}');
	});

	it('keeps Export reachable without the menubar', async () => {
		const source = await readFile(pagePath, 'utf8');

		// Header dialog entry point plus shortcut and overflow menu entries.
		expect(source).toContain('<ExportDialog');
		expect(source).toContain('triggerLabel={m.video_editor_export_title()}');
		expect(source).toContain("matches('EXPORT')");
		expect(source).toContain('void handleExport()');
	});

	it('keeps cloud-only History reachable without the menubar', async () => {
		const source = await readFile(pagePath, 'utf8');

		expect(source).toContain('{#if cloudStorage}');
		expect(source).toContain('aria-label={m.video_editor_history()}');
		expect(source).toContain('historyOpen = true');
	});

	it('keeps the remaining menubar actions reachable without the menubar', async () => {
		const source = await readFile(pagePath, 'utf8');

		// Edit.
		expect(source).toContain('onclick={undoProject}');
		expect(source).toContain('onclick={redoProject}');
		// Clip.
		expect(source).toContain('onclick={handleSplit}');
		// Sequences.
		expect(source).toContain('onclick={createEditorSequence}');
		expect(source).toContain('onclick={duplicateActiveSequence}');
		// View workspaces via the centered tabs.
		expect(source).toContain('<EditorWorkspaceTabs');
		expect(source).toContain("matches('WORKSPACE_EDIT')");
		// Help settings via the header button, shortcut, and overflow menu.
		expect(source).toContain('aria-label={m.video_editor_settings_title()}');
		expect(source).toContain("matches('OPEN_SETTINGS')");
		expect(source).toContain('settingsOpen = true');
	});
});
