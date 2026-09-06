import type { Tooltip } from 'layerchart';
import { getContext, setContext, type Component, type Snippet } from 'svelte';

export const THEMES = { light: '', dark: '.dark' } as const;

export type ChartConfig = {
	[key in string]: {
		label?: string;
		icon?: Component;
	} & (
		| { color?: string; theme?: never }
		| { color?: never; theme: Record<keyof typeof THEMES, string> }
	);
};

export type ExtractSnippetParams<T> = T extends Snippet<[infer P]> ? P : never;
export type TooltipPayload = Tooltip.TooltipSeries;
type ChartTooltipDataValue = string | number | boolean | null | undefined;
export type ChartTooltipData = Record<string, ChartTooltipDataValue>;

type ChartLookupSource = { [key: string]: ChartTooltipDataValue | ChartLookupSource | undefined };

export function getPayloadConfigFromPayload(
	config: ChartConfig,
	payload: TooltipPayload,
	key: string,
	data?: ChartTooltipData | null
) {
	const payloadConfig = parseChartLookupSource(payload.config);

	let configLabelKey = key;
	if (payload.key === key) {
		configLabelKey = payload.key;
	} else if (payload.label === key) {
		configLabelKey = payload.label;
	} else {
		configLabelKey =
			parseChartLookupString(parseChartLookupSource(payload), key) ??
			parseChartLookupString(payloadConfig, key) ??
			parseChartDataString(data, key) ??
			configLabelKey;
	}

	return configLabelKey in config ? config[configLabelKey] : config[key];
}

function parseChartLookupSource(value: unknown): ChartLookupSource | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
	// SAFETY: The parser only uses string-key lookup and validates each read value before use.
	return value as ChartLookupSource;
}

function parseChartLookupString(
	source: ChartLookupSource | undefined | null,
	key: string
): string | undefined {
	if (!source || !Object.hasOwn(source, key)) return undefined;
	const value = source[key];
	return typeof value === 'string' ? value : undefined;
}

function parseChartDataString(
	source: ChartTooltipData | undefined | null,
	key: string
): string | undefined {
	if (!source || !Object.hasOwn(source, key)) return undefined;
	const value = source[key];
	return typeof value === 'string' ? value : undefined;
}

type ChartContextValue = {
	config: ChartConfig;
};

const chartContextKey = Symbol('chart-context');

export function setChartContext(value: ChartContextValue) {
	return setContext(chartContextKey, value);
}

export function useChart() {
	return getContext<ChartContextValue>(chartContextKey);
}
