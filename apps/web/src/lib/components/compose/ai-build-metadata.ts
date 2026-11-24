import { z } from 'zod';

// Persisted shape of the AI build applied to a publication, stored in its metadata.
export const AI_BUILD_METADATA_KEY = 'ai_publication_build';

const aiPlatformStrategySchema = z.object({
	account_id: z.string().min(1),
	platform: z.string().min(1),
	objective: z.string(),
	archetype: z.string(),
	media: z.object({
		treatment: z.string(),
		role: z.string(),
		brief: z.string(),
		source_ref: z.string().optional(),
		template_id: z.string().optional(),
		alt_text: z.string().optional()
	}),
	warnings: z.array(z.string()).optional()
});

export const attachmentRequirementSchema = z.object({
	kind: z.enum(['image', 'video']),
	brief: z.string(),
	document: z.json().optional()
});

export type AttachmentRequirement = z.infer<typeof attachmentRequirementSchema>;

export const aiBuildMetadataSchema = z.object({
	version: z.literal(1),
	strategies: z.array(aiPlatformStrategySchema)
});

export type AIPlatformStrategy = z.infer<typeof aiPlatformStrategySchema>;
