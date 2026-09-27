import { getLocale } from '$lib/paraglide/runtime';
import { z } from 'zod';
import type { components } from '$lib/api/types';
import type { ComposerSettings } from './modes';
type SettingDefinition = components['schemas']['SettingDefinition'];

const pollContentSchema = z.object({
	question: z.string(),
	options: z.array(z.object({ id: z.string(), text: z.string() })),
	duration_seconds: z.number(),
	multiple: z.boolean().optional(),
	hide_totals: z.boolean().optional()
});
export const sharedPollSchema = pollContentSchema.extend({
	destinations: z.record(
		z.string(),
		z.object({
			mode: z.enum(['native', 'text', 'omit', 'custom', 'legacy']),
			poll: pollContentSchema.optional()
		})
	)
});
export type PollContent = z.infer<typeof pollContentSchema>;
export type SharedPoll = z.infer<typeof sharedPollSchema>;
export type PollMode = SharedPoll['destinations'][string]['mode'];
export interface PollDestination {
	id: string;
	label: string;
	fields: SettingDefinition[];
	body: string;
	error?: string;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Parses persisted API and draft JSON at the composer input boundary.
export function readSharedPoll(settings: unknown): SharedPoll | undefined {
	const result = z.object({ poll: sharedPollSchema }).safeParse(settings);
	return result.success ? result.data.poll : undefined;
}

export function supportsNativePoll(fields: SettingDefinition[]): boolean {
	return fields.some((field) => field.key === 'poll_options' && !field.unavailable_reason);
}

export function clearPollSettings(settings: ComposerSettings): ComposerSettings {
	return Object.fromEntries(Object.entries(settings).filter(([key]) => !key.startsWith('poll_')));
}

// Preview uses the same authored choices as the server. Provider validation remains authoritative.
export function resolvePollPreview(
	poll: SharedPoll | undefined,
	accountID: string,
	fields: SettingDefinition[],
	body: string,
	settings: ComposerSettings
) {
	if (!poll || poll.destinations[accountID]?.mode === 'legacy') return { body, settings };
	const values = clearPollSettings(settings);
	const choice = poll.destinations[accountID];
	if (!choice || choice.mode === 'omit') return { body, settings: values };
	const content = choice.mode === 'custom' ? choice.poll : poll;
	if (!content) return { body, settings: values };
	const question = content.question.trim();
	const append = (text: string) => [body.trim(), text].filter(Boolean).join('\n\n');
	if (choice.mode === 'text')
		return {
			body: append(
				[
					question,
					...content.options.map((option, index) => `${index + 1}. ${option.text.trim()}`)
				].join('\n')
			),
			settings: values
		};
	const has = (key: string) => fields.some((field) => field.key === key);
	if (!supportsNativePoll(fields)) return { body, settings: values };
	values.poll_options = content.options.map((option) => option.text.trim()).join('\n');
	if (has('poll_question')) values.poll_question = question;
	else body = append(question);
	if (has('poll_duration_minutes')) values.poll_duration_minutes = content.duration_seconds / 60;
	if (has('poll_expires_in_seconds')) values.poll_expires_in_seconds = content.duration_seconds;
	if (has('poll_duration'))
		values.poll_duration =
			new Map([
				[86400, 'ONE_DAY'],
				[259200, 'THREE_DAYS'],
				[604800, 'SEVEN_DAYS'],
				[1209600, 'FOURTEEN_DAYS']
			]).get(content.duration_seconds) ?? '';
	if (has('poll_multiple')) values.poll_multiple = Boolean(content.multiple);
	if (has('poll_hide_totals')) values.poll_hide_totals = Boolean(content.hide_totals);
	return { body, settings: values };
}

export function pollDurationLabel(seconds: number): string {
	const unit = seconds % 86400 === 0 ? 'day' : seconds % 3600 === 0 ? 'hour' : 'minute';
	const divisor = unit === 'day' ? 86400 : unit === 'hour' ? 3600 : 60;
	return new Intl.NumberFormat(getLocale(), { style: 'unit', unit, unitDisplay: 'long' }).format(
		seconds / divisor
	);
}
