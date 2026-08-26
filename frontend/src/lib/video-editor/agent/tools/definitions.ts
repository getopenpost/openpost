import { m } from '$lib/paraglide/messages';
import { z } from 'zod';
import { timelineStore } from '../../timeline/stores/timeline-store.svelte';
import {
	addTextItemAtFrame,
	setCurrentFrame,
	setItemsSpeed,
	setItemsVolume,
	splitItemsAtFrame,
	rippleDeleteItems,
	trimItemStart,
	trimItemEnd
} from '../../timeline/actions/items';
import { timelineToSourceFrames } from '../../timeline/utils/source-calculations';
import { addTransition as addTransitionAction } from '../../timeline/actions/transitions.svelte';
import { buildClipRefs, resolveClipRefs, resolveItemRef, resolveTargetItems } from '../clip-refs';
import { searchTimelineTranscript } from '../transcript-search';
import type {
	EditorAgentTool,
	JsonObject,
	JsonSchema,
	JsonSchemaProperty,
	JsonValue,
	ToolResult,
	ToolValidation
} from '../types';
import type { TimelineItem } from '../../project/types';
import type { TransitionPresentation } from '../../transitions/types';

function makeValidate<S extends z.ZodTypeAny>(schema: S): (args: JsonValue) => ToolValidation {
	return (args) => {
		const result = schema.safeParse(args ?? {});
		if (result.success) {
			// SAFETY: every tool schema in this module parses an object with JSON-safe fields.
			return { ok: true, value: result.data as JsonObject };
		}
		const issue = result.error.issues[0];
		const path = issue?.path.join('.') || 'args';
		return { ok: false, error: `${path}: ${issue?.message ?? 'invalid'}` };
	};
}

function defineTool<S extends z.ZodTypeAny>(def: {
	name: string;
	title: string;
	description: string;
	inputSchema: JsonSchema;
	readOnly?: boolean;
	destructive?: boolean;
	handoff?: boolean;
	schema: S;
	summarize: (args: z.infer<S>) => string;
	execute: (args: z.infer<S>) => Promise<ToolResult> | ToolResult;
}): EditorAgentTool {
	return {
		name: def.name,
		title: def.title,
		description: def.description,
		inputSchema: def.inputSchema,
		readOnly: def.readOnly ?? false,
		destructive: def.destructive ?? false,
		handoff: def.handoff ?? false,
		validate: makeValidate(def.schema),
		// SAFETY: makeValidate stores only output parsed by the same schema.
		summarize: (args) => def.summarize(args as z.infer<S>),
		// SAFETY: makeValidate stores only output parsed by the same schema.
		execute: (args) => def.execute(args as z.infer<S>)
	};
}

function objSchema(
	properties: Record<string, JsonSchemaProperty>,
	required: string[] = []
): JsonSchema {
	return { type: 'object', properties, required, additionalProperties: false };
}

const CLIPS_PROP = {
	type: 'array',
	items: { type: 'string' },
	description:
		'Clip refs like ["c1","c3"] from the timeline list. Omit to use the current selection.'
};

const clipsField = z.array(z.string()).optional();

function getFps(): number {
	return timelineStore.fps;
}

function isMedia(item: TimelineItem): boolean {
	return item.type === 'video' || item.type === 'audio';
}

const TRANSITION_TYPES = [
	'crossfade',
	'fade',
	'dissolve',
	'wipe',
	'slide',
	'flip'
] as const satisfies readonly TransitionPresentation[];

type TransitionType = (typeof TRANSITION_TYPES)[number];

function isTransitionType(value: string): value is TransitionType {
	return z.enum(TRANSITION_TYPES).safeParse(value).success;
}

let handoffHandlers: {
	openSilenceReview?: (itemIds: string[]) => void;
	openFillerReview?: (itemIds: string[]) => void;
} | null = null;

export function setAgentHandoffHandlers(handlers: {
	openSilenceReview?: (itemIds: string[]) => void;
	openFillerReview?: (itemIds: string[]) => void;
}): void {
	handoffHandlers = handlers;
}

function cleanupTargetIds(clips: string[] | undefined): string[] {
	const targeted = resolveTargetItems(clips).filter(isMedia);
	if (targeted.length > 0) return targeted.map((item) => item.id);
	return timelineStore.items.filter(isMedia).map((item) => item.id);
}

