export const PARAKEET_MODEL_BASE =
	'https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx/resolve/9d104194420cfe48c3374385bb42b42a788b9225';
export const PARAKEET_FILES = {
	encoderFp16: 'fp16/encoder-model.fp16.onnx',
	encoderInt8: 'int8/encoder-model.int8.onnx',
	decoder: 'int8/decoder_joint-model.int8.onnx',
	preprocessor: 'nemo128.onnx',
	vocabulary: 'vocab.txt'
} as const;
export const PARAKEET_FILE_BYTES = {
	[PARAKEET_FILES.encoderFp16]: 1218263142,
	[PARAKEET_FILES.encoderInt8]: 649524002,
	[PARAKEET_FILES.decoder]: 18203490,
	[PARAKEET_FILES.preprocessor]: 139764,
	[PARAKEET_FILES.vocabulary]: 93939
};

export async function selectParakeetBackend(): Promise<'webgpu' | 'wasm'> {
	if (!globalThis.navigator?.gpu) return 'wasm';
	const adapter = await navigator.gpu.requestAdapter().catch(() => null);
	return adapter?.features.has('shader-f16') ? 'webgpu' : 'wasm';
}
