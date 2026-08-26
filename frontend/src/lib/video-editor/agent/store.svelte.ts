import { m } from '$lib/paraglide/messages';
import type { LlmMessage } from './llm/types';
import { getAgentAdapter, planRequest, runStep, type PlannedStep } from './service';
import { localAiRuntimeRegistry } from '../local-ai/runtime-registry';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';
export type AgentPhase = 'idle' | 'planning' | 'awaiting-confirm' | 'running';
export type PlanStepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
}

export interface PlanStepState extends PlannedStep {
	status: PlanStepStatus;
	result?: string;
}

const HISTORY_LIMIT = 10;
const MAX_MESSAGES = 40;

function newId(): string {
	return crypto.randomUUID();
}

function buildHistory(messages: ChatMessage[]): LlmMessage[] {
	return messages
		.slice(-HISTORY_LIMIT)
		.map((message) => ({ role: message.role, content: message.content }));
}

function buildCurrentFingerprint(): string {
	const items = timelineStore.items
		.map(
			(item) =>
				`${item.id}:${item.from}:${item.trackId}:${item.durationInFrames}:${item.sourceStart ?? ''}:${item.sourceEnd ?? ''}:${item.speed ?? 1}:${item.volume ?? 1}`
		)
		.join('|');
	const tracks = timelineStore.tracks
		.map((track) => `${track.id}:${track.locked ? '1' : '0'}`)
		.join('|');
	return `${items}||${tracks}`;
}

function checkPlanStale(plan: PlanStepState[]): string | null {
	for (const step of plan) {
		if (step.boundIds && step.boundIds.length > 0) {
			for (const id of step.boundIds) {
				if (!timelineStore.itemById.has(id)) {
					return m.video_editor_agent_stale_plan();
				}
			}
		}
		if (step.args) {
			const clips = (step.args as Record<string, unknown>).clips as string[] | undefined;
			const clip = (step.args as Record<string, unknown>).clip as string | undefined;
			const refs: string[] = [];
			if (Array.isArray(clips)) refs.push(...clips);
			if (typeof clip === 'string') refs.push(clip);
			for (const ref of refs) {
				if (typeof ref === 'string' && ref.startsWith('c')) {
					if (step.boundIds && step.boundIds.length > 0) {
						const current = timelineStore.items
							.slice()
							.sort((a, b) => a.from - b.from || a.trackId.localeCompare(b.trackId))
							.slice(0, 40)
							.map((item, idx) => ({ ref: `c${idx + 1}`, id: item.id }));
						const currentMap = new Map(current.map((entry) => [entry.ref, entry.id]));
						const expected = currentMap.get(ref);
						if (expected && !step.boundIds.includes(expected)) {
							return m.video_editor_agent_stale_plan();
						}
					}
				}
			}
		}
	}
	return null;
}

class AgentStore {
	supported = $state(getAgentAdapter().isSupported());
	modelStatus = $state<ModelStatus>('idle');
	loadPercent = $state(0);
	loadError = $state<string | null>(null);
	messages = $state<ChatMessage[]>([]);
	phase = $state<AgentPhase>('idle');
	streamingText = $state('');
	plan = $state<PlanStepState[] | null>(null);
	private activeController: AbortController | null = null;
	private selectedIdsProvider: (() => string[]) | null = null;
	private autosave?: () => void;
	private currentProjectId: string | null = null;
	private loadGeneration = 0;
	private submitGeneration = 0;
	private planFingerprint: string | null = null;

	constructor() {
		localAiRuntimeRegistry.register({
			id: 'agent-gemma',
			label: 'Assistant model',
			isLoaded: () => this.modelStatus === 'ready' || this.modelStatus === 'loading',
			unload: () => this.unload()
		});
	}

	setSelectionProvider(provider: (() => string[]) | null): void {
		this.selectedIdsProvider = provider;
	}

	setAutosave(handler: (() => void) | undefined): void {
		this.autosave = handler;
	}

	setProjectId(projectId: string | null): void {
		if (projectId === this.currentProjectId) return;
		if (this.currentProjectId !== null && projectId !== this.currentProjectId) {
			this.submitGeneration++;
			this.cancel();
			this.messages = [];
			this.plan = null;
			this.planFingerprint = null;
			this.streamingText = '';
		}
		this.currentProjectId = projectId;
	}

