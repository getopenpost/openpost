import { describe, expect, it, vi } from 'vitest';
import { SizedAccessedMemoryCache } from './sized-accessed-memory-cache';

interface Entry {
	sizeBytes: number;
	lastAccessed: number;
	value: string;
}

function makeCache(maxBytes: number): SizedAccessedMemoryCache<Entry> {
	return new SizedAccessedMemoryCache<Entry>(maxBytes);
}

describe('SizedAccessedMemoryCache', () => {
	it('stores and retrieves entries', () => {
		const cache = makeCache(100);
		cache.add('a', { sizeBytes: 10, lastAccessed: 1, value: 'a' });
		expect(cache.get('a')?.value).toBe('a');
		expect(cache.sizeBytes).toBe(10);
	});

	it('evicts the least recently accessed entry to admit a new one', () => {
		const cache = makeCache(20);
		cache.add('old', { sizeBytes: 10, lastAccessed: 1, value: 'old' });
		cache.add('new', { sizeBytes: 10, lastAccessed: 2, value: 'new' });
		cache.get('new');
		cache.add('incoming', { sizeBytes: 10, lastAccessed: 3, value: 'incoming' });
		expect(cache.get('old')).toBeNull();
		expect(cache.get('new')?.value).toBe('new');
		expect(cache.get('incoming')?.value).toBe('incoming');
	});

	it('touching an entry protects it from eviction', () => {
		const cache = makeCache(20);
		cache.add('a', { sizeBytes: 10, lastAccessed: 1, value: 'a' });
		cache.add('b', { sizeBytes: 10, lastAccessed: 2, value: 'b' });
		cache.get('a');
		cache.add('c', { sizeBytes: 10, lastAccessed: 3, value: 'c' });
		expect(cache.get('b')).toBeNull();
		expect(cache.get('a')).not.toBeNull();
	});

	it('retains an oversized entry once everything else is evicted', () => {
		const cache = makeCache(10);
		cache.add('small', { sizeBytes: 4, lastAccessed: 1, value: 'small' });
		cache.add('huge', { sizeBytes: 50, lastAccessed: 2, value: 'huge' });
		expect(cache.get('small')).toBeNull();
		expect(cache.get('huge')?.value).toBe('huge');
		expect(cache.sizeBytes).toBeGreaterThan(10);
	});

	it('replaces an existing key and adjusts the running size', () => {
		const cache = makeCache(100);
		cache.add('a', { sizeBytes: 30, lastAccessed: 1, value: 'a1' });
		cache.add('a', { sizeBytes: 12, lastAccessed: 2, value: 'a2' });
		expect(cache.get('a')?.value).toBe('a2');
		expect(cache.sizeBytes).toBe(12);
	});

	it('delete and clear release byte accounting', () => {
		const cache = makeCache(100);
		cache.add('a', { sizeBytes: 10, lastAccessed: 1, value: 'a' });
		cache.add('b', { sizeBytes: 5, lastAccessed: 2, value: 'b' });
		cache.delete('a');
		expect(cache.sizeBytes).toBe(5);
		cache.clear();
		expect(cache.sizeBytes).toBe(0);
		expect(cache.keys()).toEqual([]);
	});

	it('peek does not touch LRU', () => {
		const cache = makeCache(20);
		cache.add('a', { sizeBytes: 10, lastAccessed: 1, value: 'a' });
		cache.add('b', { sizeBytes: 10, lastAccessed: 2, value: 'b' });
		// peek a should not make it newer
		expect(cache.peek('a')?.value).toBe('a');
		cache.add('c', { sizeBytes: 10, lastAccessed: 3, value: 'c' });
		// a was peeked, so b should still be newer than a, a evicted
		expect(cache.peek('a')).toBeNull();
		expect(cache.peek('b')?.value).toBe('b');
	});

	it('pinning protects subscriber entries from pressure eviction', () => {
		const evicted: string[] = [];
		const cache = new SizedAccessedMemoryCache<Entry>(20, {
			onEvict: (key) => evicted.push(key),
			isPinned: (key) => key === 'pinned'
		});
		cache.add('pinned', { sizeBytes: 10, lastAccessed: 1, value: 'pinned' });
		cache.add('old', { sizeBytes: 10, lastAccessed: 2, value: 'old' });
		cache.add('incoming', { sizeBytes: 10, lastAccessed: 3, value: 'incoming' });
		// pinned must survive, old evicted
		expect(cache.peek('pinned')?.value).toBe('pinned');
		expect(cache.peek('old')).toBeNull();
		expect(evicted).toEqual(['old']);
	});

	it('onEvict is invoked exactly once per pressure eviction and not on peek', () => {
		const evicted: string[] = [];
		const cache = new SizedAccessedMemoryCache<Entry>(20, {
			onEvict: (key) => evicted.push(key)
		});
		cache.add('a', { sizeBytes: 10, lastAccessed: 1, value: 'a' });
		cache.add('b', { sizeBytes: 10, lastAccessed: 2, value: 'b' });
		cache.add('c', { sizeBytes: 10, lastAccessed: 3, value: 'c' });
		expect(evicted).toEqual(['a']);
		expect(evicted.filter((k) => k === 'a').length).toBe(1);
	});

	it('delete and clear invoke onEvict exactly once, no double-close', () => {
		const closeCounts = new Map<string, number>();
		const mkEntry = (v: string): Entry => ({ sizeBytes: 10, lastAccessed: Date.now(), value: v });
		const cache = new SizedAccessedMemoryCache<Entry>(100, {
			onEvict: (key) => closeCounts.set(key, (closeCounts.get(key) ?? 0) + 1)
		});
		cache.add('x', mkEntry('x'));
		cache.add('y', mkEntry('y'));
		cache.delete('x');
		expect(closeCounts.get('x')).toBe(1);
		expect(closeCounts.get('y')).toBeUndefined();
		cache.clear();
		expect(closeCounts.get('y')).toBe(1);
		// ensure not double counted
		expect(closeCounts.get('x')).toBe(1);
	});

	it('eviction does not leak and does not double-close pinned second time', () => {
		const evicted: string[] = [];
		const cache = new SizedAccessedMemoryCache<Entry>(20, {
			onEvict: (k) => evicted.push(k),
			isPinned: (k) => k === 'keep'
		});
		cache.add('keep', { sizeBytes: 10, lastAccessed: 1, value: 'keep' });
		cache.add('a', { sizeBytes: 10, lastAccessed: 2, value: 'a' });
		cache.add('b', { sizeBytes: 10, lastAccessed: 3, value: 'b' });
		// a evicted, keep pinned
		expect(evicted).toEqual(['a']);
		cache.add('c', { sizeBytes: 10, lastAccessed: 4, value: 'c' });
		// now b evicted, keep still pinned, no second eviction of keep
		expect(evicted).toEqual(['a', 'b']);
		expect(cache.peek('keep')?.value).toBe('keep');
	});

	it('get updates lastAccessed (touch) while peek keeps original', () => {
		vi.useFakeTimers();
		const cache = makeCache(100);
		cache.add('a', { sizeBytes: 10, lastAccessed: 1000, value: 'a' });
		vi.setSystemTime(5000);
		expect(cache.peek('a')?.lastAccessed).toBe(1000);
		cache.get('a');
		expect(cache.peek('a')?.lastAccessed).toBe(5000);
		vi.useRealTimers();
	});
});
