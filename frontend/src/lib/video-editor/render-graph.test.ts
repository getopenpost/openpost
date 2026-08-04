import { describe, expect, it } from 'vitest';
import {
	createBlankVideoProject,
	defaultClipAudio,
	defaultVideoPresentation,
	type VideoSource
} from '@openpost/video-project';
import { evaluateAudio, evaluateFrame } from './render-graph';

function source(id: string): VideoSource {
	return {
		id,
		kind: 'video',
		locator: { type: 'local-opfs', path: `projects/p/sources/${id}.mp4` },
		original_name: `${id}.mp4`,
		mime_type: 'video/mp4',
		size_bytes: 10,
		duration_us: 10_000_000,
		width: 1920,
		height: 1080,
		rotation: 0
	};
}

describe('OpenPost Video Editor render graph', () => {
	it('evaluates the same shared timing with isolated variant overrides', () => {
		const project = createBlankVideoProject();
		project.sources.a = source('a');
		project.primary_sequence.push({
			id: 'clip-a',
			source_id: 'a',
			mode: 'source',
			source_in_us: 1_000_000,
			source_out_us: 5_000_000,
			speed: 1,
			video: defaultVideoPresentation(),
			audio: defaultClipAudio(),
			effects: [],
			variant_overrides: { portrait: { scale: 1.8 } }
		});

		const portrait = evaluateFrame(project, 'portrait', 2_000_000);
		const square = evaluateFrame(project, 'square', 2_000_000);
		expect(portrait.primary_layers[0]?.source_time_us).toBe(3_000_000);
		expect(portrait.primary_layers[0]?.presentation.scale).toBe(1.8);
		expect(square.primary_layers[0]?.presentation.scale).toBe(1);
	});

	it('isolates overlay placement and visibility across all four formats', () => {
		const project = createBlankVideoProject();
		project.visual_tracks.push({
			id: 'overlays',
			name: 'Overlays',
			locked: false,
			hidden: false,
			items: [
				{
					id: 'overlay',
					type: 'shape',
					timeline_start_us: 0,
					duration_us: 2_000_000,
					visible: true,
					shape: {
						kind: 'rectangle',
						fill: '#f97316',
						stroke: '#fff',
						stroke_width: 2,
						blur: 0
					},
					presentation: defaultVideoPresentation(),
					variant_overrides: {
						portrait: {
							visible: false,
							presentation: { position_x: 0.2 }
						},
						'feed-portrait': {
							visible: true,
							presentation: { position_x: 0.3 }
						},
						landscape: {
							visible: true,
							presentation: { position_x: 0.8 }
						}
					}
				}
			]
		});

		expect(evaluateFrame(project, 'portrait', 1_000_000).visual_layers).toHaveLength(0);
		expect(
			evaluateFrame(project, 'feed-portrait', 1_000_000).visual_layers[0]?.presentation.position_x
		).toBe(0.3);
		expect(
			evaluateFrame(project, 'square', 1_000_000).visual_layers[0]?.presentation.position_x
		).toBe(0.5);
		expect(
			evaluateFrame(project, 'landscape', 1_000_000).visual_layers[0]?.presentation.position_x
		).toBe(0.8);
	});

	it('applies keyframes and finds the active caption word', () => {
		const project = createBlankVideoProject();
		project.sources.a = source('a');
		const presentation = defaultVideoPresentation();
		presentation.keyframes = {
			scale: [
				{ time_us: 0, value: 1, easing: 'linear' },
				{ time_us: 2_000_000, value: 2, easing: 'linear' }
			]
		};
		project.primary_sequence.push({
			id: 'clip-a',
			source_id: 'a',
			mode: 'source',
			source_in_us: 0,
			source_out_us: 5_000_000,
			speed: 1,
			video: presentation,
			audio: defaultClipAudio(),
			effects: []
		});
		project.caption_tracks.push({
			id: 'captions',
			name: 'Captions',
			language: 'en',
			visible: true,
			style: {
				preset: 'clean',
				font_family: 'Geist',
				font_size: 58,
				font_weight: 700,
				color: '#fff',
				emphasis_color: '#f97316',
				background_color: '#000',
				position: 'bottom',
				max_lines: 2
			},
			cues: [
				{
					id: 'cue',
					start_us: 0,
					end_us: 2_000_000,
					text: 'Hello there',
					words: [
						{ text: 'Hello', start_us: 0, end_us: 900_000 },
						{ text: 'there', start_us: 900_000, end_us: 2_000_000 }
					]
				}
			]
		});

		const frame = evaluateFrame(project, 'portrait', 1_000_000);
		expect(frame.primary_layers[0]?.presentation.scale).toBeCloseTo(1.5);
		expect(frame.captions[0]?.active_word_index).toBe(1);
	});

	it('ducks music while an active voice track requests it', () => {
		const project = createBlankVideoProject();
		project.sources.voice = { ...source('voice'), kind: 'audio', width: 0, height: 0 };
		project.sources.music = { ...source('music'), kind: 'audio', width: 0, height: 0 };
		project.audio_tracks = [
			{
				id: 'voice',
				name: 'Voice',
				role: 'voice',
				muted: false,
				items: [
					{
						id: 'voice-item',
						source_id: 'voice',
						timeline_start_us: 0,
						source_in_us: 0,
						duration_us: 2_000_000,
						speed: 1,
						gain_db: 0,
						fade_in_us: 0,
						fade_out_us: 0,
						muted: false,
						duck_others: true
					}
				]
			},
			{
				id: 'music',
				name: 'Music',
				role: 'music',
				muted: false,
				items: [
					{
						id: 'music-item',
						source_id: 'music',
						timeline_start_us: 0,
						source_in_us: 0,
						duration_us: 4_000_000,
						speed: 1,
						gain_db: 0,
						fade_in_us: 0,
						fade_out_us: 0,
						muted: false,
						duck_others: false
					}
				]
			}
		];

		const audio = evaluateAudio(project, 1_000_000, 1_020_000);
		expect(audio.ducking_active).toBe(true);
		expect(audio.sources.find((item) => item.role === 'music')?.gain).toBe(0.25);
	});
});
