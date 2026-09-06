export function paddedMetricDomain(values: number[]): [number, number] {
	const finiteValues = values.filter(Number.isFinite);
	if (finiteValues.length === 0) return [0, 1];

	const minimum = Math.min(...finiteValues);
	const maximum = Math.max(...finiteValues);
	const span = maximum - minimum;
	const padding =
		span > 0
			? Math.max(1, Math.ceil(span * 0.12))
			: Math.max(1, Math.ceil(Math.abs(maximum) * 0.01));

	return [Math.max(0, minimum - padding), maximum + padding];
}