	async loadModel(): Promise<void> {
		const adapter = getAgentAdapter();
		if (!adapter.isSupported()) {
			this.modelStatus = 'error';
			this.loadError = m.video_editor_agent_model_load_error();
			throw new Error('WebGPU unsupported');
		}
		if (this.modelStatus === 'ready') return;
		this.modelStatus = 'loading';
		this.loadError = null;
		const generation = ++this.loadGeneration;
		try {
			await adapter.load((progress) => {
				if (generation !== this.loadGeneration) return;
				this.loadPercent = progress.percent;
			});
			if (generation !== this.loadGeneration) return;
			this.modelStatus = 'ready';
			this.loadPercent = 100;
			this.loadError = null;
		} catch (error) {
			if (generation !== this.loadGeneration) return;
			if (error instanceof DOMException && error.name === 'AbortError') throw error;
			this.modelStatus = 'error';
			this.loadError = error instanceof Error ? error.message : 'Failed to load the model.';
			throw error;
		}
	}

	async submit(
		text: string,
		options?: { projectId?: string | null; storageSufficient?: boolean }
	): Promise<void> {
		const trimmed = text.trim();
		if (!trimmed || this.phase !== 'idle') return;
		if (options?.storageSufficient === false) {
			this.messages = [
				...this.messages,
				{
					id: newId(),
					role: 'assistant',
					content: m.video_editor_agent_composer_disabled_storage()
				}
			].slice(-MAX_MESSAGES);
			return;
		}
		if (options?.projectId !== undefined) this.setProjectId(options.projectId);
		const generation = ++this.submitGeneration;
		const controller = new AbortController();
		this.activeController = controller;
		const history = buildHistory(this.messages);
		const userMessage: ChatMessage = { id: newId(), role: 'user', content: trimmed };
		this.messages = [...this.messages, userMessage].slice(-MAX_MESSAGES);
		this.phase = 'planning';
		this.streamingText = '';
		this.plan = null;
		this.planFingerprint = null;
		try {
			await this.loadModel();
			if (generation !== this.submitGeneration || controller.signal.aborted) {
				this.phase = 'idle';
				return;
			}
		} catch (error) {
			if (generation !== this.submitGeneration) {
				this.phase = 'idle';
				return;
			}
			if (error instanceof DOMException && error.name === 'AbortError') {
				this.phase = 'idle';
				return;
			}
			this.phase = 'idle';
			return;
		}
		try {
			const result = await planRequest(trimmed, {
				history,
				signal: controller.signal,
				onToken: (_delta, full) => {
					if (generation !== this.submitGeneration || controller.signal.aborted) return;
					this.streamingText = full;
				},
				selectedIds: this.selectedIdsProvider?.() ?? []
			});
			if (generation !== this.submitGeneration || controller.signal.aborted) {
				this.phase = 'idle';
				this.streamingText = '';
				return;
			}
			const assistantMessage: ChatMessage = {
				id: newId(),
				role: 'assistant',
				content: result.reply || m.video_editor_agent_fallback_reply()
			};
			const hasSteps = result.steps.length > 0;
			this.messages = [...this.messages, assistantMessage].slice(-MAX_MESSAGES);
			this.streamingText = '';
			this.phase = hasSteps ? 'awaiting-confirm' : 'idle';
			if (hasSteps) {
				this.plan = result.steps.map((step) => ({ ...step, status: 'pending' as const }));
				this.planFingerprint = result.fingerprint ?? buildCurrentFingerprint();
			} else {
				this.plan = null;
				this.planFingerprint = null;
			}
		} catch (error) {
			if (generation !== this.submitGeneration || controller.signal.aborted) {
				this.phase = 'idle';
				this.streamingText = '';
				return;
			}
			if (controller.signal.aborted) {
				this.phase = 'idle';
				this.streamingText = '';
			} else {
				const message = error instanceof Error ? error.message : 'Something went wrong.';
				this.messages = [
					...this.messages,
					{
						id: newId(),
						role: 'assistant',
						content: m.video_editor_agent_error_prefix({ message })
					}
				].slice(-MAX_MESSAGES);
				this.phase = 'idle';
				this.streamingText = '';
			}
		} finally {
			if (this.activeController === controller) this.activeController = null;
		}
	}