const findClips = defineTool({
	name: 'find_clips',
	title: 'Find clips',
	description:
		'List clips on the timeline, optionally filtered by type or a label substring. Returns their refs so other tools can target them.',
	inputSchema: objSchema({
		query: {
			type: 'string',
			description: 'Case-insensitive substring to match against clip labels.'
		},
		type: {
			type: 'string',
			enum: ['video', 'audio', 'text', 'image', 'shape'],
			description: 'Restrict to one clip type.'
		}
	}),
	readOnly: true,
	schema: z.object({
		query: z.string().optional(),
		type: z.enum(['video', 'audio', 'text', 'image', 'shape']).optional()
	}),
	summarize: () => m.video_editor_agent_plan_find_clips(),
	execute: (args) => {
		const query = args.query?.toLowerCase();
		const matches = buildClipRefs().filter((clip) => {
			if (args.type && clip.type !== args.type) return false;
			if (query && !clip.label.toLowerCase().includes(query)) return false;
			return true;
		});
		const summary =
			matches.map((clip) => `${clip.ref} ${clip.type} "${clip.label}"`).join('; ') ||
			m.video_editor_agent_tool_find_clips_none();
		return {
			ok: true,
			message: m.video_editor_agent_tool_find_clips_found({ count: matches.length, summary }),
			data: matches
		};
	}
});

const searchTranscript = defineTool({
	name: 'search_transcript',
	title: 'Search spoken words',
	description:
		'Search what is SAID in the video/audio for a word or phrase. Returns matching clip refs and timecodes. Use this FIRST to locate content the user describes before editing around it.',
	inputSchema: objSchema(
		{ query: { type: 'string', description: 'A word or phrase spoken in the media.' } },
		['query']
	),
	readOnly: true,
	schema: z.object({ query: z.string().min(1) }),
	summarize: (args) => m.video_editor_agent_plan_search_transcript({ query: args.query }),
	execute: async (args) => {
		const matches = await searchTimelineTranscript(args.query);
		buildClipRefs();
		if (matches.length === 0) {
			return {
				ok: true,
				message: m.video_editor_agent_tool_search_no_match({ query: args.query }),
				data: []
			};
		}
		const lines = matches.map((match) => {
			const ref = resolveItemRef(match.itemId) ?? '?';
			return `${ref} @${match.timelineSeconds.toFixed(1)}s "${match.snippet}"`;
		});
		return {
			ok: true,
			message: m.video_editor_agent_tool_search_found({
				query: args.query,
				lines: lines.join('; ')
			}),
			data: matches
		};
	}
});

const selectClips = defineTool({
	name: 'select_clips',
	title: 'Select clips',
	description: 'Select the given clips so later actions and the UI focus on them.',
	inputSchema: objSchema({ clips: CLIPS_PROP }, ['clips']),
	schema: z.object({ clips: z.array(z.string()).min(1) }),
	summarize: (args) => m.video_editor_agent_plan_select({ clips: args.clips.join(', ') }),
	execute: (args) => {
		const ids = resolveClipRefs(args.clips);
		if (ids.length === 0) throw new Error(m.video_editor_agent_error_no_clip_refs());
		if (selectionHandler) selectionHandler(ids);
		return {
			ok: true,
			message:
				ids.length === 1
					? m.video_editor_agent_tool_select({ count: ids.length })
					: m.video_editor_agent_tool_select_plural({ count: ids.length })
		};
	}
});

let selectionHandler: ((ids: string[]) => void) | null = null;
export function setAgentSelectionHandler(handler: ((ids: string[]) => void) | null): void {
	selectionHandler = handler;
}

const seekTo = defineTool({
	name: 'seek_to',
	title: 'Move playhead',
	description: 'Move the playhead to a time in seconds.',
	inputSchema: objSchema({ seconds: { type: 'number', minimum: 0 } }, ['seconds']),
	schema: z.object({ seconds: z.number().min(0) }),
	summarize: (args) => m.video_editor_agent_plan_seek({ seconds: args.seconds.toFixed(1) }),
	execute: (args) => {
		setCurrentFrame(Math.round(args.seconds * getFps()));
		return {
			ok: true,
			message: m.video_editor_agent_tool_seek({ seconds: args.seconds.toFixed(1) })
		};
	}
});

