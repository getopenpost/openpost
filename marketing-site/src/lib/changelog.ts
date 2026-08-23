import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function readCanonicalChangelog(cwd = process.cwd()) {
	const candidates = [resolve(cwd, 'CHANGELOG.md'), resolve(cwd, '..', 'CHANGELOG.md')];
	for (const candidate of candidates) {
		try {
			return await readFile(candidate, 'utf8');
		} catch {
			// Build commands can run from the repository root or the package root.
		}
	}
	throw new Error('Could not find the repository CHANGELOG.md');
}
