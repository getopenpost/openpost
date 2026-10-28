import { describe, expect, it } from 'vitest';
import type { LottieFilesAnimation } from './lottiefiles-api';
import {
	clearLottieDragData,
	getActiveLottieAnimation,
	getLottieDragData,
	parseLottieDragData,
	writeLottieDragData,
	type LottieDataTransfer
} from './lottie-drag';

const animation: LottieFilesAnimation = {
	id: 'abc123',
	name: 'Confetti',
	lottieUrl: 'https://assets-v2.lottiefiles.com/abc.json',
	gifUrl: null,
	bgColor: null,
	author: null,
	authorPath: null
};

interface SeenTransfer {
	format: string;
	data: string;
}

function transferWriter(seen: SeenTransfer): LottieDataTransfer {
	return {
		effectAllowed: 'uninitialized',
		setData: (format, data) => {
			seen.format = format;
			seen.data = data;
		},
		getData: () => ''
	};
}

describe('lottie drag payload', () => {
	it('round-trips a lottie payload', () => {
		const seen: SeenTransfer = { format: '', data: '' };
		writeLottieDragData(transferWriter(seen), animation);
		expect(seen.format).toBe('application/x-openpost-lottie-v1');
		clearLottieDragData();
		const reader: LottieDataTransfer = {
			effectAllowed: 'uninitialized',
			setData: () => {},
			getData: () => seen.data
		};
		expect(getLottieDragData(reader)).toEqual({
			version: 1,
			id: 'abc123',
			label: 'Confetti',
			url: 'https://assets-v2.lottiefiles.com/abc.json'
		});
		expect(parseLottieDragData('')).toBeNull();
	});

	it('rejects malformed payloads', () => {
		expect(parseLottieDragData('not-json')).toBeNull();
		expect(parseLottieDragData(JSON.stringify({ version: 1, id: 'a', label: 'L' }))).toBeNull();
		expect(
			parseLottieDragData(
				JSON.stringify({ version: 1, id: 'a', label: 'L', url: 'http://evil/x.json' })
			)
		).toBeNull();
	});

	it('exposes the active animation for same-document drops', () => {
		writeLottieDragData(transferWriter({ format: '', data: '' }), animation);
		expect(getActiveLottieAnimation('abc123')).toBe(animation);
		expect(getActiveLottieAnimation('other')).toBeNull();
		clearLottieDragData();
		expect(getActiveLottieAnimation('abc123')).toBeNull();
	});
});