const addTitle = defineTool({
	name: 'add_title',
	title: 'Add title',
	description: 'Add a text/title layer at the playhead (or at a given time).',
	inputSchema: objSchema(
		{
			text: { type: 'string', description: 'Title text.' },
			atSeconds: {
				type: 'number',
				minimum: 0,
				description: 'Start time; defaults to the playhead.'
			}
		},
		['text']
	),
	schema: z.object({ text: z.string().min(1).max(300), atSeconds: z.number().min(0).optional() }),
	summarize: (args) => m.video_editor_agent_plan_add_title({ text: args.text.slice(0, 40) }),
	execute: (args) => {
		const fps = getFps();
		if (timelineStore.tracks.length === 0) throw new Error(m.video_editor_agent_error_no_media());
		const from =
			args.atSeconds !== undefined ? Math.round(args.atSeconds * fps) : timelineStore.currentFrame;
		const id = addTextItemAtFrame(args.text, from);
		if (selectionHandler) selectionHandler([id]);
		return {
			ok: true,
			message: m.video_editor_agent_tool_add_title({ text: args.text.slice(0, 40) })
		};
	}
});

const split = defineTool({
	name: 'split',
	title: 'Split clips',
	description:
		'Split clips at a time (default playhead). Targets the given clips, else the selection, else all clips crossing that time.',
	inputSchema: objSchema({
		clips: CLIPS_PROP,
		atSeconds: { type: 'number', minimum: 0, description: 'Split time; defaults to the playhead.' }
	}),
	schema: z.object({ clips: clipsField, atSeconds: z.number().min(0).optional() }),
	summarize: (args) =>
		args.atSeconds !== undefined
			? m.video_editor_agent_plan_split_time({ seconds: args.atSeconds.toFixed(1) })
			: m.video_editor_agent_plan_split_playhead(),
	execute: (args) => {
		const frame =
			args.atSeconds !== undefined
				? Math.round(args.atSeconds * getFps())
				: timelineStore.currentFrame;
		const targeted = resolveTargetItems(args.clips);
		const pool = targeted.length > 0 ? targeted : timelineStore.items;
		const crossing = pool.filter(
			(item) => frame > item.from && frame < item.from + item.durationInFrames
		);
		if (crossing.length === 0) throw new Error(m.video_editor_agent_error_no_crossing());
		const result = splitItemsAtFrame(
			frame,
			crossing.map((item) => item.id)
		);
		const count = result.right.length;
		if (count === 0) throw new Error(m.video_editor_agent_error_no_clips_cross());
		return {
			ok: true,
			message:
				count === 1
					? m.video_editor_agent_tool_split({ count })
					: m.video_editor_agent_tool_split_plural({ count })
		};
	}
});

const deleteClips = defineTool({
	name: 'delete_clips',
	title: 'Delete clips',
	description: 'Ripple-delete the given clips, closing the gaps so later clips shift back.',
	inputSchema: objSchema({ clips: CLIPS_PROP }, ['clips']),
	destructive: true,
	schema: z.object({ clips: z.array(z.string()).min(1) }),
	summarize: (args) => m.video_editor_agent_plan_delete({ clips: args.clips.join(', ') }),
	execute: (args) => {
		const items = resolveTargetItems(args.clips);
		if (items.length === 0) throw new Error(m.video_editor_agent_error_no_clip_refs());
		rippleDeleteItems(
			items.map((item) => item.id),
			timelineStore.linkedSelectionEnabled
		);
		return {
			ok: true,
			message:
				items.length === 1
					? m.video_editor_agent_tool_delete({ count: items.length })
					: m.video_editor_agent_tool_delete_plural({ count: items.length })
		};
	}
});

