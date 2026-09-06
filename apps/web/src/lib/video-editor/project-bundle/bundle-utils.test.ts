import { describe, expect, it } from 'vitest';
import {
	PROJECT_BUNDLE_MANIFEST_PATH,
	PROJECT_BUNDLE_SNAPSHOT_PATH,
	PROJECT_BUNDLE_VERSION,
	type ProjectBundleManifest
} from './bundle-types';
import {
	bundleMediaPath,
	computeBundleManifestChecksum,
	hashBlob,
	isSafeBundlePath,
	sanitizeBundleFileName,
	validateBundleManifest
} from './bundle-utils';

function manifest(): ProjectBundleManifest {
	const value: ProjectBundleManifest = {
		version: PROJECT_BUNDLE_VERSION,
		createdAt: '2026-08-24T00:00:00.000Z',
		editorVersion: 'test',
		projectId: 'project-1',
		projectName: 'Launch',
		project: {
			relativePath: PROJECT_BUNDLE_SNAPSHOT_PATH,
			fileSize: 100,
			sha256: 'a'.repeat(64)
		},
		media: [],
		checksum: ''
	};
	value.checksum = computeBundleManifestChecksum(value);
	return value;
}

describe('project bundle utilities', () => {
	it('hashes a blob incrementally and reports every byte', async () => {
		let completed = 0;
		const hash = await hashBlob(new Blob(['portable project']), (bytes) => (completed += bytes));
		expect(hash).toBe('bf237c16c91dcbd64ec42ed5a503e55bd808c8d4ad344437ceacb513063cfad9');
		expect(completed).toBe(16);
	});

	it('rejects traversal, repeated ids, conflicting paths, and changed manifests', () => {
		expect(isSafeBundlePath('../project.json')).toBe(false);
		expect(isSafeBundlePath('/project.json')).toBe(false);
		expect(isSafeBundlePath('media/hash/video.mp4')).toBe(true);

		const repeated = manifest();
		const mediaPath = `media/${'b'.repeat(64)}/video.mp4`;
		repeated.media = [
			{
				originalId: 'media-1',
				relativePath: mediaPath,
				fileName: 'video.mp4',
				fileSize: 4,
				sha256: 'b'.repeat(64),
				mimeType: 'video/mp4',
				metadata: {
					duration: 1,
					width: 1,
					height: 1,
					fps: 1,
					codec: 'avc1',
					bitrate: 32,
					tags: ['video']
				}
			},
			{
				originalId: 'media-1',
				relativePath: mediaPath,
				fileName: 'video.mp4',
				fileSize: 4,
				sha256: 'b'.repeat(64),
				mimeType: 'video/mp4',
				metadata: {
					duration: 1,
					width: 1,
					height: 1,
					fps: 1,
					codec: 'avc1',
					bitrate: 32,
					tags: ['video']
				}
			}
		];
		repeated.checksum = computeBundleManifestChecksum(repeated);
		expect(() => validateBundleManifest(repeated)).toThrow('repeats media id');

		const changed = manifest();
		changed.projectName = 'Changed';
		expect(() => validateBundleManifest(changed)).toThrow('checksum does not match');
	});

	it('creates safe internal paths and OpenPost bundle names', () => {
		expect(bundleMediaPath('abc', '../Launch: final.mp4')).toBe('media/abc/_Launch_ final.mp4');
		expect(sanitizeBundleFileName('Launch: final')).toBe('Launch_ final.openpost.zip');
		expect(PROJECT_BUNDLE_MANIFEST_PATH).toBe('manifest.json');
	});
});
