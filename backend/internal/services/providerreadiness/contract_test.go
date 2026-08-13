package providerreadiness

import (
	"slices"
	"strings"
	"testing"
)

func TestCertificationContractDigestIsOrderIndependent(t *testing.T) {
	t.Parallel()

	contract := healthyInput().Contract
	want, err := contract.Digest()
	if err != nil {
		t.Fatal(err)
	}
	slices.Reverse(contract.Requirements.RequiredScopes)
	slices.Reverse(contract.Requirements.RequiredLocalChecks)
	slices.Reverse(contract.Requirements.RequiredLiveChecks)
	got, err := contract.Digest()
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("equivalent contract digest = %q, want %q", got, want)
	}
}

func TestCertificationContractDigestNormalizesEmptySets(t *testing.T) {
	t.Parallel()

	contract := CertificationContract{
		SchemaVersion:    CertificationContractSchemaVersion,
		CapabilityDigest: "sha256:" + strings.Repeat("a", 64),
		PolicyDigest:     "sha256:" + strings.Repeat("b", 64),
	}
	nilDigest, err := contract.Digest()
	if err != nil {
		t.Fatal(err)
	}
	contract.Requirements.RequiredScopes = []string{}
	contract.Requirements.RequiredLocalChecks = []CheckRequirement{}
	contract.Requirements.RequiredLiveChecks = []CheckRequirement{}
	emptyDigest, err := contract.Digest()
	if err != nil {
		t.Fatal(err)
	}
	if emptyDigest != nilDigest {
		t.Fatalf("empty set digest = %q, want %q", emptyDigest, nilDigest)
	}
}

func TestCertificationContractDigestTracksCapabilityPolicyAndRequirements(t *testing.T) {
	t.Parallel()

	base := healthyInput().Contract
	want, err := base.Digest()
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name   string
		mutate func(*CertificationContract)
	}{
		{
			name: "capability source",
			mutate: func(contract *CertificationContract) {
				contract.CapabilityDigest = "sha256:" + strings.Repeat("e", 64)
			},
		},
		{
			name: "policy source",
			mutate: func(contract *CertificationContract) {
				contract.PolicyDigest = "sha256:" + strings.Repeat("e", 64)
			},
		},
		{
			name: "scope requirement",
			mutate: func(contract *CertificationContract) {
				contract.Requirements.RequiredScopes = append(contract.Requirements.RequiredScopes, "offline.access")
			},
		},
		{
			name: "execution gate",
			mutate: func(contract *CertificationContract) {
				contract.Requirements.RequireExactRevision = true
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			contract := healthyInput().Contract
			test.mutate(&contract)
			got, err := contract.Digest()
			if err != nil {
				t.Fatal(err)
			}
			if got == want {
				t.Fatalf("contract change retained digest %q", got)
			}
		})
	}
}

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
