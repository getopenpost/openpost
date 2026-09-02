import type { QueryFilters } from "@tanstack/query-core";

export interface QueryCachePlan {
  readonly invalidate: readonly QueryFilters[];
  readonly remove?: readonly QueryFilters[];
}
