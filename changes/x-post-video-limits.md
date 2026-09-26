### Fixed

- Correct the default X Post video limits to 20 minutes / 8 GiB standard and 125 minutes / 16 GiB subscribed, matching X's documented `tweet_video` caps. The previous 512 MiB / 140-second defaults describe Direct Message video, which OpenPost never uploads.
