package billing

// GetPlanConfig returns the plan configuration for the given plan ID.
func GetPlanConfig(planID string) (PlanConfig, bool) {
	plan, ok := canonicalPlanCatalog[planID]
	return plan, ok
}
