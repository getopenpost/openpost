import { describe, expect, it } from "vitest";
import {
  billingPeriods,
  hostedPlanDefinition,
  hostedPlanIDs,
  planCatalog,
} from "./index";

describe("plan catalogue", () => {
  it("defines every hosted plan and billing period without an implicit fallback", () => {
    expect(planCatalog.plans.map((plan) => plan.id)).toEqual(hostedPlanIDs);
    expect(billingPeriods).toEqual(["monthly", "annual"]);
    expect(hostedPlanDefinition("missing")).toBeUndefined();
  });

  it("keeps purchase terms and prices complete", () => {
    expect(planCatalog.purchase_terms).toEqual({
      trial_days: 14,
      card_required: true,
      due_today_usd: 0,
    });
    for (const plan of planCatalog.plans) {
      expect(plan.monthly_price_usd).toBeGreaterThan(0);
      expect(plan.annual_price_usd).toBeGreaterThan(plan.monthly_price_usd);
    }
  });
});
