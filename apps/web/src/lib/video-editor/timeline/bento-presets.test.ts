import { describe, expect, it } from 'vitest';
import {
	BENTO_PRESETS_STORAGE_KEY,
	loadBentoPresets,
	saveBentoPresets,
	type CustomBentoPreset
} from './bento-presets';

function memoryStorage(initial: Record<string, string> = {}): Storage {
	const data = new Map<string, string>(Object.entries(initial));
	return {
		get length() {
			return data.size;
		},
		clear: () => data.clear(),
		getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
		key: (index: number) => [...data.keys()][index] ?? null,
		removeItem: (key: string) => {
			data.delete(key);
		},
		setItem: (key: string, value: string) => {
			data.set(key, value);
		}
	};
}

const preset: CustomBentoPreset = {
	id: 'preset-1',
	name: 'My grid',
	preset: 'grid',
	cols: 2,
	rows: 2,
	gap: 8,
	padding: 16
};

describe('bento preset persistence', () => {
	it('returns an empty list when nothing is stored', () => {
		expect(loadBentoPresets(memoryStorage())).toEqual([]);
	});

	it('round-trips saved presets', () => {
		const storage = memoryStorage();
		saveBentoPresets([preset], storage);
		expect(loadBentoPresets(storage)).toEqual([preset]);
	});

	it('returns an empty list for corrupt payloads', () => {
		const storage = memoryStorage({
			[BENTO_PRESETS_STORAGE_KEY]: 'not-json{{'
		});
		expect(loadBentoPresets(storage)).toEqual([]);
	});

	it('skips invalid entries but keeps valid ones', () => {
		const storage = memoryStorage({
			[BENTO_PRESETS_STORAGE_KEY]: JSON.stringify([
				preset,
				{
					id: '',
					name: 'Missing id',
					preset: 'grid',
					cols: 2,
					rows: 2,
					gap: 0,
					padding: 0
				},
				{
					id: 'bad-preset',
					name: 'Bad kind',
					preset: 'masonry',
					cols: 2,
					rows: 2
				},
				'just-a-string'
			])
		});
		expect(loadBentoPresets(storage)).toEqual([preset]);
	});

	it('dedupes repeated ids', () => {
		const storage = memoryStorage();
		saveBentoPresets([preset, { ...preset, name: 'Copy' }], storage);
		expect(loadBentoPresets(storage)).toEqual([preset]);
	});

	it('clamps out-of-range numerics instead of dropping the preset', () => {
		const storage = memoryStorage();
		saveBentoPresets(
			[
				{
					...preset,
					id: 'clamped',
					cols: 99,
					rows: -3,
					gap: 9999,
					padding: 4.6
				}
			],
			storage
		);
		expect(loadBentoPresets(storage)).toEqual([
			{ ...preset, id: 'clamped', cols: 12, rows: 1, gap: 500, padding: 5 }
		]);
	});

	it('caps the stored list at fifty presets', () => {
		const storage = memoryStorage();
		const many = Array.from({ length: 60 }, (_, index) => ({
			...preset,
			id: `preset-${index}`
		}));
		saveBentoPresets(many, storage);
		expect(loadBentoPresets(storage)).toHaveLength(50);
	});

	it('tolerates unavailable storage without throwing', () => {
		expect(() => loadBentoPresets(null)).not.toThrow();
		expect(() => saveBentoPresets([preset], null)).not.toThrow();
		expect(loadBentoPresets(null)).toEqual([]);
		const throwing: Pick<Storage, 'setItem'> = {
			setItem: () => {
				throw new Error('quota exceeded');
			}
		};
		expect(() => saveBentoPresets([preset], throwing)).not.toThrow();
	});
});
