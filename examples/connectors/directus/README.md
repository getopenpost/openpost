# Directus connector example

This sidecar implements OpenPost Connector Protocol 1.0 and creates one Directus item for each published rendition. OpenPost talks only to the sidecar. The sidecar owns the Directus URL and token.

The full setup guide covers collection permissions, secret files, network policy, connection, duplicate-write checks, and troubleshooting:

- [Custom connectors](https://docs.openpo.st/configuration/custom-connectors)
- [Connector Protocol 1.0](https://docs.openpo.st/development/connector-protocol)

Create a Directus collection with these fields:

- `title`: string
- `content`: text
- `description`: text
- `status`: string with `draft` and `published` values
- `openpost_operation_id`: unique string

The unique operation field is required. The connector looks up that value before every create request, so a timeout or worker retry cannot create the same item twice.

## Run it

```bash
export CONNECTOR_BEARER_TOKEN_FILE=/run/secrets/openpost-connector-token
export DIRECTUS_URL=https://cms.example.com
export DIRECTUS_TOKEN_FILE=/run/secrets/directus-token
export DIRECTUS_COLLECTION=posts
go run .
```

Set `OPENPOST_CONNECTORS_FILE` on OpenPost to an absolute path containing a config based on [`openpost-connectors.example.json`](./openpost-connectors.example.json). Both services must read the same connector bearer-token secret. Restart OpenPost, open Social accounts, and connect the Directus card.

The connector listens on `127.0.0.1:8787` by default. Set `CONNECTOR_LISTEN_ADDRESS=:8787` inside a container. Keep the port private to OpenPost.

To build the included container image:

```bash
docker build -t openpost-directus-connector .
```

## Field overrides

Use `DIRECTUS_CONTENT_FIELD`, `DIRECTUS_TITLE_FIELD`, `DIRECTUS_DESCRIPTION_FIELD`, `DIRECTUS_STATUS_FIELD`, and `DIRECTUS_OPERATION_FIELD` when the collection uses other field names. `DIRECTUS_ITEM_URL_TEMPLATE`, such as `https://cms.example.com/admin/content/posts/{id}`, adds a link to the published item.

For local HTTP-only Directus development, set `DIRECTUS_ALLOW_HTTP=true`. Production Directus URLs must use HTTPS.
