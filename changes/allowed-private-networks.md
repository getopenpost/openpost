### Added

- Self-hosted instances can let OpenPost reach services on their own private network, such as a Mastodon, Pixelfed or PeerTube server on the same host or behind a VPN. List only those networks in `OPENPOST_ALLOWED_PRIVATE_CIDRS`, for example `10.7.7.0/24`. Every other private and local address stays blocked, an invalid CIDR stops startup, and Hosted rejects the setting.
