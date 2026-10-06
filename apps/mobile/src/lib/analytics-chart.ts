export function trendBars(values: readonly number[], width: number, height: number) {
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  const range = maximum - minimum || 1;
  const baseline = (maximum / range) * height;
  const stride = width / Math.max(1, values.length);
  return {
    baseline,
    bars: values.map((value, index) => ({
      x: index * stride,
      y: baseline - (Math.max(0, value) / range) * height,
      width: Math.max(1, stride - 2),
      height: (Math.abs(value) / range) * height,
    })),
  };
}
