import type { InvalidateQueryFilters, QueryFilters } from "@tanstack/query-core";

export interface QueryCachePlan {
  readonly invalidate: readonly InvalidateQueryFilters[];
  readonly remove?: readonly QueryFilters[];
}
