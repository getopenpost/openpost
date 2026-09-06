/**
 * Workspace folder bootstrap: run once after the user picks (or re-grants) a
 * workspace. Writes the marker file + README if they're missing and sweeps
 * stranded tmp files from prior crashes.
 *
 * Ported from FreeCut (MIT) — bootstrap.ts, without legacy-layout migrations
 * (OpenPost workspaces start at the current layout).
 */

import { createLogger } from './logger';
import {
	CONTENT_DIR,
	MARKER_FILENAME,
	MEDIA_DIR,
	PROJECTS_DIR,
	README_FILENAME,
	WORKSPACE_SCHEMA_VERSION
} from './paths';
import { exists, writeBlob, writeJsonAtomic } from './fs-primitives';

const logger = createLogger('WorkspaceBootstrap');

export type WorkspaceMarker = {
	schemaVersion: string;
	createdAt: number;
};

const README_TEMPLATE = `# OpenPost Video Editor workspace

This folder holds your video editing projects. Everything here stays on your
machine — nothing is uploaded.

- projects/  one folder per project (timeline, thumbnail, exports)
- media/     imported media, thumbnails, waveforms, transcripts
- recordings/ screen, camera, and audio takes captured with the recorder
- exports/   final rendered videos

You can move or back up this folder like any other folder. Delete it only if
you no longer want your projects.
`;

/**
 * Recursively remove stranded `*.tmp` files left behind when a crash hit
 * between a tmp-write and its atomic commit. Only sweeps directories we own.
 */
async function sweepStrandedTmpFiles(
	root: FileSystemDirectoryHandle,
	dirNames: string[]
): Promise<number> {
	let removed = 0;

	async function recurse(dir: FileSystemDirectoryHandle): Promise<void> {
		// Collect entries first because we mutate the dir while iterating.
		const entries: { name: string; kind: 'file' | 'directory' }[] = [];
		for await (const entry of dir.values()) {
			entries.push({ name: entry.name, kind: entry.kind });
		}
		for (const entry of entries) {
			if (entry.kind === 'directory') {
				try {
					const sub = await dir.getDirectoryHandle(entry.name, { create: false });
					await recurse(sub);
				} catch {
					// Unreadable subdir — skip it.
				}
				continue;
			}
			if (entry.name.endsWith('.tmp')) {
				try {
					await dir.removeEntry(entry.name);
					removed++;
				} catch {
					// Best effort.
				}
			}
		}
	}

	for (const name of dirNames) {
		try {
			const sub = await root.getDirectoryHandle(name, { create: false });
			await recurse(sub);
		} catch {
			// Directory missing (fresh workspace) — nothing to sweep.
		}
	}
	return removed;
}

export async function bootstrapWorkspace(root: FileSystemDirectoryHandle): Promise<void> {
	// README: only write when missing — never overwrite user edits.
	if (!(await exists(root, [README_FILENAME]))) {
		try {
			await writeBlob(root, [README_FILENAME], README_TEMPLATE);
		} catch (error) {
			logger.warn('Failed to write README.md', error);
		}
	}

	// Marker: write on first bootstrap so we can detect "this is a real
	// workspace" and attach a schema version for future migrations.
	if (!(await exists(root, [MARKER_FILENAME]))) {
		const marker: WorkspaceMarker = {
			schemaVersion: WORKSPACE_SCHEMA_VERSION,
			createdAt: Date.now()
		};
		try {
			await writeJsonAtomic(root, [MARKER_FILENAME], marker);
		} catch (error) {
			logger.warn('Failed to write workspace marker', error);
		}
	}

	// Clean up any `.tmp` files stranded by a prior crash.
	try {
		const removed = await sweepStrandedTmpFiles(root, [PROJECTS_DIR, MEDIA_DIR, CONTENT_DIR]);
		if (removed > 0) {
			logger.info(`Swept ${removed} stranded .tmp file(s) from prior crash`);
		}
	} catch (error) {
		logger.warn('sweepStrandedTmpFiles failed', error);
	}
}
