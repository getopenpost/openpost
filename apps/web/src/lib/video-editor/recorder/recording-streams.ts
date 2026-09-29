import type { RecorderKind } from './recorder.svelte';

/** Record microphone audio with the camera, or with the screen when no camera is selected. */
export function createRecordingStreams(input: {
	screen: MediaStream | null;
	camera: MediaStream | null;
	microphone: MediaStream | null;
}) {
	const sources: { kind: RecorderKind; stream: MediaStream }[] = [];
	let context: AudioContext | null = null;
	let destination: MediaStreamAudioDestinationNode | null = null;
	const nodes: MediaStreamAudioSourceNode[] = [];
	const dispose = () => {
		for (const node of nodes) node.disconnect();
		destination?.stream.getTracks().forEach((track) => track.stop());
		if (context && context.state !== 'closed') void context.close().catch(() => undefined);
	};
	try {
		for (const kind of ['screen', 'camera'] as const) {
			const visual = input[kind];
			if (!visual) continue;
			const ownsMicrophone = kind === (input.camera ? 'camera' : 'screen');
			const microphoneTracks = ownsMicrophone ? (input.microphone?.getAudioTracks() ?? []) : [];
			if (microphoneTracks.length === 0) {
				sources.push({ kind, stream: visual });
				continue;
			}
			const audioTracks = [...visual.getAudioTracks(), ...microphoneTracks];
			let outputTracks = audioTracks;
			if (audioTracks.length > 1) {
				// MediaRecorder does not portably mux multiple audio tracks. Mix system
				// and microphone audio into one track, on the recording's own clock.
				context = new AudioContext();
				destination = context.createMediaStreamDestination();
				for (const track of audioTracks) {
					const node = context.createMediaStreamSource(new MediaStream([track]));
					node.connect(destination);
					nodes.push(node);
				}
				outputTracks = destination.stream.getAudioTracks();
			}
			sources.push({
				kind,
				stream: new MediaStream([...visual.getVideoTracks(), ...outputTracks])
			});
		}
		if (sources.length === 0 && input.microphone)
			sources.push({ kind: 'microphone', stream: input.microphone });
		return { sources, resume: () => context?.resume() ?? Promise.resolve(), dispose };
	} catch (error) {
		dispose();
		throw error;
	}
}
