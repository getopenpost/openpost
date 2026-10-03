import { z } from 'zod';
import { m } from '$lib/paraglide/messages';
import {
	captureQueryMutationSession,
	queryMutationSessionIsCurrent
} from '$lib/query/authorization-boundary';
import {
	requestRepurposeSuggestions,
	readRepurposeSuggestions,
	changeRepurposeSuggestions,
	type RepurposeSuggestions,
	type RepurposeRequest,
	type RepurposeCandidate
} from '$lib/query/repurpose';
import {
	repurposeSourceKey,
	repurposeSourceSnapshot,
	validateRepurposeCandidates
} from './repurpose-source';
import {
	createRepurposeProjects,
	type RepurposeProjectResult,
	type RepurposeCreationProgress
} from './repurpose-projects';
import type { QuickCutSource } from './types';

export interface RepurposeReviewContext {
	actorId: string;
	workspaceId: string;
	projectId: string;
	source: QuickCutSource;
	storage: 'cloud' | 'local';
}
export interface ReviewedClip extends RepurposeCandidate {
	selected: boolean;
}

const receiptSchema = z.object({
	id: z.string().min(1).max(128),
	revision: z.string().min(1).max(128),
	choices: z
		.array(
			z.object({
				id: z.string().min(1).max(128),
				first_word: z.number().int().nonnegative(),
				last_word: z.number().int().nonnegative(),
				selected: z.boolean()
			})
		)
		.max(3)
		.default([]),
	created: z
		.array(
			z.object({
				candidateId: z.string().min(1).max(128),
				projectId: z.string().uuid(),
				name: z.string().max(100),
				storage: z.enum(['cloud', 'local'])
			})
		)
		.max(3)
		.default([])
});

