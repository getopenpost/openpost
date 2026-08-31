import { importGeneratedAudio } from '../media/import.svelte';
import { mediaPool } from '../media/pool.svelte';
import type { MediaMetadata } from '../media/types';
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
}

export async function commitGeneratedAudio(
	generated: GeneratedAudio,
	options: CommitGeneratedAudioOptions
): Promise<{ media: MediaMetadata; itemId?: string }> {
	let media = options.existingMediaId ? mediaPool.get(options.existingMediaId) : undefined;
	if (options.existingMediaId && !media) {
		throw new Error('The saved generated audio is no longer in the media pool.');
	}
	media ??= await importGeneratedAudio(generated.file, {
		projectId: options.projectId,
		duration: generated.duration,
		tags: options.tags
	});
	const itemId = options.sourceTextItemId
		? insertGeneratedAudioForText(media, options.sourceTextItemId)
		: options.insertAtFrame === undefined
			? undefined
			: insertGeneratedAudioOnNewTrack(media, options.insertAtFrame);
	return { media, itemId };
}
