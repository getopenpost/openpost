import { createPreviewModel } from '@openpost/social-preview';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { channelName, openPreviewWindow } from './preview-window';

class FakeBroadcastChannel {
	static instances: FakeBroadcastChannel[] = [];
	readonly name: string;
	onmessage: ((event: MessageEvent) => void) | null = null;
	messages: unknown[] = [];
	closed = false;

	constructor(name: string) {
		this.name = name;
		FakeBroadcastChannel.instances.push(this);
	}

	postMessage(message: unknown) {
		this.messages.push(message);
	}

	close() {
		this.closed = true;
	}
}

const model = createPreviewModel({
	platform: 'instagram',
	identity: { displayName: 'OpenPost', handle: 'openpost' },
	segments: [{ id: 'primary', text: 'Private preview copy' }]
});

afterEach(() => {
	vi.unstubAllGlobals();
	FakeBroadcastChannel.instances = [];
});

describe('preview window session', () => {
	it('puts only a random channel token in the preview URL', () => {
		const open = vi.fn((_url: URL, _target: string) => ({ opener: {} }));
		vi.stubGlobal('window', {
			location: { origin: 'https://app.openpost.social' },
			open
		});
		vi.stubGlobal('crypto', { randomUUID: () => 'private-token' });
		vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);

		const session = openPreviewWindow('account-1', model);

		expect(session).not.toBeNull();
		expect(open).toHaveBeenCalledOnce();
		const [openedURL, target] = open.mock.calls[0]!;
		expect(target).toBe('_blank');
		expect(openedURL.toString()).toBe('https://app.openpost.social/preview?token=private-token');
		expect(openedURL.toString()).not.toContain('Private+preview+copy');
		expect(channelName('private-token')).toBe('openpost-preview:private-token');
	});

	it('streams snapshots after the preview reports that it is ready', () => {
		vi.stubGlobal('window', {
			location: { origin: 'https://app.openpost.social' },
			open: () => ({ opener: {} })
		});
		vi.stubGlobal('crypto', { randomUUID: () => 'live-token' });
		vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);

		const session = openPreviewWindow('account-1', model);
		const channel = FakeBroadcastChannel.instances[0];
		channel?.onmessage?.({ data: { type: 'ready' } } as MessageEvent);

		expect(channel?.messages).toEqual([{ type: 'snapshot', model }]);

		session?.close();
		expect(channel?.messages.at(-1)).toEqual({ type: 'disconnected' });
		expect(channel?.closed).toBe(true);
	});
});
