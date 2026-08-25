/** Scene Browser analysis persistence. Ported from FreeCut (MIT). */

import type { MediaMetadata } from '../media/types';
import type { MediaScene, SceneAnalysis } from '../media/scene-search/types';
import {
	readArrayBuffer,
	readBlob,
	readJson,
	removeEntry,
	writeBlob,
	writeJsonAtomic
} from './fs-primitives';
import { createLogger } from './logger';
import {
	sceneAnalysisPath,
	sceneImageEmbeddingsPath,
	sceneTextEmbeddingsPath,
	sceneThumbPath,
	sceneThumbRelPath,
	sceneThumbsDir
} from './paths';
import { requireWorkspaceRoot } from './root';

const logger = createLogger('WorkspaceFS:SceneAnalysis');

type SerializedScene = Omit<MediaScene, 'embedding' | 'imageEmbedding'>;

interface PackedVectors {
	dim: number;
	indices: number[];
}

type PackedVectorsResult = {
	metadata?: PackedVectors;
	bytes?: Uint8Array;
};

interface SceneAnalysisDocument extends Omit<SceneAnalysis, 'scenes'> {
	scenes: SerializedScene[];
	textVectors?: PackedVectors;
	imageVectors?: PackedVectors;
}

function packVectors(
	scenes: MediaScene[],
	select: (scene: MediaScene) => Float32Array | undefined
): PackedVectorsResult {
	const entries = scenes
		.map((scene, index) => ({ index, vector: select(scene) }))
		.filter((entry): entry is { index: number; vector: Float32Array } => !!entry.vector);
	if (entries.length === 0) return {};
	const dim = entries[0]!.vector.length;
	if (dim === 0 || entries.some((entry) => entry.vector.length !== dim)) return {};
	const packed = new Float32Array(entries.length * dim);
	for (let index = 0; index < entries.length; index += 1) {
		packed.set(entries[index]!.vector, index * dim);
	}
	return {
		metadata: { dim, indices: entries.map((entry) => entry.index) },
		bytes: new Uint8Array(packed.buffer)
	};
}

function hydrateVectors(
	scenes: MediaScene[],
	metadata: PackedVectors | undefined,
	buffer: ArrayBuffer | null,
	assign: (scene: MediaScene, vector: Float32Array) => void
): void {
	if (!metadata || !buffer || metadata.dim <= 0) return;
	const packed = new Float32Array(buffer);
	if (packed.length !== metadata.dim * metadata.indices.length) return;
	for (let packedIndex = 0; packedIndex < metadata.indices.length; packedIndex += 1) {
		const scene = scenes[metadata.indices[packedIndex]!];
		if (!scene) continue;
		assign(scene, packed.slice(packedIndex * metadata.dim, (packedIndex + 1) * metadata.dim));
	}
}

export function sceneAnalysisMatchesMedia(analysis: SceneAnalysis, media: MediaMetadata): boolean {
	if (analysis.mediaId !== media.id || analysis.sourceFileSize !== media.fileSize) return false;
	if (analysis.contentHash && media.contentHash) return analysis.contentHash === media.contentHash;
	return (
		analysis.sourceLastModified === undefined ||
		media.fileLastModified === undefined ||
		analysis.sourceLastModified === media.fileLastModified
	);
}

export async function getSceneAnalysis(mediaId: string): Promise<SceneAnalysis | null> {
	const root = requireWorkspaceRoot();
	try {
		const document = await readJson<SceneAnalysisDocument>(root, sceneAnalysisPath(mediaId));
		if (!document || document.schemaVersion !== 1) return null;
		const scenes: MediaScene[] = document.scenes.map((scene) => ({ ...scene }));
		const [textBuffer, imageBuffer] = await Promise.all([
			readArrayBuffer(root, sceneTextEmbeddingsPath(mediaId)),
			readArrayBuffer(root, sceneImageEmbeddingsPath(mediaId))
		]);
		hydrateVectors(scenes, document.textVectors, textBuffer, (scene, vector) => {
			scene.embedding = vector;
		});
		hydrateVectors(scenes, document.imageVectors, imageBuffer, (scene, vector) => {
			scene.imageEmbedding = vector;
		});
		return { ...document, scenes };
	} catch (error) {
		logger.warn(`getSceneAnalysis(${mediaId}) failed`, error);
		return null;
	}
}

export async function saveSceneAnalysis(analysis: SceneAnalysis): Promise<void> {
	const root = requireWorkspaceRoot();
	const text = packVectors(analysis.scenes, (scene) => scene.embedding);
	const image = packVectors(analysis.scenes, (scene) => scene.imageEmbedding);
	const scenes = analysis.scenes.map(
		({ embedding: _embedding, imageEmbedding: _image, ...scene }) => scene
	);
	const document: SceneAnalysisDocument = {
		...analysis,
		scenes,
		textVectors: text.metadata,
		imageVectors: image.metadata
	};
	await writeJsonAtomic(root, sceneAnalysisPath(analysis.mediaId), document);
	await Promise.all([
		text.bytes
			? writeBlob(root, sceneTextEmbeddingsPath(analysis.mediaId), text.bytes)
			: removeEntry(root, sceneTextEmbeddingsPath(analysis.mediaId)),
		image.bytes
			? writeBlob(root, sceneImageEmbeddingsPath(analysis.mediaId), image.bytes)
			: removeEntry(root, sceneImageEmbeddingsPath(analysis.mediaId))
	]);
}

export async function saveSceneThumbnail(
	mediaId: string,
	index: number,
	blob: Blob
): Promise<string> {
	const root = requireWorkspaceRoot();
	await writeBlob(root, sceneThumbPath(mediaId, index), blob);
	return sceneThumbRelPath(mediaId, index);
}

export async function getSceneThumbnail(relPath: string): Promise<Blob | null> {
	const segments = relPath.split('/').filter(Boolean);
	if (segments.length === 0) return null;
	try {
		return await readBlob(requireWorkspaceRoot(), segments);
	} catch (error) {
		logger.warn(`getSceneThumbnail(${relPath}) failed`, error);
		return null;
	}
}

export async function deleteSceneAnalysis(mediaId: string): Promise<void> {
	const root = requireWorkspaceRoot();
	await Promise.all([
		removeEntry(root, sceneAnalysisPath(mediaId)),
		removeEntry(root, sceneTextEmbeddingsPath(mediaId)),
		removeEntry(root, sceneImageEmbeddingsPath(mediaId)),
		removeEntry(root, sceneThumbsDir(mediaId), { recursive: true })
	]);
}
