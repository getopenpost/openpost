import { describe, expect, it } from 'vitest';
import { calculateStorageBudget, projectPath, validateProjectPath } from './storage';

describe('Video Studio storage budget', () => {
	it('reserves twenty percent transient headroom', () => {
		const budget = calculateStorageBudget(100, 1_300, 1_000);
		expect(budget.headroom_bytes).toBe(200);
		expect(budget.can_continue).toBe(true);
	});

	it('fails closed when quota information is unavailable', () => {
		expect(calculateStorageBudget(0, 0, 1).can_continue).toBe(false);
	});
});

describe('Video Studio OPFS paths', () => {
	it('builds a scoped project path', () => {
		expect(projectPath('project 1', 'sources', 'source one.mp4')).toBe(
			'projects/project-1/sources/source-one.mp4'
		);
	});

	it('rejects traversal and paths outside projects', () => {
		expect(() => validateProjectPath('projects/a/sources/../secret')).toThrow();
		expect(() => validateProjectPath('other/a/sources/file')).toThrow();
	});
});
