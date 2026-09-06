export type ColdQueryState = {
  hasData: boolean;
  isError: boolean;
  isPending: boolean;
};

export function initialQueryBoundaryPending(states: readonly ColdQueryState[]): boolean {
  return states.some((state) => !state.hasData && !state.isError && state.isPending);
}
