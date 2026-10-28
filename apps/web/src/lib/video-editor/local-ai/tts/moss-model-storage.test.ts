import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearMossModelStorage, inspectMossModelStorage } from './moss-model-storage';

const originalStorage = Object.getOwnPropertyDescriptor(navigator, 'storage');

function installStorage() {
	const directories = new Set(['openpost-moss-tts-f52645-ceff0d', 'unrelated-model']);
	const removeEntry = vi.fn(async (name: string, options: { recursive: boolean }) => {
		expect(options).toEqual({ recursive: true });
		if (!directories.delete(name)) throw new DOMException('Missing', 'NotFoundError');
	});
	const storeRoot = { removeEntry };
	const origin = {
		getDirectoryHandle: vi.fn(async (name: string) => {
			expect(name).toBe('nano-reader-browser-model-store');
			return storeRoot;
		})
	};
	Object.defineProperty(navigator, 'storage', {
		configurable: true,
		value: { getDirectory: vi.fn(async () => origin) }
	});
	return { removeEntry, directories };
}

afterEach(() => {
	if (originalStorage) Object.defineProperty(navigator, 'storage', originalStorage);
	else Reflect.deleteProperty(navigator, 'storage');
});

describe('MOSS model storage', () => {
	it('removes only the revisioned MOSS model directory', async () => {
		const { removeEntry, directories } = installStorage();
		await expect(clearMossModelStorage()).resolves.toBe(true);
		expect(removeEntry).toHaveBeenCalledWith('openpost-moss-tts-f52645-ceff0d', {
			recursive: true
		});
		expect([...directories]).toEqual(['unrelated-model']);
	});

	it('treats blocked OPFS subdirectory access as not downloaded', async () => {
		const blocked = new DOMException(
			'The request is not allowed by the user agent or the platform in the current context.',
			'NotAllowedError'
		);
		Object.defineProperty(navigator, 'storage', {
			configurable: true,
			value: {
				getDirectory: vi.fn(async () => ({
					getDirectoryHandle: vi.fn(async () => {
						throw blocked;
					})
				}))
			}
		});
		await expect(inspectMossModelStorage()).resolves.toMatchObject({
			supported: true,
			downloaded: false
		});
		await expect(clearMossModelStorage()).resolves.toBe(false);
	});
});
