import { config } from "@n8n/node-cli/eslint";
import { globalIgnores } from "eslint/config";

export default [
  globalIgnores(["test/**"]),
  ...config,
  {
    rules: {
      "@n8n/community-nodes/node-registration-complete": "off",
    },
  },
];
