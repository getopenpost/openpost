/** Binary waveform persistence tier. Ported from FreeCut (MIT). */
import type { WaveformData } from './waveform-client';
import { readOpfsBlob, writeOpfsBlob } from './opfs-cache';

const MAGIC = 0x4f505746;
const HEADER_BYTES = 20;
const FORMAT_VERSION = 2;

export interface WaveformPersistenceStore {
	write(kind: string, key: string, name: string, blob: Blob): Promise<void>;
	read(kind: string, key: string, name: string): Promise<Blob | null>;
}

const opfsWaveformStore: WaveformPersistenceStore = {
	write: writeOpfsBlob,
	read: readOpfsBlob
};

export async function saveWaveform(
	mediaId: string,
	data: WaveformData,
	store: WaveformPersistenceStore = opfsWaveformStore
): Promise<void> {
	const buffer = new ArrayBuffer(HEADER_BYTES + data.peaks.byteLength);
	const view = new DataView(buffer);
	view.setUint32(0, MAGIC, true);
	view.setUint32(4, FORMAT_VERSION, true);
	view.setFloat64(8, data.durationSeconds, true);
	view.setUint32(16, data.samplesPerSecond, true);
	new Uint8Array(buffer, HEADER_BYTES).set(
		new Uint8Array(data.peaks.buffer, data.peaks.byteOffset, data.peaks.byteLength)
	);
	await store.write('waveforms', mediaId, 'peaks.bin', new Blob([buffer]));
}

export async function loadWaveform(
	mediaId: string,
	store: WaveformPersistenceStore = opfsWaveformStore
): Promise<WaveformData | null> {
	const blob = await store.read('waveforms', mediaId, 'peaks.bin');
	if (!blob) return null;
	const buffer = await blob.arrayBuffer();
	if (buffer.byteLength < HEADER_BYTES) return null;
	const view = new DataView(buffer);
	if (view.getUint32(0, true) !== MAGIC || view.getUint32(4, true) !== FORMAT_VERSION) return null;
	return {
		durationSeconds: view.getFloat64(8, true),
		samplesPerSecond: view.getUint32(16, true),
		peaks: new Float32Array(buffer.slice(HEADER_BYTES)),
		loadedSamples: (buffer.byteLength - HEADER_BYTES) / Float32Array.BYTES_PER_ELEMENT,
		isComplete: true
	};
}
