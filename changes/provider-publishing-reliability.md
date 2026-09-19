### Fixed

- Fixed Facebook video Stories and Reels failing when Meta had not finished fetching the video. OpenPost now uses Meta's hosted-file upload session, validates the credential-bearing upload host, keeps polling the accepted upload through temporary failures, and finishes only after the upload completes.
- Fixed provider network errors retaining credential-bearing request URLs in stored or logged error text.
- Fixed Threads posts with accents, curly punctuation, or emoji passing OpenPost's character check and then exceeding Meta's UTF-8 byte limit.
- Fixed Facebook analytics using feed-post fields for Stories, Reels, and video posts. OpenPost now requests the metric family supported by each Graph object type.
