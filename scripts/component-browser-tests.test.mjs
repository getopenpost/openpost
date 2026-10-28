import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const nodeExecutable = execFileSync("node", ["-p", "process.execPath"], {
  encoding: "utf8",
}).trim();

function runBrowser(args = [], failure = null) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "openpost-component-runner-"));
  try {
    const preload = path.join(directory, "preload.mjs");
    writeFileSync(
      preload,
      `import childProcess from "node:child_process";
       import { syncBuiltinESMExports } from "node:module";
       import { appendFileSync } from "node:fs";
       const failure = ${JSON.stringify(failure)};
       let calls = 0;
       childProcess.spawnSync = (executable, args, options) => {
         appendFileSync("calls.jsonl", JSON.stringify({ executable, args, precompiled: options.env?.OPENPOST_PARAGLIDE_PRECOMPILED }) + "\\n");
         if (++calls === failure?.call) {
           if (failure.kind === "spawn") return { error: new Error("fixture spawn refused"), status: null };
           if (failure.kind === "signal") return { signal: "SIGTERM", status: null };
           return { status: 17 };
         }
         return { status: 0 };
       };
       syncBuiltinESMExports();`,
    );
    const result = spawnSync(
      nodeExecutable,
      ["--import", preload, path.resolve("apps/web/scripts/component-browser-tests.mjs"), ...args],
      { cwd: directory, encoding: "utf8", timeout: 10000 },
    );
    let calls = [];
    try {
      calls = readFileSync(path.join(directory, "calls.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map(JSON.parse);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return { ...result, calls };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function assertBrowserCall(call, shard) {
  assert.equal(call.executable, nodeExecutable);
  assert.equal(path.basename(call.args[0]), "vitest.mjs");
  assert.deepEqual(call.args.slice(1), [
    "run",
    "--project",
    "client",
    `--shard=${shard}`,
    "--isolate",
    "--maxWorkers=1",
  ]);
  assert.equal(call.precompiled, "1");
}

test("default browser checks prepare translations once and run four native shards sequentially", () => {
  const result = runBrowser();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.length, 5);
  assert.equal(result.calls[0].executable, "bun");
  assert.deepEqual(result.calls[0].args, ["run", "generate:i18n"]);
  for (const [index, shard] of ["1/4", "2/4", "3/4", "4/4"].entries()) {
    assertBrowserCall(result.calls[index + 1], shard);
  }
});

test("an explicit CI shard is propagated exactly after one preparation", () => {
  const result = runBrowser(["3/7"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.length, 2);
  assert.equal(result.calls[0].executable, "bun");
  assert.deepEqual(result.calls[0].args, ["run", "generate:i18n"]);
  assertBrowserCall(result.calls[1], "3/7");
});

test("failed translation preparation stops before any browser shard", () => {
  const result = runBrowser([], { call: 1, kind: "status" });
  assert.notEqual(result.status, 0, result.stderr);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].executable, "bun");
  assert.match(result.stderr, /status 17/);
});

for (const [kind, diagnostic] of [
  ["status", /status 17/],
  ["signal", /SIGTERM/],
  ["spawn", /fixture spawn refused/],
]) {
  test(`a browser ${kind} failure stops before later shards`, () => {
    const result = runBrowser([], { call: 3, kind });
    assert.notEqual(result.status, 0, result.stderr);
    assert.equal(result.calls.length, 3);
    assertBrowserCall(result.calls[1], "1/4");
    assertBrowserCall(result.calls[2], "2/4");
    assert.match(result.stderr, diagnostic);
  });
}

test("invalid or extra shard arguments fail before preparation", () => {
  for (const args of [["0/4"], ["5/4"], ["not-a-shard"], ["1/4", "2/4"]]) {
    const result = runBrowser(args);
    assert.notEqual(result.status, 0, result.stderr);
    assert.deepEqual(result.calls, []);
  }
});

// Exercise the real Vitest project/Vite merge, including resource reactivation
// after the project initialization closes its watcher.
test("one-shot projects cannot reactivate file watching while watch mode still receives edits", () => {
  const result = spawnSync(
    nodeExecutable,
    [
      "--input-type=module",
      "-e",
      String.raw`import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfigFromFile } from 'vite';
import { createVitest } from 'vitest/node';
const root=path.resolve('../..');
const base=await loadConfigFromFile({command:'serve',mode:'test'},path.join(root,'apps/web/vitest.config.ts'));
// This probe opens no modules. Disable dependency discovery so its temporary
// root does not scan application entries or optimize unrelated Node tooling.
const watcherOnly={name:'watcher-probe-no-deps',configResolved(config){config.optimizeDeps.noDiscovery=true;config.optimizeDeps.include=[];config.optimizeDeps.entries=[];}};
const results=[];
for(const watch of [false,true]) {
 const fixture=await mkdtemp(path.join(os.tmpdir(),'openpost-vitest-watcher-'));
 const projects=base.config.test.projects.map(project=>({...project,cacheDir:path.join(fixture,'cache'),plugins:[...project.plugins??[],watcherOnly],extends:path.join(root,'apps/web/vite.config.ts')}));
 const file=path.join(fixture,'watched.txt');await writeFile(file,'before');
 let ctx;
 try {
  ctx=await createVitest('test',{root:fixture,config:false,watch,project:['client'],reporters:[]},{logLevel:'silent',test:{...base.config.test,projects}});
  const project=ctx.projects[0].vite;await project.watcher.add(file);
  for(let i=0;i<50 && Object.keys(project.watcher.getWatched()).length===0;i++) await new Promise(r=>setTimeout(r,10));
  let changed=false;
  if(watch) {
   const signal=new Promise(resolve=>ctx.vite.watcher.once('change',()=>{changed=true;resolve();}));
   for(let i=0;i<50 && Object.keys(ctx.vite.watcher.getWatched()).length===0;i++) await new Promise(r=>setTimeout(r,10));
   await writeFile(file,'after');await Promise.race([signal,new Promise(r=>setTimeout(r,1000))]);
  }
  results.push({watch,projectWatcher:project.watcher.constructor.name,projectWatchedPaths:Object.keys(project.watcher.getWatched()).length,rootWatcher:ctx.vite.watcher.constructor.name,watchModeChangeObserved:changed});
 } finally {await ctx?.close();await rm(fixture,{recursive:true,force:true});}
}
console.log('WATCHER_RESULT '+JSON.stringify(results));
`,
    ],
    {
      cwd: path.resolve("apps/web"),
      env: { ...process.env, VITEST: "true", OPENPOST_PARAGLIDE_PRECOMPILED: "1" },
      encoding: "utf8",
      timeout: 15000,
    },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const line = result.stdout.split("\n").find((value) => value.startsWith("WATCHER_RESULT "));
  assert.ok(line, "the real server probe must return its watcher results");
  const modes = JSON.parse(line.slice("WATCHER_RESULT ".length));
  assert.equal(modes.length, 2);
  for (const mode of modes) {
    assert.equal(
      mode.projectWatchedPaths,
      0,
      "Vitest project initialization must not allocate a live watcher",
    );
    assert.equal(
      mode.watchModeChangeObserved,
      mode.watch,
      "interactive watch mode must still receive edits",
    );
  }
});
