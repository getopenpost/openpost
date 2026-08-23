import type {
  IExecuteFunctions,
  IDataObject,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";
import { NodeConnectionTypes } from "n8n-workflow";

import { generatedDescriptionProperties } from "./descriptions/generated/descriptions";
import {
  buildOpenPostRequest,
  extractResult,
  findRequestMapper,
  nextCursorFromHeaders,
  normalizeNodeValue,
  idempotencyKey,
} from "./actions/mapper";
import { toOpenPostNodeError } from "./errors";
import { uploadBinaryMedia } from "./media/uploadBinary";
import { listSearch } from "./methods/listSearch";
import { openPostApiRequest } from "./transport/openPostApiRequest";
import { normalizeOpenPostBaseUrl } from "./transport/url";

// eslint-disable-next-line @n8n/community-nodes/node-usable-as-tool -- OpenPost write actions must not run as AI tools until confirmation and permissions are designed.
export class OpenPostV1 implements INodeType {
  description: INodeTypeDescription = {
    displayName: "OpenPost",
    name: "openPost",
    icon: { light: "file:openpost.svg", dark: "file:openpost.dark.svg" },
    group: ["output"],
    version: 1,
    subtitle: '={{$parameter["resource"] + ": " + $parameter["operation"]}}',
    description: "Publish, schedule, and inspect OpenPost Publications.",
    defaults: {
      name: "OpenPost",
    },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: "openPostApi",
        required: true,
      },
    ],
    properties: [
      ...generatedDescriptionProperties,
      {
        displayName: "Return All",
        name: "returnAll",
        type: "boolean",
        default: false,
        description: "Whether to return all results or only up to a given limit",
        displayOptions: {
          show: {
            operation: ["getMany", "getEvents"],
          },
        },
      },
    ],
  };

  methods = {
    listSearch,
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const credentials = await this.getCredentials<{ baseUrl: string }>("openPostApi");
    const baseUrl = normalizeOpenPostBaseUrl(credentials.baseUrl);
    const executionId = this.getExecutionId();
    const output: INodeExecutionData[] = [];

    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const resource = String(this.getNodeParameter("resource", itemIndex));
      const operation = String(this.getNodeParameter("operation", itemIndex));
      try {
        if (resource === "media" && operation === "uploadBinary") {
          const key = idempotencyKey(
            this.getNodeParameter("idempotencyKey", itemIndex, ""),
            executionId,
            "media.uploadBinary",
            itemIndex,
          );
          const result = await uploadBinaryMedia(this, {
            baseUrl,
            itemIndex,
            executionId,
            idempotencyKey: key,
            workspaceId: String(
              normalizeNodeValue(this.getNodeParameter("workspaceId", itemIndex)),
            ),
            binaryPropertyName: String(
              this.getNodeParameter("binaryPropertyName", itemIndex, "data"),
            ),
            fileName: optionalString(this.getNodeParameter("fileName", itemIndex, "")),
            mimeType: optionalString(this.getNodeParameter("mimeType", itemIndex, "")),
            altText: optionalString(this.getNodeParameter("altText", itemIndex, "")),
            retentionClass: optionalString(
              this.getNodeParameter("retentionClass", itemIndex, "library"),
            ),
            assetKind: optionalString(this.getNodeParameter("assetKind", itemIndex, "library")),
          });
          output.push({ json: asDataObject(result), pairedItem: { item: itemIndex } });
          continue;
        }

        const mapper = findRequestMapper(resource, operation);
        let cursor = "";
        let page = 0;
        const returnAll = Boolean(this.getNodeParameter("returnAll", itemIndex, false));
        do {
          const request = buildOpenPostRequest({
            baseUrl,
            mapper,
            itemIndex,
            executionId,
            cursor,
            parameters: {
              get: (name: string, fallback?: unknown) =>
                this.getNodeParameter(name, itemIndex, fallback),
            },
          });
          const response = await openPostApiRequest(this, request.options, {
            idempotency: mapper.idempotency,
          });
          for (const result of extractResult(response.body, mapper.result)) {
            output.push({ json: asDataObject(result), pairedItem: { item: itemIndex } });
          }
          cursor =
            returnAll && mapper.pagination
              ? nextCursorFromHeaders(
                  response.headers as Record<string, unknown> | undefined,
                  mapper.pagination.next_cursor_header,
                )
              : "";
          page += 1;
        } while (cursor && page < 100);
      } catch (error) {
        if (!this.continueOnFail()) throw toOpenPostNodeError(this.getNode(), error);
        output.push({
          json: { error: error instanceof Error ? error.message : String(error) },
          pairedItem: { item: itemIndex },
        });
      }
    }

    return [output];
  }
}

function optionalString(value: unknown): string | undefined {
  const text = String(normalizeNodeValue(value) ?? "").trim();
  return text || undefined;
}

function asDataObject(value: unknown): IDataObject {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as IDataObject;
  return { value: value as IDataObject[string] };
}
