import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from "n8n-workflow";

export class OpenPostApi implements ICredentialType {
  name = "openPostApi";
  displayName = "OpenPost API";
  icon = "file:openpost.svg" as const;
  documentationUrl = "https://docs.openpost.dev/development/api-tokens";
  genericAuth = true;
  supportedNodes = ["openPost"];
  httpRequestNode = {
    name: "OpenPost API",
    docsUrl: "https://docs.openpost.dev/development/api-tokens",
    apiBaseUrlPlaceholder: "https://app.openpost.dev/api/v1",
  };

  properties: INodeProperties[] = [
    {
      displayName: "Base URL",
      name: "baseUrl",
      type: "string",
      default: "https://app.openpost.dev",
      placeholder: "https://app.openpost.dev",
      required: true,
      description:
        "OpenPost origin without /api or /api/v1. In Docker, localhost means the n8n container.",
    },
    {
      displayName: "API Token",
      name: "apiToken",
      type: "string",
      typeOptions: { password: true },
      default: "",
      required: true,
      description:
        "Use a workspace-bound api:write token for workflows that publish or mutate data.",
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: "generic",
    properties: {
      headers: {
        Authorization: "=Bearer {{$credentials.apiToken}}",
      },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      method: "GET",
      url: "={{$credentials.baseUrl.replace(/\\/+$/, '') + '/api/v1/workspaces'}}",
    },
  };
}
