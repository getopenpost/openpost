package providerreadiness

import (
	"testing"
)

func TestCertificationContractRejectsUnknownOrAmbiguousInputs(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		mutate func(*CertificationContract)
	}{
		{
			name: "unknown schema",
			mutate: func(contract *CertificationContract) {
				contract.SchemaVersion++
			},
		},
		{
			name: "invalid source digest",
			mutate: func(contract *CertificationContract) {
				contract.PolicyDigest = "main"
			},
		},
		{
			name: "duplicate scope",
			mutate: func(contract *CertificationContract) {
				contract.Requirements.RequiredScopes = append(contract.Requirements.RequiredScopes, contract.Requirements.RequiredScopes[0])
			},
		},
		{
			name: "unknown check",
			mutate: func(contract *CertificationContract) {
				contract.Requirements.RequiredLiveChecks = append(contract.Requirements.RequiredLiveChecks, CheckRequirement{Kind: CheckKind("unknown")})
			},
		},
		{
			name: "non-lifecycle check marked optionally applicable",
			mutate: func(contract *CertificationContract) {
				contract.Requirements.RequiredLiveChecks[0].AllowNotApplicable = true
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			contract := healthyInput().Contract
			test.mutate(&contract)
			if digest, err := contract.Digest(); err == nil {
				t.Fatalf("Digest() = %q, want error", digest)
			}
		})
	}
}
