#!/usr/bin/env node
import { runBinary } from "../dist/run.js";

await runBinary("openpost-mcp", process.argv.slice(2));
