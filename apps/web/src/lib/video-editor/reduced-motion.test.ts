import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = join(currentDir, '../../..');

const SCANNED_ROOTS = [
	'src/lib/video-editor',
	'src/lib/quick-cut',
	'src/routes/quick-cut',
	'src/routes/record',
	'src/routes/video-editor'
] as const;

const TARGET_ANIMATIONS = [
	'animate-spin',
	'animate-pulse',
	'animate-ping',
	'animate-bounce'
] as const;

function walk(dir: string, out: string[]): void {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}
	for (const entry of entries) {
		const full = join(dir, entry);
		const stat = statSync(full);
		if (stat.isDirectory()) {
			if (entry === 'node_modules' || entry.startsWith('.')) continue;
			walk(full, out);
		} else if (entry.endsWith('.svelte')) {
			out.push(full);
		}
	}
}

function isGuardedLine(line: string, token: string): boolean {
	if (line.includes('motion-reduce:animate-none')) return true;
	if (line.includes('motion-essential:')) return true;
	return !line.replaceAll(`motion-safe:${token}`, '').includes(token);
}

describe('reduced-motion policy', () => {
	it.each([
		['motion-safe:animate-pulse', true],
		['hover:motion-safe:animate-pulse', true],
		['motion-safe:animate-pulse animate-pulse', false]
	])('recognizes guarded animation tokens in %s', (line, expected) => {
		expect(isGuardedLine(line, 'animate-pulse')).toBe(expected);
	});

	it('guards every nonessential animate in Video Editor, Quick Cut, and Record Svelte UI', () => {
		const allFiles: string[] = [];
		for (const root of SCANNED_ROOTS) {
			walk(join(frontendRoot, root), allFiles);
		}

		const violations: Array<{ file: string; line: number; snippet: string; token: string }> = [];

		for (const abs of allFiles) {
			const rel = abs.replace(`${frontendRoot}/`, '');
			const content = readFileSync(abs, 'utf8');
			const lines = content.split('\n');
			lines.forEach((line, idx) => {
				for (const token of TARGET_ANIMATIONS) {
					if (line.includes(token)) {
						// motion-reduce guard must be on same line (class string) or an explicit essential marker
						if (isGuardedLine(line, token)) continue;
						violations.push({
							file: rel,
							line: idx + 1,
							snippet: line.trim().slice(0, 180),
							token
						});
					}
				}
			});
		}

		expect(
			violations,
			violations.length
				? `Unguarded animation found. Add motion-reduce:animate-none or mark essential with "motion-essential: <reason>" on the same line.\n${violations.map((v) => `${v.file}:${v.line} (${v.token}) => ${v.snippet}`).join('\n')}`
				: undefined
		).toEqual([]);
	});
});
