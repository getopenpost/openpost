import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaMetadata } from '../media/types';
import {
	createStorageMaintenance,
	type StorageMaintenanceDependencies
} from './storage-maintenance';

function media(id: string, tags: string[], mimeType: string): MediaMetadata {
	return {
		id,
		storageType: 'workspace',
		fileName: `${id}.bin`,
		fileSize: 100,
		mimeType,
		duration: 2,
		width: 1920,
		height: 1080,
		fps: 30,
		codec: 'avc',
		bitrate: 1_000_000,
		tags
	};
}

function testDependencies(): StorageMaintenanceDependencies {
	return {
		clearPreviewFrames: vi.fn(),
		clearWaveform: vi.fn(async () => undefined),
		clearFilmstrip: vi.fn(async () => undefined),
		clearAnimatedImages: vi.fn(async () => undefined),
		makeThumbnail: vi.fn(async () => new Blob(['poster'])),
		writeThumbnail: vi.fn(async () => undefined),
		notifyThumbnailsChanged: vi.fn(),
		isProxyCandidate: vi.fn(() => true),
		proxy: vi.fn(() => null),
		generateProxy: vi.fn(async () => new Blob(['proxy'])),
		clearProxy: vi.fn(() => true)
	};
}

let dependencies: StorageMaintenanceDependencies;

beforeEach(() => {
	dependencies = testDependencies();
});

describe('editor storage maintenance', () => {
	it('clears only derived data and reports a per-source partial failure', async () => {
		const sources = [media('one', ['video'], 'video/mp4'), media('two', ['audio'], 'audio/wav')];
		vi.mocked(dependencies.clearFilmstrip).mockRejectedValueOnce(new Error('OPFS unavailable'));
		const maintenance = createStorageMaintenance(dependencies);

		const result = await maintenance.clearProjectDerivedCaches(sources);

		expect(result).toEqual({ total: 2, succeeded: 1, failedMediaIds: ['one'] });
		expect(dependencies.clearPreviewFrames).toHaveBeenCalledOnce();
		expect(dependencies.clearWaveform).toHaveBeenCalledTimes(2);
		expect(dependencies.clearFilmstrip).toHaveBeenCalledTimes(2);
		expect(dependencies.clearAnimatedImages).toHaveBeenCalledTimes(2);
		expect(dependencies.writeThumbnail).not.toHaveBeenCalled();
	});

	it('regenerates only visual thumbnails and refreshes visible media once', async () => {
		const sources = [
			media('video', ['video'], 'video/mp4'),
			media('image', ['image'], 'image/png'),
			media('audio', ['audio'], 'audio/wav')
		];
		const maintenance = createStorageMaintenance(dependencies);

		const result = await maintenance.regenerateProjectThumbnails(sources);

		expect(result).toEqual({ total: 2, succeeded: 2, failedMediaIds: [] });
		expect(dependencies.makeThumbnail).toHaveBeenCalledTimes(2);
		expect(dependencies.writeThumbnail).toHaveBeenCalledTimes(2);
		expect(dependencies.notifyThumbnailsChanged).toHaveBeenCalledOnce();
	});

	it('generates only missing recommended proxies and deletes only cached proxies', async () => {
		const sources = [
			media('missing', ['video'], 'video/mp4'),
			media('cached', ['video'], 'video/mp4'),
			media('light', ['video'], 'video/mp4')
		];
		vi.mocked(dependencies.isProxyCandidate).mockImplementation((item) => item.id !== 'light');
		vi.mocked(dependencies.proxy).mockImplementation((id) =>
			id === 'cached' ? new Blob(['proxy']) : null
		);
		const maintenance = createStorageMaintenance(dependencies);

		expect(await maintenance.generateRecommendedProxies(sources)).toEqual({
			total: 1,
			succeeded: 1,
			failedMediaIds: []
		});
		expect(dependencies.generateProxy).toHaveBeenCalledWith(sources[0]);

		expect(await maintenance.deleteProjectProxies(sources)).toEqual({
			total: 1,
			succeeded: 1,
			failedMediaIds: []
		});
		expect(dependencies.clearProxy).toHaveBeenCalledWith('cached');
	});
});
