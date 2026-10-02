import type { MediaConversionTool, MediaOutputFormat } from '@openpost/social-images';

const privacy =
	'Your files stay on your device. Conversion runs in your browser, using its available decoders and encoders. MP3 and AAC encoders load when needed. Keep the tab open and download your result before leaving. Input files are limited to 250 MB and output files to 500 MB.';
const outputAdvice = {
	mp4: 'MP4 is useful for social uploads and sharing. H.264 video with AAC audio is a common compatibility choice. An MP4 extension alone does not guarantee that a service accepts the codecs, dimensions or bitrate inside it.',
	mkv: 'MKV can hold many video and audio codecs. It is useful for keeping compatible encoded tracks in a different container. Many browsers and social platforms cannot play or accept MKV directly. Download it for a player or editor that supports Matroska.',
	webm: 'WebM uses web-oriented video codecs such as VP8, VP9 or AV1 with Opus or Vorbis audio. A source with H.264 or AAC usually needs re-encoding to become WebM. Available encoders depend on your browser and device.',
	mov: 'MOV is common in camera and editing workflows. Its codecs can vary, including formats your browser may not decode. Choose a codec supported by the application that will open the result.',
	mp3: 'MP3 is widely accepted by audio players and podcast tools. Lower bitrates produce smaller files and can reduce audible detail. The tool includes a local MP3 encoder for browsers without native MP3 encoding.',
	wav: 'WAV is useful when an editor needs uncompressed audio. Its files are often much larger than MP3 or AAC. Converting a lossy recording to WAV does not restore detail that was already lost.',
	m4a: 'M4A is an audio-only MP4 container. AAC is a common choice for a small file with broad playback support. Converting to AAC can lose detail, so keep the original when you need an archival copy.',
	ogg: 'Ogg is useful for Opus or Vorbis audio in web and open-source workflows. Check that your target player accepts it. Choosing an encoder can require decoding and recompressing the source.',
	flac: 'FLAC preserves decoded audio without lossy compression. It is useful for keeping an uncompressed source in less space. Turning MP3 or AAC into FLAC cannot undo earlier compression losses. Encoding availability depends on your browser.'
} satisfies Record<MediaOutputFormat, string>;
const inputAdvice = {
	mp4: 'MP4 names a container, not a codec. It may contain H.264, H.265, AV1 or other video and several audio formats. Read the detected source tracks before deciding whether to keep or change them.',
	mkv: 'An MKV file may contain several soundtracks, subtitles or attachments. This tool uses the primary video and audio tracks. Extra tracks, subtitles and attachments are omitted, so keep the original if you need them.',
	webm: 'WebM recordings often use VP8 or VP9 video and Opus audio. Keeping those codecs in MP4 may limit playback in other applications. Choose H.264 and AAC when your destination requires them.',
	mov: 'Camera MOV files may use H.264, H.265 or ProRes. This tool can only transcode codecs your browser can decode. If it reports an unsupported source codec, convert that recording in a compatible desktop editor.',
	mp3: 'MP3 is already compressed with a lossy codec. Re-encoding it can reduce quality again. Use a copy of your original and check the exported audio before sharing it.',
	wav: 'WAV often contains uncompressed PCM audio. It is a good source for a smaller delivery file. Check the detected channel count and sample rate before converting.',
	m4a: 'M4A often holds AAC or Apple Lossless audio. Decoding support depends on the codec inside the file, not just its extension. The detected source information shows what was found.',
	flac: 'FLAC usually stores lossless audio. Converting it to MP3 makes a smaller, lossy delivery copy. Converting it to WAV keeps decoded samples without making an already-lossy source more detailed.',
	ogg: 'Ogg audio can use Opus, Vorbis or FLAC. Check the detected codec. Converting to MP3 can help with older players, while introducing another lossy encoding step.'
} satisfies Record<MediaOutputFormat, string>;

