import { afterEach, describe, expect, it } from 'vitest';
import { createBlankProject, CURRENT_SCHEMA_VERSION } from '../project/defaults';
import type { Project } from '../project/types';
import { readJson, writeJsonAtomic } from './fs-primitives';
import { projectJsonPath } from './paths';
import { getAllProjects, getProject } from './projects';
import { setWorkspaceRoot } from './root';
import { writeWorkspaceIndex } from './workspace-index';

let workspaceName: string | null = null;

afterEach(async () => {
	setWorkspaceRoot(null);
	if (!workspaceName) return;
	const root = await navigator.storage.getDirectory();
	await root.removeEntry(workspaceName, { recursive: true }).catch(() => undefined);
	workspaceName = null;
});

describe('workspace project migration boundaries', () => {
	it('normalizes legacy projects for the catalog without changing disk until one is opened', async () => {
		const storageRoot = await navigator.storage.getDirectory();
		workspaceName = `project-list-migration-${crypto.randomUUID()}`;
		const workspace = await storageRoot.getDirectoryHandle(workspaceName, { create: true });
		setWorkspaceRoot(workspace);

		const legacy = createBlankProject('Legacy edit');
		legacy.id = 'legacy-project';
		legacy.schemaVersion = CURRENT_SCHEMA_VERSION - 1;
		await writeJsonAtomic(workspace, projectJsonPath(legacy.id), legacy);
		await writeWorkspaceIndex(workspace, [
			{ id: legacy.id, name: legacy.name, updatedAt: legacy.updatedAt }
		]);

		const listed = await getAllProjects();

		expect(listed).toHaveLength(1);
		expect(listed[0]?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
		expect((await readJson<Project>(workspace, projectJsonPath(legacy.id)))?.schemaVersion).toBe(
			CURRENT_SCHEMA_VERSION - 1
		);
		const backupId = `${legacy.id}-backup-v${legacy.schemaVersion}-v${CURRENT_SCHEMA_VERSION}`;
		expect(await readJson<Project>(workspace, projectJsonPath(backupId))).toBeNull();

		const opened = await getProject(legacy.id);

		expect(opened?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
		expect((await readJson<Project>(workspace, projectJsonPath(legacy.id)))?.schemaVersion).toBe(
			CURRENT_SCHEMA_VERSION
		);
		expect((await readJson<Project>(workspace, projectJsonPath(backupId)))?.schemaVersion).toBe(
			CURRENT_SCHEMA_VERSION - 1
		);
	});
});
