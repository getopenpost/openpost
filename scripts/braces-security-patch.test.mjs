import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(path.resolve("package.json"));
const braces = require("braces");

for (const [name, operation] of [
  ["compile", (pattern) => braces(pattern)],
  ["expand", (pattern) => braces.expand(pattern)],
  ["parse", (pattern) => braces.parse(pattern)],
]) {
  test(`Braces ${name} rejects excessive nesting before exhausting the stack`, () => {
    const pattern = "{".repeat(4000) + "a,b" + "}".repeat(4000);
    expect(() => operation(pattern)).toThrow(/exceeds max depth/);
  });
}

test("Braces keeps ordinary numeric ranges, nested alternatives, and escaped braces", () => {
  expect(braces.expand("file{1..3}.{js,ts}")).toEqual([
    "file1.js",
    "file1.ts",
    "file2.js",
    "file2.ts",
    "file3.js",
    "file3.ts",
  ]);
  expect(braces.expand("{a,{b,c}}")).toEqual(["a", "b", "c"]);
  expect(braces.expand("\\{a,b\\}")).toEqual(["{a,b}"]);
});

test("Braces cannot disable the nesting bound through options", () => {
  const pattern = "(".repeat(101) + "a" + ")".repeat(101);
  expect(() => braces.parse(pattern, { maxDepth: Infinity })).toThrow(/exceeds max depth/);
  expect(() => braces.parse(pattern, { maxDepth: 100000 })).toThrow(/exceeds max depth/);
});

test("Braces rejects excessive caller-supplied AST depth in every public walker", () => {
  let node = { type: "text", value: "a" };
  for (let depth = 0; depth < 150; depth++) node = { type: "paren", nodes: [node] };
  const ast = { type: "root", nodes: [node] };
  for (const operation of [braces.compile, braces.expand, braces.stringify]) {
    expect(() => operation(ast)).toThrow(/exceeds max depth/);
  }
});
