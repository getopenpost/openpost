import {
	ALL_FORMATS,
	BlobSource,
	BufferTarget,
	Conversion,
	Input,
	Mp4OutputFormat,
	Output,
	QUALITY_HIGH,
	type ConversionVideoOptions
} from 'mediabunny';
import { firstPlatformVideoCodec } from './support';
import type { VideoEditRecipe } from './types';
import { VideoPreparationError } from './types';

export async function renderVideoEdit(
	source: File,
	recipe: VideoEditRecipe,
	onProgress: (fraction: number) => void,
	signal?: AbortSignal
): Promise<File> {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(source) });
	try {
		const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
		const video: ConversionVideoOptions = {};
		if (recipe.crop) {
			const width = even(recipe.crop.width);
			const height = even(recipe.crop.height);
			const codec = await firstPlatformVideoCodec(width, height);
			if (!codec) {
				throw new VideoPreparationError(
					'encoder-unavailable',
					'Cropping is not available in this browser because it cannot encode H.264 video.'
				);
			}
			video.codec = codec;
			video.bitrate = QUALITY_HIGH;
			video.crop = {
				left: Math.round(recipe.crop.x),
				top: Math.round(recipe.crop.y),
				width,
				height
			};
		}
		const conversion = await Conversion.init({
			input,
			output,
			trim: {
				start: recipe.trim.startSeconds,
				end: recipe.trim.endSeconds
			},
			video
		});
		if (!conversion.isValid) {
			throw new VideoPreparationError(
				'invalid-edit',
				'This video cannot be edited in this browser.'
			);
		}
		conversion.onProgress = onProgress;
		const abort = () => void conversion.cancel();
		signal?.addEventListener('abort', abort, { once: true });
		try {
			await conversion.execute();
		} finally {
			signal?.removeEventListener('abort', abort);
		}
		if (!output.target.buffer) {
			throw new VideoPreparationError('invalid-edit', 'The video editor produced no output.');
		}
		const base = source.name.replace(/\.[^./\\]+$/, '');
		return new File([output.target.buffer], `${base}-edited.mp4`, {
			type: 'video/mp4',
			lastModified: Date.now()
		});
	} finally {
		if (!input.disposed) input.dispose();
	}
}

function even(value: number): number {
	return Math.max(2, Math.floor(value / 2) * 2);
}
