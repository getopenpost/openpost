import { type DateValue } from '@internationalized/date';
import { SvelteSet } from 'svelte/reactivity';
import {
	PublicationInvalidationCoalescer,
	type PublicationInvalidationBatch,
	type PublicationInvalidationRequest
} from '$lib/publication-invalidation';

const publicationRefreshDebounceMS = 2_500;

export interface PendingPrompt {
	text: string;
	example: string;
}

export class UIState {
	isComposeOpen = $state(false);
	composeInitialDate = $state<DateValue | undefined>(undefined);
	isDayPostsOpen = $state(false);
	dayPostsDate = $state<DateValue | undefined>(undefined);
	refreshCounter = $state(0);
	publicationInvalidations = $state.raw<PublicationInvalidationBatch>({ revision: 0, entries: [] });
	composerResetCounter = $state(0);
	activeComposerDraftId = $state<string | null>(null);
	pendingPrompt = $state<PendingPrompt | null>(null);
	isFeedbackOpen = $state(false);
	#publicationInvalidationCoalescer = new PublicationInvalidationCoalescer();
	#publicationRefreshTimer: ReturnType<typeof setTimeout> | null = null;
	#composerResetGuards = new SvelteSet<() => boolean>();

	openCompose(date?: DateValue) {
		this.composeInitialDate = date;
		this.isComposeOpen = true;
	}

	closeCompose() {
		this.isComposeOpen = false;
	}

	openDayPosts(date: DateValue) {
		this.dayPostsDate = date;
		this.isDayPostsOpen = true;
	}

	closeDayPosts() {
		this.isDayPostsOpen = false;
	}

	openComposeForDay(date: DateValue) {
		this.isDayPostsOpen = false;
		this.composeInitialDate = date;
		this.isComposeOpen = true;
	}

	setPrompt(prompt: { text: string; example?: string }) {
		this.pendingPrompt = { text: prompt.text, example: prompt.example ?? '' };
	}

	clearPrompt() {
		this.pendingPrompt = null;
	}

	setActiveComposerDraft(id: string) {
		this.activeComposerDraftId = id;
	}

	clearActiveComposerDraft() {
		this.activeComposerDraftId = null;
	}

	registerComposerResetGuard(guard: () => boolean): () => void {
		this.#composerResetGuards.add(guard);
		return () => this.#composerResetGuards.delete(guard);
	}

	startNewPost(): boolean {
		for (const guard of this.#composerResetGuards) {
			if (!guard()) return false;
		}
		this.activeComposerDraftId = null;
		this.composerResetCounter++;
		return true;
	}

	invalidatePublications(
		request: PublicationInvalidationRequest = {},
		options: { immediate?: boolean } = {}
	) {
		this.#publicationInvalidationCoalescer.add(request);
		if (this.#publicationRefreshTimer) clearTimeout(this.#publicationRefreshTimer);
		this.#publicationRefreshTimer = null;
		if (options.immediate) {
			this.flushPublicationInvalidations();
			return;
		}
		this.#publicationRefreshTimer = setTimeout(
			() => this.flushPublicationInvalidations(),
			publicationRefreshDebounceMS
		);
	}

	flushPublicationInvalidations() {
		if (this.#publicationRefreshTimer) clearTimeout(this.#publicationRefreshTimer);
		this.#publicationRefreshTimer = null;
		const nextRevision = this.publicationInvalidations.revision + 1;
		const batch = this.#publicationInvalidationCoalescer.drain(nextRevision);
		if (batch) this.publicationInvalidations = batch;
	}

	triggerRefresh(request: PublicationInvalidationRequest = {}) {
		this.refreshCounter++;
		this.invalidatePublications(request, { immediate: true });
	}

	openFeedback() {
		this.isFeedbackOpen = true;
	}

	closeFeedback() {
		this.isFeedbackOpen = false;
	}
}

export const ui = new UIState();
