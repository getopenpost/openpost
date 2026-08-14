import { describe, expect, it } from "vitest";
import {
  billingPeriods,
  hostedPlanDefinition,
  hostedPlanIDs,
  planCatalog,
  selfHostedDeployment,
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

  it("keeps self-hosting outside the hosted plan catalogue", () => {
    expect(selfHostedDeployment).toEqual({
      software_fee_usd: 0,
      documentation_url: "https://docs.openpost.social/self-hosting/",
      production_checklist_url: "https://docs.openpost.social/configuration/production-checklist",
      source_url: "https://github.com/getopenpost/openpost",
    });
    expect(planCatalog.plans).not.toContainEqual(expect.objectContaining({ id: "self-hosted" }));
  });
});
