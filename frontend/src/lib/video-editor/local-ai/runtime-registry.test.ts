import { describe, expect, test } from 'vitest';
import { LocalAiRuntimeRegistry } from './runtime-registry';

describe('LocalAiRuntimeRegistry', () => {
	test('inspects loaded state and unloads only resident runtimes', async () => {
		const registry = new LocalAiRuntimeRegistry();
		let loaded = true;
		let unloads = 0;
		registry.register({
			id: 'loaded',
			label: 'Loaded runtime',
			isLoaded: () => loaded,
			unload: () => {
				loaded = false;
				unloads += 1;
			}
		});
		registry.register({
			id: 'idle',
			label: 'Idle runtime',
			isLoaded: () => false,
			unload: () => {
				throw new Error('idle runtime should not unload');
			}
		});

		expect(registry.inspect()).toEqual([
			{ id: 'idle', label: 'Idle runtime', loaded: false },
			{ id: 'loaded', label: 'Loaded runtime', loaded: true }
		]);
		expect(await registry.unload('loaded')).toBe(true);
		expect(await registry.unload('loaded')).toBe(false);
		expect(unloads).toBe(1);
	});

	test('bounds a stuck unload and still releases other runtimes', async () => {
		const registry = new LocalAiRuntimeRegistry(5);
		registry.register({
			id: 'stuck',
			label: 'Stuck runtime',
			isLoaded: () => true,
			unload: () => new Promise<void>(() => undefined)
		});
		registry.register({
			id: 'healthy',
			label: 'Healthy runtime',
			isLoaded: () => true,
			unload: () => undefined
		});

		const result = await registry.unloadAll();
		expect(result.unloadedIds).toEqual(['healthy']);
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0]).toMatchObject({ id: 'stuck' });
	});
});
