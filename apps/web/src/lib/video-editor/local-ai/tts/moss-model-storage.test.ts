import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	MOSS_MODEL_FILE_COUNT,
	MOSS_MODEL_STORE_KEY,
	MOSS_MODEL_STORE_ROOT,
	MOSS_MODEL_TOTAL_BYTES,
	clearMossModelStorage,
	inspectMossModelStorage
} from './moss-model-storage';

const originalStorage = Object.getOwnPropertyDescriptor(navigator, 'storage');

function installStorage() {
	const files = Array.from({ length: MOSS_MODEL_FILE_COUNT }, (_, index) => ({
		kind: 'file' as const,
		name: `${index}.bin`,
		getFile: vi.fn(async () => ({
			size: index === MOSS_MODEL_FILE_COUNT - 1 ? MOSS_MODEL_TOTAL_BYTES - 15 : 1
		}))
	}));
	const modelDirectory = {
		kind: 'directory' as const,
		async *entries() {
			for (const file of files) yield [file.name, file] as const;
		}
	};
	const removeEntry = vi.fn(async () => undefined);
	const storeRoot = {
		getDirectoryHandle: vi.fn(async (name: string) => {
			expect(name).toBe(MOSS_MODEL_STORE_KEY);
			return modelDirectory;
		}),
		removeEntry
	};
	const origin = {
		getDirectoryHandle: vi.fn(async (name: string) => {
			expect(name).toBe(MOSS_MODEL_STORE_ROOT);
			return storeRoot;
		})
	};
	Object.defineProperty(navigator, 'storage', {
		configurable: true,
		value: { getDirectory: vi.fn(async () => origin) }
	});
	return { removeEntry };
}

afterEach(() => {
	if (originalStorage) Object.defineProperty(navigator, 'storage', originalStorage);
	else Reflect.deleteProperty(navigator, 'storage');
});

describe('MOSS model storage', () => {
	it('removes only the revisioned MOSS model directory', async () => {
		const { removeEntry } = installStorage();
		await expect(clearMossModelStorage()).resolves.toBe(true);
		expect(removeEntry).toHaveBeenCalledWith(MOSS_MODEL_STORE_KEY, { recursive: true });
	});
});
