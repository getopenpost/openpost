import rawCatalog from "./catalog.json";

export const hostedPlanIDs = ["starter", "founder", "pro", "team", "agency"] as const;
export const billingPeriods = ["monthly", "annual"] as const;

export type HostedPlanID = (typeof hostedPlanIDs)[number];
export type BillingPeriod = (typeof billingPeriods)[number];

export interface PlanLimits {
  workspaces: number;
  social_accounts: number;
  scheduled_posts_monthly: number;
  media_bytes_stored: number;
  media_bytes_uploaded_monthly: number;
  team_members: number;
}

export interface HostedPlanDefinition {
  id: HostedPlanID;
  name: string;
  description: string;
  best_for: string;
  monthly_price_usd: number;
  annual_price_usd: number;
  featured: boolean;
  limits: PlanLimits;
}

export interface PlanCatalog {
  version: string;
  purchase_terms: {
    trial_days: number;
    card_required: boolean;
    due_today_usd: number;
  };
  self_hosted: {
    software_fee_usd: 0;
    documentation_url: string;
    production_checklist_url: string;
    source_url: string;
  };
  plans: HostedPlanDefinition[];
}

export const planCatalog = rawCatalog as PlanCatalog;
export const purchaseTerms = planCatalog.purchase_terms;
export const selfHostedDeployment = planCatalog.self_hosted;

const planByID = new Map(planCatalog.plans.map((plan) => [plan.id, plan]));

export function hostedPlanDefinition(planID: string): HostedPlanDefinition | undefined {
  return planByID.get(planID as HostedPlanID);
}