const setSpeed = defineTool({
	name: 'set_speed',
	title: 'Set speed',
	description: 'Change playback speed of video/audio clips. 1 = normal, 2 = double, 0.5 = half.',
	inputSchema: objSchema(
		{ clips: CLIPS_PROP, speed: { type: 'number', minimum: 0.1, maximum: 10 } },
		['speed']
	),
	schema: z.object({ clips: clipsField, speed: z.number().min(0.1).max(10) }),
	summarize: (args) => m.video_editor_agent_plan_set_speed({ speed: args.speed }),
	execute: (args) => {
		const media = resolveTargetItems(args.clips).filter(isMedia);
		if (media.length === 0) throw new Error(m.video_editor_agent_error_no_media());
		const result = setItemsSpeed(
			media.map((item) => item.id),
			args.speed
		);
		if (result.locked > 0) throw new Error(m.video_editor_agent_error_locked_tracks());
		if (result.changed === 0) {
			if (result.noop > 0) throw new Error(m.video_editor_agent_error_already_at_speed());
			throw new Error(m.video_editor_agent_error_no_change());
		}
		return {
			ok: true,
			message:
				result.changed === 1
					? m.video_editor_agent_tool_set_speed({ count: result.changed, speed: args.speed })
					: m.video_editor_agent_tool_set_speed_plural({
							count: result.changed,
							speed: args.speed
						})
		};
	}
});

const setVolume = defineTool({
	name: 'set_volume',
	title: 'Set volume',
	description: 'Set the volume of video/audio clips (0 = mute, 1 = full).',
	inputSchema: objSchema(
		{ clips: CLIPS_PROP, volume: { type: 'number', minimum: 0, maximum: 1 } },
		['volume']
	),
	schema: z.object({ clips: clipsField, volume: z.number().min(0).max(1) }),
	summarize: (args) =>
		m.video_editor_agent_plan_set_volume({ volume: Math.round(args.volume * 100) }),
	execute: (args) => {
		const media = resolveTargetItems(args.clips).filter(isMedia);
		if (media.length === 0) throw new Error(m.video_editor_agent_error_no_media());
		const result = setItemsVolume(
			media.map((item) => item.id),
			args.volume
		);
		if (result.locked > 0) throw new Error(m.video_editor_agent_error_locked_tracks());
		if (result.changed === 0) throw new Error(m.video_editor_agent_error_no_change());
		return {
			ok: true,
			message:
				result.changed === 1
					? m.video_editor_agent_tool_set_volume({
							count: result.changed,
							volume: Math.round(args.volume * 100)
						})
					: m.video_editor_agent_tool_set_volume_plural({
							count: result.changed,
							volume: Math.round(args.volume * 100)
						})
		};
	}
});

const trimClip = defineTool({
	name: 'trim_clip',
	title: 'Trim clip',
	description: 'Trim seconds off the start or end of a single clip.',
	inputSchema: objSchema(
		{
			clip: { type: 'string', description: 'A single clip ref, e.g. "c2".' },
			side: { type: 'string', enum: ['start', 'end'] },
			seconds: { type: 'number', minimum: 0 }
		},
		['clip', 'side', 'seconds']
	),
	schema: z.object({
		clip: z.string(),
		side: z.enum(['start', 'end']),
		seconds: z.number().min(0)
	}),
	summarize: (args) =>
		args.side === 'start'
			? m.video_editor_agent_plan_trim_start({
					seconds: args.seconds.toFixed(1),
					clip: args.clip
				})
			: m.video_editor_agent_plan_trim_end({
					seconds: args.seconds.toFixed(1),
					clip: args.clip
				}),
	execute: (args) => {
		const [item] = resolveTargetItems([args.clip]);
		if (!item) throw new Error(m.video_editor_agent_error_no_clip({ clip: args.clip }));
		const fps = getFps();
		const frames = Math.round(args.seconds * fps);
		if (frames <= 0) throw new Error(m.video_editor_agent_error_trim_zero());
		const trackLocked = timelineStore.tracks.find((track) => track.id === item.trackId)?.locked;
		if (trackLocked) throw new Error(m.video_editor_agent_error_locked_tracks());
		const sourceFps = item.sourceFps ?? fps;
		const speed = item.speed ?? 1;
		const sourceDelta = timelineToSourceFrames(frames, speed, fps, sourceFps);
		if (args.side === 'start') {
			const newFrom = item.from + frames;
			const newSourceStart = (item.sourceStart ?? 0) + sourceDelta;
			const ok = trimItemStart(item.id, newFrom, newSourceStart);
			if (!ok) throw new Error(m.video_editor_agent_error_cannot_trim_start());
		} else {
			const newEnd = item.from + item.durationInFrames - frames;
			const newSourceEnd = item.sourceEnd !== undefined ? item.sourceEnd - sourceDelta : undefined;
			const ok = trimItemEnd(item.id, newEnd, newSourceEnd);
			if (!ok) throw new Error(m.video_editor_agent_error_cannot_trim_end());
		}
		return {
			ok: true,
			message: m.video_editor_agent_tool_trim({
				seconds: args.seconds.toFixed(1),
				side: args.side,
				clip: args.clip
			})
		};
	}
});

