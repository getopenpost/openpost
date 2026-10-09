import { describe, expect, it, vi } from 'vitest';
import {
	defaultVideoCodec,
	resolveSubtitleMode,
	supportedExportVideoCodecs
} from './render-export';
import { RenderDisposalGate } from './render-disposal';

describe('render export choices', () => {
	it('offers only codecs that each container accepts', () => {
		expect(supportedExportVideoCodecs('webm')).toEqual(['vp9', 'av1', 'vp8']);
		expect(supportedExportVideoCodecs('mp4')).toContain('avc');
		expect(supportedExportVideoCodecs('mov')).toContain('hevc');
		expect(supportedExportVideoCodecs('mkv')).not.toContain('prores');
	});

	it('starts with broadly supported codecs', () => {
		expect(defaultVideoCodec('webm')).toBe('vp9');
		expect(defaultVideoCodec('mp4')).toBe('avc');
		expect(defaultVideoCodec('mov')).toBe('avc');
		expect(defaultVideoCodec('mkv')).toBe('avc');
	});

	it('burns embedded subtitles when the container cannot carry WebVTT', () => {
		expect(resolveSubtitleMode('embedded', 'mp4')).toBe('burn');
		expect(resolveSubtitleMode('embedded', 'mov')).toBe('burn');
		expect(resolveSubtitleMode('embedded', 'webm')).toBe('embedded');
		expect(resolveSubtitleMode('embedded', 'mkv')).toBe('embedded');
	});
});

describe('render disposal', () => {
	it('waits for in-flight frame work before releasing media inputs', () => {
		const cleanup = vi.fn();
		const gate = new RenderDisposalGate(cleanup);

		gate.enter();
		gate.dispose();
		expect(cleanup).not.toHaveBeenCalled();

		gate.leave();
		expect(cleanup).toHaveBeenCalledOnce();
		expect(() => gate.enter()).toThrow('disposed renderer');
	});
});
