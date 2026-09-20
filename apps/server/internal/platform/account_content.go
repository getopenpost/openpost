package platform

// AccountContentOrigin identifies where analytics content was published.
// OpenPost only tracks content published through OpenPost; there is no
// inventory for content published elsewhere.
type AccountContentOrigin string

const (
	AccountContentOriginOpenPost AccountContentOrigin = "openpost"
)

const (
	AccountContentMaxTextCharacters  = 10_000
	AccountContentMaxTitleCharacters = 500
)