const addTransition = defineTool({
	name: 'add_transition',
	title: 'Add transition',
	description: 'Add a transition between exactly two adjacent clips on the same track.',
	inputSchema: objSchema({
		clips: {
			...CLIPS_PROP,
			description: 'Exactly two adjacent clip refs. Omit to use the current selection.'
		},
		type: { type: 'string', enum: [...TRANSITION_TYPES] },
		durationSeconds: { type: 'number', minimum: 0.1, maximum: 5 }
	}),
	schema: z.object({
		clips: clipsField,
		type: z.enum(TRANSITION_TYPES).optional(),
		durationSeconds: z.number().min(0.1).max(5).optional()
	}),
	summarize: () => m.video_editor_agent_plan_add_transition(),
	execute: (args) => {
		const targets = resolveTargetItems(args.clips);
		if (targets.length !== 2) throw new Error(m.video_editor_agent_error_two_clips_required());
		const a = targets[0];
		const b = targets[1];
		if (!a || !b) throw new Error(m.video_editor_agent_error_two_clips_required());
		if (a.trackId !== b.trackId) throw new Error(m.video_editor_agent_error_same_track_required());
		const [left, right] = a.from <= b.from ? [a, b] : [b, a];
		const fps = getFps();
		const durationInFrames = args.durationSeconds
			? Math.max(1, Math.round(args.durationSeconds * fps))
			: undefined;
		const requestedType = args.type;
		if (requestedType !== undefined && !isTransitionType(requestedType)) {
			throw new Error(m.video_editor_agent_error_unknown_transition({ type: requestedType }));
		}
		const type: TransitionPresentation = requestedType ?? 'crossfade';
		const id = addTransitionAction(left.id, right.id, type, durationInFrames);
		if (!id) throw new Error(m.video_editor_agent_error_transition_failed());
		return {
			ok: true,
			message: requestedType
				? m.video_editor_agent_tool_add_transition({ type: requestedType })
				: m.video_editor_agent_tool_add_transition_default()
		};
	}
});

const removeSilence = defineTool({
	name: 'remove_silence',
	title: 'Remove silences',
	description:
		'Open the silence-removal review for the given clips (or all). The user previews and confirms the cuts.',
	inputSchema: objSchema({ clips: CLIPS_PROP }),
	handoff: true,
	schema: z.object({ clips: clipsField }),
	summarize: () => m.video_editor_agent_plan_review_silence(),
	execute: (args) => {
		const itemIds = cleanupTargetIds(args.clips);
		if (itemIds.length === 0) throw new Error(m.video_editor_agent_error_no_clips_to_analyze());
		if (handoffHandlers?.openSilenceReview) handoffHandlers.openSilenceReview(itemIds);
		else throw new Error(m.video_editor_agent_error_silence_unavailable());
		return { ok: true, message: m.video_editor_agent_tool_remove_silence() };
	}
});

const removeFillers = defineTool({
	name: 'remove_fillers',
	title: 'Remove filler words',
	description:
		'Open the filler-word review for the given clips (or all). The user previews and confirms.',
	inputSchema: objSchema({ clips: CLIPS_PROP }),
	handoff: true,
	schema: z.object({ clips: clipsField }),
	summarize: () => m.video_editor_agent_plan_review_fillers(),
	execute: (args) => {
		const itemIds = cleanupTargetIds(args.clips);
		if (itemIds.length === 0) throw new Error(m.video_editor_agent_error_no_clips_to_analyze());
		if (handoffHandlers?.openFillerReview) handoffHandlers.openFillerReview(itemIds);
		else throw new Error(m.video_editor_agent_error_filler_unavailable());
		return { ok: true, message: m.video_editor_agent_tool_remove_fillers() };
	}
});

export const EDITOR_TOOLS: readonly EditorAgentTool[] = [
	findClips,
	searchTranscript,
	selectClips,
	seekTo,
	addTitle,
	split,
	deleteClips,
	setSpeed,
	setVolume,
	trimClip,
	addTransition,
	removeSilence,
	removeFillers
];
