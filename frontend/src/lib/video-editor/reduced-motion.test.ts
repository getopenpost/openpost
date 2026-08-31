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

// If an animation is truly essential and must remain motionful even under
// reduced motion, add its file+line with a clear reason and a settled fallback
// description. Example: 'src/lib/video-editor/components/recording-dialog.svelte:645': 'essential: live recording indicator pulse; reduced-motion shows static dot via motion-reduce:animate-none'
const ESSENTIAL_ALLOWLIST = new Map<string, string>([
	// No essential unguarded animation remains; every current pulse/spin is nonessential
	// and carries motion-reduce:animate-none. Keep this map as the explicit allowlist
	// for future essential cases.
]);

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

function isGuardedLine(line: string): boolean {
	if (line.includes('motion-reduce:animate-none')) return true;
	if (line.includes('motion-essential:')) return true;
	return false;
}

describe('reduced-motion policy', () => {
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
						if (isGuardedLine(line)) continue;
						const key = `${rel}:${idx + 1}`;
						if (ESSENTIAL_ALLOWLIST.has(key)) continue;
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

	it('requires a reason for every allowed essential animation', () => {
		const invalidEntries = [...ESSENTIAL_ALLOWLIST].filter(
			([, reason]) => reason.trim().length <= 15 || !reason.toLowerCase().includes('essential')
		);
		expect(invalidEntries).toEqual([]);
	});
});