	async runPlan(options?: { projectId?: string | null }): Promise<void> {
		const plan = this.plan;
		if (!plan || this.phase !== 'awaiting-confirm') return;
		if (options?.projectId !== undefined && this.currentProjectId !== options.projectId) {
			this.plan = null;
			this.planFingerprint = null;
			this.phase = 'idle';
			this.messages = [
				...this.messages,
				{ id: newId(), role: 'assistant', content: m.video_editor_agent_project_mismatch() }
			].slice(-MAX_MESSAGES);
			return;
		}
		if (this.planFingerprint) {
			const current = buildCurrentFingerprint();
			if (current !== this.planFingerprint) {
				this.plan = null;
				this.planFingerprint = null;
				this.phase = 'idle';
				this.messages = [
					...this.messages,
					{ id: newId(), role: 'assistant', content: m.video_editor_agent_stale_plan() }
				].slice(-MAX_MESSAGES);
				return;
			}
		}
		const stale = checkPlanStale(plan);
		if (stale) {
			this.plan = null;
			this.planFingerprint = null;
			this.phase = 'idle';
			this.messages = [...this.messages, { id: newId(), role: 'assistant', content: stale }].slice(
				-MAX_MESSAGES
			);
			return;
		}
		this.phase = 'running';
		const results: string[] = [];
		let failed = false;
		let anySucceeded = false;
		let handoffEncountered = false;
		for (let index = 0; index < plan.length; index++) {
			if (failed || handoffEncountered) {
				this.plan =
					this.plan?.map((item, i) =>
						i === index
							? { ...item, status: 'skipped' as const, result: m.video_editor_agent_skipped() }
							: item
					) ?? null;
				results.push(`- Skipped: ${plan[index]?.summary ?? 'step'}`);
				continue;
			}
			this.plan =
				this.plan?.map((step, i) =>
					i === index ? { ...step, status: 'running' as const } : step
				) ?? null;
			const step = plan[index];
			if (!step) continue;
			const result = await runStep(step);
			results.push(`${result.ok ? '✓' : '✕'} ${result.message}`);
			this.plan =
				this.plan?.map((item, i) =>
					i === index
						? {
								...item,
								status: result.ok ? ('done' as const) : ('error' as const),
								result: result.message
							}
						: item
				) ?? null;
			if (result.ok) anySucceeded = true;
			if (!result.ok) failed = true;
			if (step.handoff && result.ok) handoffEncountered = true;
		}
		this.messages = [
			...this.messages,
			{ id: newId(), role: 'assistant', content: results.join('\n') }
		].slice(-MAX_MESSAGES);
		this.phase = 'idle';
		this.planFingerprint = null;
		if (anySucceeded) this.autosave?.();
	}

	dismissPlan(): void {
		if (this.phase === 'running') return;
		this.plan = null;
		this.planFingerprint = null;
		this.phase = 'idle';
	}

	cancel(): void {
		this.submitGeneration++;
		this.activeController?.abort();
		this.activeController = null;
		this.phase = 'idle';
		this.streamingText = '';
	}

	clearChat(): void {
		this.submitGeneration++;
		this.activeController?.abort();
		this.activeController = null;
		this.messages = [];
		this.plan = null;
		this.planFingerprint = null;
		this.phase = 'idle';
		this.streamingText = '';
	}

	unload(): void {
		this.submitGeneration++;
		this.loadGeneration++;
		this.cancel();
		getAgentAdapter().dispose();
		this.modelStatus = 'idle';
		this.loadPercent = 0;
		this.loadError = null;
		this.planFingerprint = null;
	}

	__resetForTesting(): void {
		this.submitGeneration++;
		this.loadGeneration++;
		this.cancel();
		this.messages = [];
		this.plan = null;
		this.planFingerprint = null;
		this.phase = 'idle';
		this.streamingText = '';
		this.modelStatus = 'idle';
		this.loadPercent = 0;
		this.loadError = null;
		this.currentProjectId = null;
		this.supported = getAgentAdapter().isSupported();
	}
}

export const agentStore = new AgentStore();
