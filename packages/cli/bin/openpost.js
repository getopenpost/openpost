#!/usr/bin/env node
import { runBinary } from "../dist/run.js";

await runBinary("openpost-cli", process.argv.slice(2));
