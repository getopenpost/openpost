import { describe, expect, it } from "vitest";
import { billingPeriods, hostedPlanDefinition, planCatalog, selfHostedDeployment } from "./index";

describe("plan catalogue", () => {
  it("uses explicit billing periods without an implicit plan fallback", () => {
    expect(billingPeriods).toEqual(["monthly", "annual"]);
    expect(hostedPlanDefinition("missing")).toBeUndefined();
  });

  it("keeps purchase terms and prices complete", () => {
    expect(planCatalog.purchase_terms.trial_days).toBeGreaterThan(0);
    for (const plan of planCatalog.plans) {
      expect(plan.monthly_price_usd).toBeGreaterThan(0);
      expect(plan.annual_price_usd).toBeGreaterThan(plan.monthly_price_usd);
    }
  });

  it("keeps self-hosting outside the hosted plan catalogue", () => {
    expect(selfHostedDeployment.software_fee_usd).toBe(0);
    expect(planCatalog.plans).not.toContainEqual(expect.objectContaining({ id: "self-hosted" }));
  });
});
