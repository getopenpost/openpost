import { z } from 'zod';

/** Browser probe details which the server cannot derive for every editor asset. */
export const editorAssetMetadataSchema = z.object({
	version: z.literal(1),
	duration: z.number().finite().nonnegative(),
	width: z.number().finite().nonnegative(),
	height: z.number().finite().nonnegative(),
	fps: z.number().finite().nonnegative(),
	codec: z.string(),
	audioCodec: z.string().optional(),
	hasAudio: z.boolean().optional(),
	tags: z.array(z.string()),
	lottieTotalFrames: z.number().finite().positive().optional(),
	lottieMarkers: z
		.array(
			z.object({
				name: z.string(),
				start: z.number().finite(),
				duration: z.number().finite().nonnegative()
			})
		)
		.optional(),
	animationFrameCount: z.number().int().nonnegative().optional(),
	attribution: z
		.object({
			provider: z.string(),
			author: z.string().optional(),
			authorUrl: z.string().optional(),
			sourceId: z.string().optional(),
			license: z.string(),
			licenseUrl: z.string().optional()
		})
		.optional()
});
export type EditorAssetMetadata = Omit<z.infer<typeof editorAssetMetadataSchema>, 'version'>;