export function mediaConversionGuide(tool: MediaConversionTool) {
	if (tool.mode === 'inspect')
		return {
			privacy,
			steps: [
				'Choose or drop a local video or audio file.',
				'Read its detected container, duration and tracks.',
				"Check each track's codec, video dimensions or audio channels and sample rate."
			],
			sections: [
				{
					title: 'What is inside your media file?',
					paragraphs: [
						'A filename extension names the container. Each track has a codec that tells a player how to decode it. Two MP4 files can have different playback compatibility even when their names end the same way.',
						'Use this inspector before a conversion or social upload. It reads local metadata without uploading your file. It does not certify a file for a social network or prove that every frame can be decoded.'
					]
				}
			]
		};
	const audioOnly = tool.mode === 'audio' || tool.mode === 'extract';
	const source = tool.input?.toUpperCase();
	const destination = tool.output?.toUpperCase();
	const special = {
		compress: {
			title: 'Make a smaller delivery copy',
			paragraphs: [
				'Choose a lower video bitrate, and reduce the maximum height when you do not need the original resolution. Compression re-encodes the video and can lose detail. The size comparison reports the actual output, since a chosen bitrate cannot guarantee a smaller result.',
				'Watch the converted preview for text readability, motion artifacts and audio sync. The resolution setting preserves aspect ratio and does not enlarge a smaller source. Keep the original for later edits.'
			]
		},
		mute: {
			title: 'Remove the soundtrack',
			paragraphs: [
				'Use a silent clip for a product demo, a background video or a post that will receive new audio. The output has no audio track. Choose Keep source codec to avoid recompressing compatible video.',
				'The selected container must support the original video codec. If it does not, the tool asks you to choose another codec or format. Removing sound does not change any text already visible in the video.'
			]
		},
		extract: {
			title: 'Save the primary soundtrack',
			paragraphs: [
				'Extract voice, music or a meeting recording from a local video. This tool saves the primary audio track and omits the video. A file without an audio track cannot produce an audio download.',
				'Use Keep source codec when the chosen audio container supports it. Otherwise choose a new codec and bitrate. The tool extracts the existing soundtrack; it does not separate vocals, remove background noise or transcribe speech.'
			]
		}
	};
	const sections =
		tool.mode === 'compress' || tool.mode === 'mute' || tool.mode === 'extract'
			? [special[tool.mode]]
			: [
					{
						title:
							source && destination
								? `When to convert ${source} to ${destination}`
								: audioOnly
									? 'Choose an audio format and codec'
									: 'Change containers or re-encode',
						paragraphs: [
							tool.input
								? inputAdvice[tool.input]
								: audioOnly
									? 'Choose an output format for the application that will play or edit your audio. The tool reads the source codec and shows the encoders available on this device.'
									: 'Choose Automatic to keep encoded tracks when the output container supports them and re-encode when needed. Choose Keep source codec to require a compatible codec. Selecting a specific codec re-encodes that track, even when the source uses the same codec.',
							outputAdvice[tool.output ?? 'mp4']
						]
					}
				];
	return {
		privacy,
		steps: [
			`Choose or drop ${source ? `a ${source} file` : audioOnly ? 'an audio or video file' : 'a video file'}.`,
			tool.mode === 'compress'
				? 'Set the output bitrate and maximum resolution.'
				: tool.mode === 'mute'
					? 'Choose the output container and video codec.'
					: 'Choose the output format, codec and available bitrate settings.',
			`${tool.mode === 'mute' ? 'Remove audio' : tool.mode === 'compress' ? 'Compress' : 'Convert'}, review the result, then download your file.`
		],
		sections,
		questions: [
			{
				question: 'Which tracks are kept?',
				answer: audioOnly
					? 'The primary audio track is converted. Video, subtitles, attachments and other audio tracks are omitted. Keep the source if you need them.'
					: 'The primary video and audio tracks are used, except when you choose Remove audio. Extra tracks, subtitles and attachments are omitted. Unsupported selected tracks produce an error instead of silently disappearing.'
			},
			{
				question: 'Why is a codec missing or a conversion blocked?',
				answer:
					'Codec support depends on your browser, operating system, device and source profile. The menus list available output encoders, and conversion checks the actual source. Try a current Chrome or Edge browser, another format, or Keep source codec for a compatible container.'
			},
			{
				question: 'Does conversion always preserve quality?',
				answer:
					'Keeping compatible encoded tracks avoids recompressing them. Re-encoding with a lossy codec can reduce quality. Lossless output preserves decoded samples but cannot recover detail lost in an earlier encoding.'
			}
		]
	};
}
