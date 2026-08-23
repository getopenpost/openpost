import { VersionedNodeType } from "n8n-workflow";

import { OpenPostV1 } from "./v1/OpenPostV1.node";

export class OpenPost extends VersionedNodeType {
  constructor() {
    const baseDescription = {
      displayName: "OpenPost",
      name: "openPost",
      icon: { light: "file:openpost.svg", dark: "file:openpost.dark.svg" } as const,
      group: ["output" as const],
      description: "Publish, schedule, and inspect OpenPost Publications.",
      defaultVersion: 1,
    };
    super(
      {
        1: new OpenPostV1(),
      },
      baseDescription,
    );
  }
}