export function createRepurposeReview(getContext: () => RepurposeReviewContext) {
	let result = $state<RepurposeSuggestions | null>(null);
	let candidates = $state<ReviewedClip[]>([]);
	let snapshot = $state<RepurposeRequest['source'] | null>(null);
	let busy = $state(false);
	let creating = $state(false);
	let creationProgress = $state<RepurposeCreationProgress | null>(null);
	let error = $state('');
	let warning = $state('');
	let stale = $state(false);
	let created = $state<RepurposeProjectResult[]>([]);
	let request: AbortController | null = null;
	let lifetime = 0;
	let operationVersion = 0;
	let restoredChoices: z.infer<typeof receiptSchema>['choices'] = [];
	const contextKey = (context: RepurposeReviewContext) =>
		JSON.stringify([
			context.actorId,
			context.workspaceId,
			context.projectId,
			context.source.id,
			context.storage
		]);
	const storageKey = (context: RepurposeReviewContext) =>
		`openpost:repurpose:${contextKey(context)}`;
	function remember(context: RepurposeReviewContext, value: RepurposeSuggestions) {
		try {
			localStorage.setItem(
				storageKey(context),
				JSON.stringify({
					id: value.id,
					revision: value.source_revision,
					created,
					choices: candidates.map(({ id, first_word, last_word, selected }) => ({
						id,
						first_word,
						last_word,
						selected
					}))
				})
			);
		} catch {
			/* Review still works when storage is unavailable. */
		}
	}
	function clearRemembered(context: RepurposeReviewContext) {
		try {
			localStorage.removeItem(storageKey(context));
		} catch {
			/* Optional recovery storage. */
		}
	}
	function capture() {
		const context = getContext();
		const key = contextKey(context);
		const sourceKey = repurposeSourceKey(context.source);
		const session = captureQueryMutationSession();
		const generation = lifetime;
		return {
			context,
			session,
			current: () =>
				generation === lifetime &&
				queryMutationSessionIsCurrent(session) &&
				contextKey(getContext()) === key &&
				repurposeSourceKey(getContext().source) === sourceKey
		};
	}
	function accept(value: RepurposeSuggestions, source: RepurposeRequest['source']) {
		if (
			value.workspace_id !== getContext().workspaceId ||
			value.source_id !== source.id ||
			value.source_revision !== source.revision ||
			!validateRepurposeCandidates(value.candidates ?? [], source)
		) {
			throw new Error(m.repurpose_invalid_result());
		}
		result = value;
		if (value.state === 'ready') {
			const words = source.words ?? [];
			candidates = (value.candidates ?? []).map((candidate) => {
				const saved = restoredChoices.find((choice) => choice.id === candidate.id);
				if (
					!saved ||
					saved.first_word > saved.last_word ||
					!words[saved.first_word] ||
					!words[saved.last_word]
				)
					return { ...candidate, selected: true };
				return {
					...candidate,
					...saved,
					start: words[saved.first_word]!.start,
					end: words[saved.last_word]!.end
				};
			});
			restoredChoices = [];
		}
		if (value.state === 'failed') error = value.error_message || m.repurpose_failed();
	}
	async function poll(
		value: RepurposeSuggestions,
		source: RepurposeRequest['source'],
		captured: ReturnType<typeof capture>,
		controller: AbortController
	) {
		while (captured.current() && !controller.signal.aborted) {
			accept(value, source);
			remember(captured.context, value);
			if (value.state !== 'queued' && value.state !== 'analyzing') return;
			await new Promise<void>((resolve, reject) => {
				const done = () => {
					clearTimeout(timer);
					controller.signal.removeEventListener('abort', abort);
					resolve();
				};
				const abort = () => {
					clearTimeout(timer);
					reject(controller.signal.reason);
				};
				const timer = setTimeout(done, 1200);
				controller.signal.addEventListener('abort', abort, { once: true });
			});
			value = await readRepurposeSuggestions(
				captured.context.workspaceId,
				captured.context.actorId,
				value.id,
				controller.signal
			);
		}
	}
	async function run(
		operation: (
			source: RepurposeRequest['source'],
			captured: ReturnType<typeof capture>,
			controller: AbortController
		) => Promise<RepurposeSuggestions | null>
	) {
		operationVersion++;
		request?.abort();
		const controller = new AbortController();
		request = controller;
		const captured = capture();
		busy = true;
		error = '';
		stale = false;
		try {
			const source = await repurposeSourceSnapshot(captured.context.source);
			if (!captured.current() || controller.signal.aborted) return;
			snapshot = source;
			const value = await operation(source, captured, controller);
			if (!value) return;
			if (!captured.current() || controller.signal.aborted) {
				// A POST may have been accepted before cancellation. Settle its receipt only under the same actor.
				if (
					queryMutationSessionIsCurrent(captured.session) &&
					(value.state === 'queued' || value.state === 'analyzing')
				)
					await changeRepurposeSuggestions(
						captured.context.workspaceId,
						captured.context.actorId,
						value,
						'cancel'
					).catch(() => {});
				return;
			}
			await poll(value, source, captured, controller);
		} catch (cause) {
			if (captured.current() && !controller.signal.aborted)
				error = cause instanceof Error ? cause.message : m.repurpose_failed();
		} finally {
			if (request === controller) {
				busy = false;
				request = null;
			}
		}
	}
	async function restore() {
		await run(async (source, captured, controller) => {
			let saved: z.infer<typeof receiptSchema> | null = null;
			try {
				const parsed = receiptSchema.safeParse(
					JSON.parse(localStorage.getItem(storageKey(captured.context)) || 'null')
				);
				if (parsed.success) saved = parsed.data;
			} catch {
				clearRemembered(captured.context);
			}
			if (!saved) return null;
			if (saved.revision !== source.revision) {
				stale = true;
				clearRemembered(captured.context);
				return null;
			}
			created = saved.created;
			restoredChoices = saved.choices;
			return readRepurposeSuggestions(
				captured.context.workspaceId,
				captured.context.actorId,
				saved.id,
				controller.signal
			);
		});
	}
	async function find(topic: string) {
		if (busy || creating) return;
		candidates = [];
		restoredChoices = [];
		created = [];
		warning = '';
		result = null;
		await run((source, captured) => {
			const input: RepurposeRequest = { workspace_id: captured.context.workspaceId, source };
			if (topic.trim()) input.topic = topic.trim();
			return requestRepurposeSuggestions(input, captured.context.actorId, crypto.randomUUID());
		});
	}
	async function cancel() {
		const operation = ++operationVersion;
		const captured = capture();
		const value = result;
		request?.abort();
		request = null;
		busy = false;
		if (!value || !captured.current() || (value.state !== 'queued' && value.state !== 'analyzing'))
			return;
		try {
			let cancelled: RepurposeSuggestions;
			try {
				cancelled = await changeRepurposeSuggestions(
					captured.context.workspaceId,
					captured.context.actorId,
					value,
					'cancel'
				);
			} catch {
				if (!captured.current()) return;
				const latest = await readRepurposeSuggestions(
					captured.context.workspaceId,
					captured.context.actorId,
					value.id,
					new AbortController().signal
				);
				if (!captured.current()) return;
				cancelled =
					latest.state === 'queued' || latest.state === 'analyzing'
						? await changeRepurposeSuggestions(
								captured.context.workspaceId,
								captured.context.actorId,
								latest,
								'cancel'
							)
						: latest;
			}
			if (captured.current() && operation === operationVersion && snapshot) {
				accept(cancelled, snapshot);
				remember(captured.context, cancelled);
			}
		} catch (cause) {
			if (captured.current() && operation === operationVersion)
				error = cause instanceof Error ? cause.message : m.repurpose_failed();
		}
	}
	async function retry() {
		const value = result;
		if (!value || busy || creating) return;
		await run((_, captured) =>
			changeRepurposeSuggestions(
				captured.context.workspaceId,
				captured.context.actorId,
				value,
				'retry'
			)
		);
	}
	function adjust(id: string, bound: 'first_word' | 'last_word', index: number) {
		if (creating || !snapshot) return;
		const words = snapshot.words ?? [];
		candidates = candidates.map((candidate) => {
			if (candidate.id !== id || created.some((item) => item.candidateId === id)) return candidate;
			const next = { ...candidate, [bound]: index };
			if (
				!Number.isInteger(index) ||
				next.first_word < 0 ||
				next.last_word < next.first_word ||
				next.last_word >= words.length
			)
				return candidate;
			return {
				...next,
				start: words[next.first_word]!.start,
				end: words[next.last_word]!.end
			};
		});
		if (result) remember(getContext(), result);
	}
	function adjustTime(id: string, bound: 'first_word' | 'last_word', time: number) {
		const candidate = candidates.find((item) => item.id === id);
		const words = snapshot?.words ?? [];
		if (!candidate || !Number.isFinite(time) || !words.length) return;
		const first = bound === 'first_word' ? 0 : candidate.first_word;
		const last = bound === 'last_word' ? words.length - 1 : candidate.last_word;
		let closest = first;
		for (let index = first + 1; index <= last; index++) {
			const value = bound === 'first_word' ? words[index]!.start : words[index]!.end;
			const previous = bound === 'first_word' ? words[closest]!.start : words[closest]!.end;
			if (Math.abs(value - time) < Math.abs(previous - time)) closest = index;
		}
		adjust(id, bound, closest);
	}

	function select(id: string, selected: boolean) {
		if (!creating)
			candidates = candidates.map((candidate) =>
				candidate.id === id ? { ...candidate, selected } : candidate
			);
		if (result) remember(getContext(), result);
	}
	async function createSelected() {
		if (busy || creating || !snapshot) return;
		const captured = capture();
		const controller = new AbortController();
		request = controller;
		creating = true;
		creationProgress = null;
		error = '';
		try {
			const source = await repurposeSourceSnapshot(captured.context.source);
			if (!captured.current() || source.revision !== snapshot.revision) {
				stale = true;
				return;
			}
			const choices = candidates.filter(
				(candidate) =>
					candidate.selected && !created.some((item) => item.candidateId === candidate.id)
			);
			await createRepurposeProjects({
				source: captured.context.source,
				choices,
				storage: captured.context.storage,
				workspaceId: captured.context.workspaceId,
				signal: controller.signal,
				isCurrent: captured.current,
				onProgress: (progress) => {
					if (captured.current()) creationProgress = progress;
				},
				onWarning: (message) => {
					if (captured.current()) warning = message;
				},
				onCreated: (item) => {
					created = [...created, item];
					if (result) remember(captured.context, result);
				}
			});
		} catch (cause) {
			if (captured.current() && !controller.signal.aborted)
				error = cause instanceof Error ? cause.message : m.repurpose_failed();
		} finally {
			if (request === controller) request = null;
			creating = false;
		}
	}
	function dispose() {
		lifetime++;
		request?.abort();
		request = null;
	}
	return {
		get result() {
			return result;
		},
		get candidates() {
			return candidates;
		},
		get snapshot() {
			return snapshot;
		},
		get busy() {
			return busy;
		},
		get creating() {
			return creating;
		},
		get creationProgress() {
			return creationProgress;
		},
		get warning() {
			return warning;
		},
		get error() {
			return error;
		},
		get stale() {
			return stale;
		},
		get created() {
			return created;
		},
		restore,
		find,
		cancel,
		retry,
		adjustTime,
		select,
		createSelected,
		dispose
	};
}
