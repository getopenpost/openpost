import { z } from 'zod';
import type { JsonValue } from '../types';

const idSchema = z.number().int().positive().finite();
const messageSchema = z.object({
	role: z.enum(['system', 'user', 'assistant']),
	content: z.string().max(8000)
});

const workerRequestSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('load') }),
	z.object({
		type: z.literal('generate'),
		id: idSchema,
		messages: z.array(messageSchema).min(1).max(32),
		maxTokens: z.number().int().min(1).max(2048).finite(),
		temperature: z.number().min(0).max(2).finite(),
		topP: z.number().min(0).max(1).finite()
	}),
	z.object({ type: z.literal('cancel'), id: idSchema }),
	z.object({ type: z.literal('dispose') })
]);

const workerResponseSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('progress'),
		stage: z.string(),
		percent: z.number().min(0).max(100).finite()
	}),
	z.object({ type: z.literal('ready') }),
	z.object({ type: z.literal('token'), id: idSchema, delta: z.string() }),
	z.object({ type: z.literal('result'), id: idSchema, text: z.string() }),
	z.object({ type: z.literal('error'), id: idSchema.optional(), message: z.string() }),
	z.object({ type: z.literal('disposed') })
]);

export type LlmWorkerRequest = z.infer<typeof workerRequestSchema>;
export type LlmWorkerResponse = z.infer<typeof workerResponseSchema>;

export function parseLlmWorkerRequest(value: JsonValue): LlmWorkerRequest | null {
	const result = workerRequestSchema.safeParse(value);
	return result.success ? result.data : null;
}

export function parseLlmWorkerResponse(value: JsonValue): LlmWorkerResponse | null {
	const result = workerResponseSchema.safeParse(value);
	return result.success ? result.data : null;
}
