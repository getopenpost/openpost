import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = join(currentDir, '../../..');
const srcRoot = join(frontendRoot, 'src');

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

// Files owned by parallel work; they are intentionally excluded from the strict
// guard until their dedicated fix lands. Each entry must have a reason.
const DEFERRED_FILES = new Map<string, string>([
	[
		'src/routes/video-editor/[id]/+page.svelte',
		'deferred: timeline and canvas are owned by parallel work (timeline-panel, on-canvas-tools, editor-workspace-switcher, export-dialog)'
	],
	[
		'src/lib/video-editor/components/timeline-panel.svelte',
		'deferred: dense timeline gestures owned by parallel work'
	],
	[
		'src/lib/video-editor/components/export-dialog.svelte',
		'deferred: export flow owned by parallel work'
	],
	[
		'src/lib/video-editor/components/on-canvas-tools.svelte',
		'deferred: on-canvas tools owned by parallel work'
	],
	[
		'src/lib/video-editor/components/group-on-canvas-tools.svelte',
		'deferred: group canvas tools owned by parallel work'
	],
	[
		'src/lib/video-editor/components/editor-workspace-switcher.svelte',
		'deferred: workspace switcher owned by parallel work'
	]
]);

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
		const seenDeferred = new Set<string>();

		for (const abs of allFiles) {
			const rel = abs.replace(`${frontendRoot}/`, '');
			if (DEFERRED_FILES.has(rel)) {
				seenDeferred.add(rel);
				continue;
			}
			const content = readFileSync(abs, 'utf8');
			const lines = content.split('\n');
			lines.forEach((line, idx) => {
				for (const token of TARGET_ANIMATIONS) {
					if (line.includes(token)) {
						// motion-reduce guard must be on same line (class string) or an explicit essential marker
						if (isGuardedLine(line)) continue;
						const key = `${rel}:${idx + 1}`;
						if (ESSENTIAL_ALLOWLIST.has(key)) continue;
						// Also check if the same quoted class attribute spans multiple lines? For now,
						// require the guard to be co-located on the same line.
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

		// Ensure deferred entries actually exist, so the allowlist stays honest
		for (const [rel, reason] of DEFERRED_FILES) {
			expect(reason.length, `${rel} deferred reason must not be empty`).toBeGreaterThan(10);
		}
		expect(
			[...seenDeferred].sort(),
			'deferred file set drifted - update DEFERRED_FILES map'
		).toEqual([...DEFERRED_FILES.keys()].sort());

		expect(
			violations,
			violations.length
				? `Unguarded animation found. Add motion-reduce:animate-none or mark essential with "motion-essential: <reason>" on the same line.\n${violations.map((v) => `${v.file}:${v.line} (${v.token}) => ${v.snippet}`).join('\n')}`
				: undefined
		).toEqual([]);
	});

	it('requires a reason for every allowed essential animation', () => {
		for (const [key, reason] of ESSENTIAL_ALLOWLIST) {
			expect(reason.trim().length, `${key} essential reason must be explicit`).toBeGreaterThan(15);
			expect(
				reason.toLowerCase(),
				`${key} reason must explain why motion is essential and what the settled fallback is`
			).toMatch(/essential/);
		}
	});
});
