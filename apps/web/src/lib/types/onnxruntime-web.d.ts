declare module 'onnxruntime-web' {
	export type TensorData = Float32Array | BigInt64Array;

	export class Tensor {
		constructor(type: 'float32' | 'int64', data: TensorData, dims: readonly number[]);
		readonly data: TensorData;
		readonly dims: readonly number[];
	}

	export class InferenceSession {
		static create(
			model: string | Uint8Array,
			options?: {
				executionProviders?: string[];
				graphOptimizationLevel?: 'disabled' | 'basic' | 'extended' | 'all';
			}
		): Promise<InferenceSession>;
		run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>;
		release(): Promise<void>;
	}
}
