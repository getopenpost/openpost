import type { PublicationBuildRequest, PublicationPostOption } from './client';

export interface IdeateEntry {
	workspaceId: string;
	contextKey: string;
	buildId?: string;
	input?: PublicationBuildRequest;
	apply?: (option: PublicationPostOption, media: Record<string, string[]>) => Promise<void>;
}

// The shell owns the dialog lifetime. Callers supply context, never generation state.
class Ideate {
	open = $state(false);
	entry = $state.raw<IdeateEntry>();
	sequence = $state(0);
	status = $state<'idle' | 'working' | 'ready'>('idle');
	/** The Ideas page's mount point; the shell's single builder renders there while set. */
	pageTarget = $state<HTMLElement>();
	show(entry?: IdeateEntry) {
		if (entry) this.select(entry);
		this.open = true;
	}
	/** Sets the builder context without opening the dialog (the Ideas page). */
	select(entry: IdeateEntry) {
		if (
			entry.contextKey !== this.entry?.contextKey ||
			entry.workspaceId !== this.entry?.workspaceId
		) {
			this.entry = entry;
			this.sequence++;
		} else {
			this.entry = { ...this.entry, ...entry };
		}
	}
	reset() {
		this.open = false;
		this.entry = undefined;
		this.status = 'idle';
		this.sequence++;
	}
}

export const ideate = new Ideate();
