# Stock Media Providers

OpenPost can search Pexels, Unsplash, and Pixabay from OpenPost Image Editor and OpenPost Video Editor. Each provider is optional. Configure only the providers you want to offer.

The APIs are free for this use case as of **August 4, 2026**, subject to each provider's terms, approval process, and rate limits. OpenPost does not pay a per-search or per-download provider fee. You still pay for the storage and network traffic used when people import stock files into your OpenPost media storage.

## Choose providers

| Provider | OpenPost media | Current API access | Default limit | Credential |
| --- | --- | --- | --- | --- |
| [Pexels](https://www.pexels.com/api/) | Photos and videos | Free. Eligible applications can request higher or unlimited access without a fee. | 200 requests per hour and 20,000 per month | Pexels API key |
| [Unsplash](https://unsplash.com/developers) | Photos | Free. Public applications should apply for Production status. | 50 requests per hour in Demo status; 1,000 per hour after Production approval | Unsplash Access Key, not the Secret Key |
| [Pixabay](https://pixabay.com/api/docs/) | Images and videos | Free | 100 requests per 60 seconds | Pixabay API key |

Pexels is the simplest single-provider starting point because one key covers both photos and videos. Add Pixabay for a second photo and video catalog. Add Unsplash after its Production review if you expect public use; its Demo limit is intended for development, education, and small personal projects.

Limits and terms can change. Check the linked provider pages before a production launch or limit-increase request.

## Get the credentials

1. Create a provider account and application through the [Pexels API](https://www.pexels.com/api/), [Unsplash developer portal](https://unsplash.com/developers), or [Pixabay API documentation](https://pixabay.com/api/docs/).
2. For Unsplash, copy the application's **Access Key**. OpenPost does not need the Secret Key.
3. Keep every key on the server. Do not put it in browser code, a public repository, or a client-side environment variable.
4. For a public Unsplash integration, test with Demo status, meet the [Unsplash API guidelines](https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines), then [apply for Production status](https://help.unsplash.com/en/articles/3887917-when-should-i-apply-for-a-higher-rate-limit).

## Configure OpenPost

An instance administrator can save the toggle and keys under **Settings → Instance → Configuration**. OpenPost encrypts database-backed keys, returns them as write-only settings, and shows when a restart is pending.

Operators can instead set server environment variables:

```dotenv
OPENPOST_STOCK_MEDIA_ENABLED=true
OPENPOST_PEXELS_API_KEY=
OPENPOST_UNSPLASH_ACCESS_KEY=
OPENPOST_PIXABAY_API_KEY=
```

Set at least one provider key. A provider appears in the editors only when stock media is enabled and that provider has a non-empty key. Direct or file-backed environment configuration takes precedence over an encrypted administrator setting. Restart OpenPost after changing environment configuration.

After restart, confirm that the public provider list contains only the providers you intended to enable:

```sh
curl https://your-openpost.example/api/v1/stock-media/providers
```

Open an editor, run a search, select an item, and confirm that its creator, provider, and license details appear in the Credits panel.

## Provider rules OpenPost supports

- **Pexels:** API search results must link prominently to Pexels, and applications should credit creators when possible. OpenPost shows the provider and creator attribution and stores it with the selected media.
- **Unsplash:** Search previews use provider image URLs, displayed photos include creator and Unsplash attribution, and selecting a photo calls the required download-tracking endpoint. The selected source is then imported for editing. Production approval depends on the complete application meeting Unsplash's current API terms and guidelines.
- **Pixabay:** Search responses must be cached for 24 hours, results should identify Pixabay as their source, and permanently used images should be downloaded instead of hotlinked. OpenPost uses a 24-hour Pixabay search cache and imports selected files into OpenPost storage.

OpenPost preserves creator, provider, source, and license provenance, but it does not grant extra rights or perform legal clearance. Review the provider license and the selected asset for recognizable people, property, brands, or other third-party rights before publishing commercial work.

## Costs and capacity

The three provider APIs currently have no required subscription charge for this integration. Capacity is controlled through rate limits and provider approval rather than usage billing.

OpenPost caches repeated searches to reduce provider requests. Once selected, the media bytes become a durable local project source and can also be saved to cloud Media. Plan capacity for:

- local disk or S3-compatible object storage;
- download traffic from the stock provider to the user or OpenPost;
- upload and delivery traffic for cloud Media;
- backups and retention for saved media.

If demand reaches a provider's default limit, review cache effectiveness first. Then use that provider's official limit-increase process instead of creating extra keys or working around the limit.

## Official references

Reviewed August 4, 2026:

- [Pexels API documentation](https://www.pexels.com/api/documentation/)
- [Pexels unlimited-request requirements](https://help.pexels.com/hc/en-us/articles/900005852323-How-do-I-get-unlimited-requests)
- [Unsplash API documentation](https://unsplash.com/documentation)
- [Unsplash API guidelines](https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines)
- [Unsplash Production-status guidance](https://help.unsplash.com/en/articles/3887917-when-should-i-apply-for-a-higher-rate-limit)
- [Pixabay API documentation](https://pixabay.com/api/docs/)
