import { type DateValue } from '@internationalized/date';

class UIState {
	isComposeOpen = $state(false);
	composeInitialDate = $state<DateValue | undefined>(undefined);
	isDayPostsOpen = $state(false);
	dayPostsDate = $state<DateValue | undefined>(undefined);
	refreshCounter = $state(0);
	composerResetCounter = $state(0);
	activeComposerDraftId = $state<string | null>(null);
	promptText = $state<string | null>(null);
	isFeedbackOpen = $state(false);

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

	setPrompt(text: string) {
		this.promptText = text;
	}

	clearPrompt() {
		this.promptText = null;
	}

	setActiveComposerDraft(id: string) {
		this.activeComposerDraftId = id;
	}

	clearActiveComposerDraft() {
		this.activeComposerDraftId = null;
	}

	startNewPost() {
		this.activeComposerDraftId = null;
		this.composerResetCounter++;
	}

	triggerRefresh() {
		this.refreshCounter++;
	}

	openFeedback() {
		this.isFeedbackOpen = true;
	}

	closeFeedback() {
		this.isFeedbackOpen = false;
	}
}

export const ui = new UIState();
