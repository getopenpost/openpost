import { readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const semanticSurfaces = [
	new URL('../components/app-error-state.svelte', import.meta.url),
	new URL('../quick-cut/components/SegmentList.svelte', import.meta.url)
];

// Approved exceptions: public and pre-workspace screens are out of the theme
// scope by product decision (no workspace is known, so no theme applies), and
// may use library icons directly.
const approvedPublicExceptions = [
	'../../routes/_components/PublicHome.svelte',
	'../../routes/u/[username]/+page.svelte',
	// The protection mechanism itself: ProtectedIcon renders protected glyphs
	// (status, media, editor) from the pinned library so theme packs can never
	// replace them. This is the one allowed direct import inside theme scope.
	'./icons/protected-icon.svelte'
];

function sourceFiles(directory: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
				files.push(...sourceFiles(path));
			}
			continue;
		}
		if (entry.isFile() && /\.(svelte|ts|tsx)$/.test(entry.name)) files.push(path);
	}
	return files;
}

describe('remaining app icon boundary', () => {
	it('keeps functional app icons behind semantic registries', async () => {
		for (const surface of semanticSurfaces) {
			const source = await readFile(surface, 'utf8');
			expect(source, surface.pathname).not.toContain('@lucide/svelte');
		}
	});

	it('allows direct library icons only on documented public exceptions', () => {
		const root = new URL('../../', import.meta.url);
		const allowed = new Set(
			approvedPublicExceptions.map((file) =>
				relative(root.pathname, new URL(file, import.meta.url).pathname)
			)
		);
		const offenders: string[] = [];
		for (const file of sourceFiles(root.pathname)) {
			if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
			if (!readFileSync(file, 'utf8').includes('@lucide/svelte')) continue;
			const repoPath = relative(root.pathname, file);
			if (!allowed.has(repoPath)) offenders.push(repoPath);
		}
		expect(offenders).toEqual([]);
	});
});
