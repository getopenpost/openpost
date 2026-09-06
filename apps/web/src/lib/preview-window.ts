import type { PreviewModel } from '@openpost/social-preview';

export type PreviewChannelMessage =
	| { type: 'ready' }
	| { type: 'snapshot'; model: PreviewModel }
	| { type: 'disconnected' }
	| { type: 'closed' };

export class PreviewWindowSession {
	readonly accountId: string;
	readonly token: string;
	readonly channel: BroadcastChannel;
	private ready = false;
	private latestModel: PreviewModel;
	private closed = false;

	constructor(accountId: string, token: string, model: PreviewModel) {
		this.accountId = accountId;
		this.token = token;
		this.latestModel = model;
		this.channel = new BroadcastChannel(channelName(token));
		this.channel.onmessage = (event: MessageEvent<PreviewChannelMessage>) => {
			if (event.data?.type === 'ready') {
				this.ready = true;
				this.sendSnapshot();
			}
			if (event.data?.type === 'closed') this.close();
		};
	}

	update(model: PreviewModel) {
		if (this.closed) return;
		this.latestModel = model;
		this.sendSnapshot();
	}

	close() {
		if (this.closed) return;
		if (this.ready)
			this.channel.postMessage({ type: 'disconnected' } satisfies PreviewChannelMessage);
		this.closed = true;
		this.channel.close();
	}

	private sendSnapshot() {
		if (!this.ready || this.closed) return;
		this.channel.postMessage({
			type: 'snapshot',
			model: this.latestModel
		} satisfies PreviewChannelMessage);
	}
}

export function openPreviewWindow(
	accountId: string,
	model: PreviewModel
): PreviewWindowSession | null {
	if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
	const token = crypto.randomUUID();
	const session = new PreviewWindowSession(accountId, token, model);
	const url = new URL('/preview', window.location.origin);
	url.searchParams.set('token', token);
	const previewWindow = window.open(url, '_blank');
	if (!previewWindow) {
		session.close();
		return null;
	}
	try {
		previewWindow.opener = null;
	} catch {
		// The preview is same-origin and receives content only through the random channel token.
	}
	return session;
}

export function channelName(token: string): string {
	return `openpost-preview:${token}`;
}
