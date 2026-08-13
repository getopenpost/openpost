import legalChangeHistoryManifest from "./legal-change-history.json" with { type: "json" };
import manifest from "./manifest.json" with { type: "json" };
import managedServiceManifest from "./managed-service.json" with { type: "json" };
import privacyInventoryManifest from "./privacy-inventory.json" with { type: "json" };
import securityAssuranceManifest from "./security-assurance.json" with { type: "json" };

export const legalPolicy = Object.freeze(manifest);
export const managedService = Object.freeze(managedServiceManifest);
export const privacyInventory = Object.freeze(privacyInventoryManifest);
export const legalChangeHistory = Object.freeze(legalChangeHistoryManifest);
export const securityAssurance = Object.freeze(securityAssuranceManifest);

export function formatLegalDate(value, locale = "en-GB") {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`invalid legal date ${value}`);
  }
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function formatPolicyEffectiveDate(policy, locale = "en-GB") {
  return formatLegalDate(policy.effective_date, locale);
}
