import { describe, expect, it } from 'vitest';
import {
	sanitizeWorkspaceFileName,
	projectJsonPath,
	mediaMetadataPath,
	mediaEmbeddedSubtitlesPath,
	mediaReversePreviewPath,
	sourceTranscriptPath,
	exportFilePath,
	recordingFilePath,
	filmstripFramePath
} from './paths';

describe('sanitizeWorkspaceFileName', () => {
	it('replaces filesystem-invalid characters', () => {
		expect(sanitizeWorkspaceFileName('a<b>c:d.mp4')).toBe('a_b_c_d.mp4');
	});

	it('suffixes Windows reserved names', () => {
		expect(sanitizeWorkspaceFileName('CON.txt')).toBe('CON_.txt');
		expect(sanitizeWorkspaceFileName('com1')).toBe('com1_');
	});

	it('caps length while preserving the extension', () => {
		const long = `${'x'.repeat(300)}.mp4`;
		const result = sanitizeWorkspaceFileName(long);
		expect(result.length).toBeLessThanOrEqual(200);
		expect(result.endsWith('.mp4')).toBe(true);
	});
});

describe('path builders', () => {
	it('sanitizes user-facing file names in export paths', () => {
		expect(exportFilePath('my cut.mp4')).toEqual(['exports', 'my cut.mp4']);
		expect(recordingFilePath('take/1.webm')).toEqual(['recordings', 'take_1.webm']);
	});
});
