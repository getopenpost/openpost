import { CURRENT_SCHEMA_VERSION } from './migrations';
import type { Project } from './types';

export function unsupportedProjectSchemaVersion(project: Project): number | null {
	const version = Number.isFinite(project.schemaVersion) ? (project.schemaVersion ?? 1) : 1;
	return version > CURRENT_SCHEMA_VERSION ? version : null;
}
