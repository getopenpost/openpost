package platform

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestResolvePinterestTargetKeyUsesTypedBoardIdentity(t *testing.T) {
	t.Parallel()

	resolved, err := ResolveTargetKey("pinterest", "pinterest", "", map[string]interface{}{"board_id": "launches"})
	require.NoError(t, err)
	require.Equal(t, "pinterest:board:launches", resolved)

	_, err = ResolveTargetKey("pinterest", "pinterest", "pinterest:board:other", map[string]interface{}{"board_id": "launches"})
	require.ErrorContains(t, err, "does not match")
}

func TestPublishingTargetContractsRejectCrossProviderAndMalformedKeys(t *testing.T) {
	t.Parallel()

	cases := []struct {
		provider string
		valid    string
		cross    string
	}{
		{provider: "pinterest", valid: "pinterest:board:launch", cross: "telegram:chat:123"},
		{provider: "telegram", valid: "telegram:chat:-100123", cross: "discord:channel:123"},
		{provider: "discord", valid: "discord:channel:123", cross: "pinterest:board:launch"},
	}
	for _, test := range cases {
		t.Run(test.provider, func(t *testing.T) {
			require.NoError(t, ValidateTargetKey(test.provider, test.provider, test.provider))
			require.NoError(t, ValidateTargetKey(test.provider, test.provider, test.valid))
			require.ErrorContains(t, ValidateTargetKey(test.provider, test.provider, test.cross), "must belong")
			contract := PublishingTargetContract(test.provider)
			require.NotEmpty(t, contract.Subdestination)
			require.NotEmpty(t, contract.Example)
		})
	}
}
