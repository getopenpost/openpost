import { importGeneratedAudio } from '../media/import.svelte';
import { mediaPool } from '../media/pool.svelte';
import type { MediaMetadata, ProjectAssetImporter } from '../media/types';
import {
	insertGeneratedAudioForText,
	insertGeneratedAudioOnNewTrack
} from './insert-generated-audio';
import type { GeneratedAudio } from './types';

export interface CommitGeneratedAudioOptions {
	projectId: string;
	tags: string[];
	existingMediaId?: string;
	insertAtFrame?: number;
	sourceTextItemId?: string;
	importAsset?: ProjectAssetImporter;
}

interface CommitGeneratedAudioDependencies {
	insertForText: typeof insertGeneratedAudioForText;
	insertOnTrack: typeof insertGeneratedAudioOnNewTrack;
}

const defaultDependencies: CommitGeneratedAudioDependencies = {
	insertForText: insertGeneratedAudioForText,
	insertOnTrack: insertGeneratedAudioOnNewTrack
};

export async function commitGeneratedAudio(
	generated: GeneratedAudio,
	options: CommitGeneratedAudioOptions,
	dependencies: CommitGeneratedAudioDependencies = defaultDependencies
): Promise<{ media: MediaMetadata; itemId?: string }> {
	let media = options.existingMediaId ? mediaPool.get(options.existingMediaId) : undefined;
	if (options.existingMediaId && !media) {
		throw new Error('The saved generated audio is no longer in the media pool.');
	}
	if (!media && options.importAsset) {
		media =
			(await options.importAsset(generated.file, {
				projectId: options.projectId,
				duration: generated.duration,
				tags: options.tags
			})) ?? undefined;
		if (!media) throw new Error('The generated audio import was cancelled.');
	}
	media ??= await importGeneratedAudio(generated.file, {
		projectId: options.projectId,
		duration: generated.duration,
		tags: options.tags
	});
	const itemId = options.sourceTextItemId
		? dependencies.insertForText(media, options.sourceTextItemId)
		: options.insertAtFrame === undefined
			? undefined
			: dependencies.insertOnTrack(media, options.insertAtFrame);
	return { media, itemId };
}
