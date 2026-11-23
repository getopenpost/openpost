import { describe, expect, it } from 'vitest';
import { reconcileSystemAudioWithProbe } from './recording-capture-schema';
import type { RecordingSystemAudioStatus } from '@openpost/editor-shared/media';

describe('recording system audio provenance', () => {
	it.each<RecordingSystemAudioStatus>(['inactive', 'denied', 'unavailable', 'not-requested'])(
		'keeps observed %s system audio when the screen file contains microphone audio',
		(status) => {
			expect(
				reconcileSystemAudioWithProbe(
					{ requested: status !== 'not-requested', active: false, status },
					true
				)
			).toEqual({ active: false, status });
		}
	);

	it.each([true, false])('reconciles observed shared audio with encoded audio=%s', (hasAudio) => {
		expect(
			reconcileSystemAudioWithProbe({ requested: true, active: true, status: 'active' }, hasAudio)
		).toEqual({ active: hasAudio, status: hasAudio ? 'active' : 'inactive' });
	});
});
