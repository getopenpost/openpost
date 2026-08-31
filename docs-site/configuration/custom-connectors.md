---
description: Add operator-run text publishing destinations to a self-hosted OpenPost instance.
---

# Custom connectors

For self-hosted operators installing publishing destinations that OpenPost does not ship with.

Custom connectors add publishing destinations that OpenPost does not ship with. They work only on self-hosted instances.

A connector is a service that you install and operate beside OpenPost. OpenPost calls it through Connector Protocol 1.0 over authenticated HTTP/JSON or a Unix socket. OpenPost never loads connector code into its process.

Protocol 1.0 supports:

- text posts
- connections configured by the instance operator
- destination-specific text fields and settings
- immediate or pending publish results

It does not yet support media, threads, browser automation, OAuth or form-based connection flows, analytics, comments, inboxes, or connector-supplied UI.

The [Directus walkthrough](#publish-to-directus) below uses the connector included in the repository. To write another connector, read [Connector Protocol 1.0](/development/connector-protocol).

## How the parts divide the work

OpenPost owns the Publication, Rendition, schedule, validation, job, access check, write fence, retry policy, and visible history. The connector owns its destination credentials, destination API calls, and duplicate-write checks.

The browser never receives the connector URL, bearer token, or destination credentials. Workspace members can connect only the installations that the instance operator has registered for their Workspace.

## Install a connector

1. Run a service that implements Connector Protocol 1.0.
2. Create a bearer token and store it in a secret file that both services can read.
3. Create the connector registry on the OpenPost host.
4. Set `OPENPOST_CONNECTORS_FILE` to the registry's absolute path.
5. Restart OpenPost.
6. Check the startup log. Fix or remove any quarantined connector.
7. Open **Social accounts** in a Workspace and connect the custom destination.

OpenPost reads the registry only at startup. Restart it after changing an installation, endpoint, allowlist, or token.

## Connector registry

The registry uses strict JSON. Unknown fields, duplicate installation IDs, relative secret paths, and unsupported versions make the file invalid.

```json
{
  "version": 1,
  "installations": [
    {
      "id": "directus-main",
      "required": false,
      "workspace_allowlist": ["workspace-id"],
      "endpoint": {
        "mode": "private_allowlist",
        "base_url": "http://directus-connector:8787",
        "allowed_hosts": ["directus-connector"],
        "allowed_cidrs": ["172.16.0.0/12"],
        "allowed_ports": [8787]
      },
      "auth": {
        "bearer_token_file": "/run/secrets/openpost-connector-token"
      }
    }
  ]
}
```

| Field                 | Meaning                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------ |
| `version`             | Registry format. The current value is `1`.                                                 |
| `id`                  | One configured connector installation. Use a stable, unique value.                         |
| `required`            | If `true`, an invalid or unavailable connector blocks OpenPost startup.                    |
| `workspace_allowlist` | Exact Workspace IDs allowed to use the installation. An empty list allows every Workspace. |
| `endpoint`            | One operator-controlled network policy. Workspace and post data cannot change it.          |
| `bearer_token_file`   | Absolute path to one token. The registry cannot contain an inline token.                   |

An installation ID identifies one configured service. The provider ID in the connector manifest identifies the connector type. Two installations may use the same provider ID, such as two Directus sites, but their installation IDs must differ. A connector cannot use the ID of a built-in provider.

## Choose an endpoint mode

Use the narrowest mode that fits the deployment.

- `public_https`: for a public HTTPS address. Set `base_url`.
- `private_allowlist`: for a private host or container network. Set `base_url`, exact `allowed_hosts`, `allowed_cidrs`, and `allowed_ports`.
- `unix_socket`: for two services on one host. Set an absolute `socket_path`.

For `public_https`, OpenPost rejects private, loopback, link-local, and reserved addresses. It checks DNS again when it connects. For `private_allowlist`, every resolved address and port must match the registry. OpenPost also blocks redirects, ignores proxy environment variables, limits responses to 1 MiB, and applies request timeouts.

Do not expose a private connector port to the public internet. Use HTTPS for any connector traffic that leaves a trusted host or private network.

## Connect it to a Workspace

After OpenPost accepts the connector at startup:

1. Open the target Workspace.
2. Go to **Social accounts**.
3. Find the custom connector card and select **Connect**.
4. Choose the returned destination account if the connector offers more than one.

Protocol 1.0 connections complete at once. The connector may return one or more preconfigured destination accounts, but it cannot ask the user for a URL, token, or custom form value.

## Change or remove an installation

Keep the installation ID and provider ID stable across updates. Change `capability_revision` when a connector changes its output rules, settings, or publish behavior. OpenPost then blocks old account bindings until someone reconnects them.

Removing or disabling an installation does not delete its connected accounts, Publications, Renditions, or delivery history. It stops new connections and publishes. Add the same installation back to restore access.

Set `required` to `true` only when the instance must not start without that connector. A failed optional connector enters quarantine while the rest of OpenPost starts.

## Publish to Directus

The Directus reference connector creates one collection item for each text Rendition. OpenPost talks to the connector, and the connector talks to Directus. OpenPost never receives the Directus token.

The source lives in [`examples/connectors/directus`](https://github.com/getopenpost/openpost/tree/main/examples/connectors/directus).

### Create the collection

Create a Directus collection, such as `posts`, with these fields:

- `title`: an optional string for the post title
- `content`: required text for the post body
- `description`: optional text for the description
- `status`: a string that allows `draft` and `published`
- `openpost_operation_id`: a required, unique string that users cannot edit

The unique operation field prevents duplicate items. Before each create request, the connector looks for an item with the same OpenPost operation ID. If Directus reports a conflict, the connector checks again and returns the existing item.

Create a Directus access token that can read items by `openpost_operation_id` and create items in this collection. Do not give it access to unrelated collections or administrator settings.

### Create the secret files

Create two different tokens:

- a connector bearer token used between OpenPost and the connector
- the Directus access token used between the connector and Directus

Store each token as one line in a secret file. Both services must read the same connector bearer token. Only the connector should read the Directus token.

Do not put either token in the registry, Compose file, shell history, container image, or repository.

### Run the connector

For a local source checkout:

```bash
cd examples/connectors/directus
export CONNECTOR_BEARER_TOKEN_FILE=/run/secrets/openpost-connector-token
export DIRECTUS_URL=https://cms.example.com
export DIRECTUS_TOKEN_FILE=/run/secrets/directus-token
export DIRECTUS_COLLECTION=posts
go run .
```

The service listens on `127.0.0.1:8787` by default. In a container, set `CONNECTOR_LISTEN_ADDRESS=:8787` and keep the port on a private network shared with OpenPost.

Build the included image with:

```bash
docker build -t openpost-directus-connector examples/connectors/directus
```

Use HTTPS for Directus in production. `DIRECTUS_ALLOW_HTTP=true` permits HTTP only for local development.

### Register and connect it

Use the registry example above or copy [`openpost-connectors.example.json`](https://github.com/getopenpost/openpost/blob/main/examples/connectors/directus/openpost-connectors.example.json). The sample expects a container named `directus-connector` at `http://directus-connector:8787`.

Inspect the container network used by OpenPost and the connector. Add only that range to `allowed_cidrs`; do not copy the sample range without checking it. Set `OPENPOST_CONNECTORS_FILE`, restart OpenPost, then connect the **Directus** card in **Social accounts**.

Publish a text post and confirm that Directus contains one item with a non-empty `openpost_operation_id`. In a test instance, repeat a publish request with that operation ID and confirm that Directus still contains one item.

### Change the field names

Use these variables if your collection uses other field names:

- `DIRECTUS_CONTENT_FIELD`, default `content`
- `DIRECTUS_TITLE_FIELD`, default `title`
- `DIRECTUS_DESCRIPTION_FIELD`, default `description`
- `DIRECTUS_STATUS_FIELD`, default `status`
- `DIRECTUS_OPERATION_FIELD`, default `openpost_operation_id`

Set `DIRECTUS_ITEM_URL_TEMPLATE`, such as `https://cms.example.com/admin/content/posts/{id}`, to add a link to the Directus item in OpenPost.

If the connector enters quarantine, check DNS, the private network allowlist, the connector token, Directus health, and the Directus token. If a retry creates a second item, stop publishing and confirm that `DIRECTUS_OPERATION_FIELD` points to a unique field.

## Before production use

- Store connector and destination tokens in secret files.
- Restrict the installation to the Workspaces that need it.
- Restrict the endpoint to its exact host, network range, and port.
- Confirm that the connector records each `operation_id` before or with its first destination write.
- Test a timeout after the destination accepts a write. The same operation must not create a second item.
- Back up any connector-owned operation journal with the destination data it protects.
- Keep the connector running while scheduled posts can reach it.

See [Connector Protocol 1.0](/development/connector-protocol) for the route contract and publish safety rules.
