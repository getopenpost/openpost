import type { TimelineItem } from '../project/types';
import type { AudioEqSettings, ResolvedAudioEqSettings } from './types';

export const AUDIO_EQ_SLOPE_OPTIONS = [6, 12, 18, 24] as const;
export const AUDIO_EQ_BAND1_FILTER_OPTIONS = [
	'low-shelf',
	'peaking',
	'high-shelf',
	'high-pass'
] as const;
export const AUDIO_EQ_INNER_FILTER_OPTIONS = [
	'low-shelf',
	'peaking',
	'high-shelf',
	'notch'
] as const;
export const AUDIO_EQ_BAND6_FILTER_OPTIONS = [
	'low-pass',
	'low-shelf',
	'peaking',
	'high-shelf'
] as const;

const TIMELINE_EQ_FIELD_BY_SETTING = {
	enabled: 'audioEqEnabled',
	outputGainDb: 'audioEqOutputGainDb',
	band1Enabled: 'audioEqBand1Enabled',
	band1Type: 'audioEqBand1Type',
	band1FrequencyHz: 'audioEqBand1FrequencyHz',
	band1GainDb: 'audioEqBand1GainDb',
	band1Q: 'audioEqBand1Q',
	band1SlopeDbPerOct: 'audioEqBand1SlopeDbPerOct',
	lowCutEnabled: 'audioEqLowCutEnabled',
	lowCutFrequencyHz: 'audioEqLowCutFrequencyHz',
	lowCutSlopeDbPerOct: 'audioEqLowCutSlopeDbPerOct',
	lowEnabled: 'audioEqLowEnabled',
	lowType: 'audioEqLowType',
	lowGainDb: 'audioEqLowGainDb',
	lowFrequencyHz: 'audioEqLowFrequencyHz',
	lowQ: 'audioEqLowQ',
	lowMidEnabled: 'audioEqLowMidEnabled',
	lowMidType: 'audioEqLowMidType',
	lowMidGainDb: 'audioEqLowMidGainDb',
	lowMidFrequencyHz: 'audioEqLowMidFrequencyHz',
	lowMidQ: 'audioEqLowMidQ',
	midGainDb: 'audioEqMidGainDb',
	highMidEnabled: 'audioEqHighMidEnabled',
	highMidType: 'audioEqHighMidType',
	highMidGainDb: 'audioEqHighMidGainDb',
	highMidFrequencyHz: 'audioEqHighMidFrequencyHz',
	highMidQ: 'audioEqHighMidQ',
	highEnabled: 'audioEqHighEnabled',
	highType: 'audioEqHighType',
	highGainDb: 'audioEqHighGainDb',
	highFrequencyHz: 'audioEqHighFrequencyHz',
	highQ: 'audioEqHighQ',
	band6Enabled: 'audioEqBand6Enabled',
	band6Type: 'audioEqBand6Type',
	band6FrequencyHz: 'audioEqBand6FrequencyHz',
	band6GainDb: 'audioEqBand6GainDb',
	band6Q: 'audioEqBand6Q',
	band6SlopeDbPerOct: 'audioEqBand6SlopeDbPerOct',
	highCutEnabled: 'audioEqHighCutEnabled',
	highCutFrequencyHz: 'audioEqHighCutFrequencyHz',
	highCutSlopeDbPerOct: 'audioEqHighCutSlopeDbPerOct'
} as const satisfies Record<keyof AudioEqSettings, keyof TimelineItem>;

export function buildTimelineEqPatchFromSettings(
	settings: Partial<AudioEqSettings>
): Partial<TimelineItem> {
	const patch: Partial<TimelineItem> = {};
	// SAFETY: Object.entries returns only keys from the typed partial settings object.
	for (const [key, value] of Object.entries(settings) as Array<
		[keyof AudioEqSettings, AudioEqSettings[keyof AudioEqSettings]]
	>) {
		Object.assign(patch, { [TIMELINE_EQ_FIELD_BY_SETTING[key]]: value });
	}
	return patch;
}

export function buildTimelineEqPatchFromResolvedSettings(
	settings: ResolvedAudioEqSettings
): Partial<TimelineItem> {
	return {
		audioEqOutputGainDb: settings.outputGainDb,
		audioEqBand1Enabled: settings.band1Enabled,
		audioEqBand1Type: settings.band1Type,
		audioEqBand1FrequencyHz: settings.band1FrequencyHz,
		audioEqBand1GainDb: settings.band1GainDb,
		audioEqBand1Q: settings.band1Q,
		audioEqBand1SlopeDbPerOct: settings.band1SlopeDbPerOct,
		audioEqLowCutEnabled: settings.lowCutEnabled,
		audioEqLowCutFrequencyHz: settings.lowCutFrequencyHz,
		audioEqLowCutSlopeDbPerOct: settings.lowCutSlopeDbPerOct,
		audioEqLowEnabled: settings.lowEnabled,
		audioEqLowType: settings.lowType,
		audioEqLowGainDb: settings.lowGainDb,
		audioEqLowFrequencyHz: settings.lowFrequencyHz,
		audioEqLowQ: settings.lowQ,
		audioEqLowMidEnabled: settings.lowMidEnabled,
		audioEqLowMidType: settings.lowMidType,
		audioEqLowMidGainDb: settings.lowMidGainDb,
		audioEqLowMidFrequencyHz: settings.lowMidFrequencyHz,
		audioEqLowMidQ: settings.lowMidQ,
		audioEqMidGainDb: 0,
		audioEqHighMidEnabled: settings.highMidEnabled,
		audioEqHighMidType: settings.highMidType,
		audioEqHighMidGainDb: settings.highMidGainDb,
		audioEqHighMidFrequencyHz: settings.highMidFrequencyHz,
		audioEqHighMidQ: settings.highMidQ,
		audioEqHighEnabled: settings.highEnabled,
		audioEqHighType: settings.highType,
		audioEqHighGainDb: settings.highGainDb,
		audioEqHighFrequencyHz: settings.highFrequencyHz,
		audioEqHighQ: settings.highQ,
		audioEqBand6Enabled: settings.band6Enabled,
		audioEqBand6Type: settings.band6Type,
		audioEqBand6FrequencyHz: settings.band6FrequencyHz,
		audioEqBand6GainDb: settings.band6GainDb,
		audioEqBand6Q: settings.band6Q,
		audioEqBand6SlopeDbPerOct: settings.band6SlopeDbPerOct,
		audioEqHighCutEnabled: settings.highCutEnabled,
		audioEqHighCutFrequencyHz: settings.highCutFrequencyHz,
		audioEqHighCutSlopeDbPerOct: settings.highCutSlopeDbPerOct
	};
}
