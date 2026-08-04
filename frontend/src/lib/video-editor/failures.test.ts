import { describe, expect, it } from 'vitest';
import {
	classifyVideoEditorFailure,
	failurePresentation,
	recordVideoEditorDiagnostic
} from './failures';

describe('OpenPost Video Editor structured failures', () => {
	it('maps known runtime failures to stable codes and recovery copy', () => {
		const code = classifyVideoEditorFailure(
			new Error('This specific encoder configuration cannot encode H.264.')
		);
		expect(code).toBe('codec.encoder');
		expect(failurePresentation(code)).toEqual(
			expect.objectContaining({ retryable: false, preservation: expect.any(String) })
		);
	});

	it('stores only the content-free diagnostic fields in the public interface', () => {
		let stored = '';
		recordVideoEditorDiagnostic(
			{
				code: 'model.timeout',
				operation: 'transcription',
				duration_bucket: '10-60s',
				size_bucket: '10-100MB',
				worker_state: 'window-timeout',
				engine_version: 'whisper-tiny:1',
				capabilities: { webgpu: false, wasm: true }
			},
			{
				getItem: () => null,
				setItem: (_key, value) => (stored = value)
			}
		);

		expect(stored).toContain('"code":"model.timeout"');
		const [entry] = JSON.parse(stored) as Array<Record<string, unknown>>;
		expect(Object.keys(entry ?? {}).sort()).toEqual(
			[
				'at',
				'browser_major',
				'capabilities',
				'code',
				'duration_bucket',
				'engine_version',
				'operation',
				'size_bucket',
				'worker_state'
			].filter((key) => key in (entry ?? {}))
		);
		expect(stored).not.toMatch(/filename|caption_text|stock_query|project_title|provider_url/iu);
	});
});
