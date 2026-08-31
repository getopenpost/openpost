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
	it('keeps ordinary names intact', () => {
		expect(sanitizeWorkspaceFileName('MyVacation.mp4')).toBe('MyVacation.mp4');
	});

	it('replaces filesystem-invalid characters', () => {
		expect(sanitizeWorkspaceFileName('a<b>c:d.mp4')).toBe('a_b_c_d.mp4');
	});

	it('falls back when empty', () => {
		expect(sanitizeWorkspaceFileName('')).toBe('source.bin');
		expect(sanitizeWorkspaceFileName('   ')).toBe('source.bin');
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
	it('builds project paths from ids', () => {
		expect(projectJsonPath('p1')).toEqual(['projects', 'p1', 'project.json']);
		expect(mediaMetadataPath('m1')).toEqual(['media', 'm1', 'metadata.json']);
	});

	it('keeps reverse conforms under their source cache', () => {
		expect(mediaEmbeddedSubtitlesPath('m1')).toEqual([
			'media',
			'm1',
			'cache',
			'embedded-subtitles.json'
		]);
		expect(mediaReversePreviewPath('m1', 'v1-fingerprint')).toEqual([
			'media',
			'm1',
			'cache',
			'reverse',
			'v1-fingerprint.webm'
		]);
		expect(sourceTranscriptPath('m1')).toEqual(['media', 'm1', 'cache', 'ai', 'transcript.json']);
	});

	it('sanitizes user-facing file names in export paths', () => {
		expect(exportFilePath('my cut.mp4')).toEqual(['exports', 'my cut.mp4']);
		expect(recordingFilePath('take/1.webm')).toEqual(['recordings', 'take_1.webm']);
	});

	it('builds filmstrip frame paths with extension', () => {
		expect(filmstripFramePath('m1', 3, 'jpg')).toEqual([
			'media',
			'm1',
			'cache',
			'filmstrip',
			'3.jpg'
		]);
	});
});
