import type { BaseTrackMetadata, Input, InputTrack, Output } from 'mediabunny';

const ISO_639_2_LANGUAGE_CODE = /^[a-z]{3}$/;

export async function copyContainerMetadata(input: Input, output: Output): Promise<void> {
	const [tags, inputFormat] = await Promise.all([input.getMetadataTags(), input.getFormat()]);
	const outputTags = { ...tags };
	if (inputFormat.mimeType !== output.format.mimeType) delete outputTags.raw;
	output.setMetadataTags(outputTags);
}

export async function readTrackMetadata(track: InputTrack): Promise<BaseTrackMetadata> {
	const [languageCode, name, disposition] = await Promise.all([
		track.getLanguageCode(),
		track.getName(),
		track.getDisposition()
	]);
	return {
		languageCode: ISO_639_2_LANGUAGE_CODE.test(languageCode) ? languageCode : undefined,
		name: name ?? undefined,
		disposition
	};
}
