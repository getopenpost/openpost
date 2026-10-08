import { expect, mock, test } from "bun:test";
import createClient from "openapi-fetch";
import type { paths } from "@openpost/api-contract";

mock.module("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));

const { errorMessage } = await import("./client");

test("shows validation details after openapi-fetch consumes the error response", async () => {
  const client = createClient<paths>({
    baseUrl: "https://review.invalid/api/v1",
    fetch: async () =>
      Response.json(
        {
          title: "Unprocessable Entity",
          detail: "validation failed",
          errors: [{ message: "unexpected property", location: "body.media" }],
        },
        { status: 422 },
      ),
  });
  const { error, response } = await client.PUT("/publications/{id}", {
    params: { path: { id: "draft" } },
    body: { expected_revision: 1, source_text: "Draft" },
  });
  expect(response.bodyUsed).toBe(true);
  expect(await errorMessage(response, "Could not save", error)).toBe(
    "body.media: unexpected property",
  );
});

test("shows server detail and keeps a readable fallback for missing or malformed errors", async () => {
  expect(
    await errorMessage(
      Response.json({ detail: "Pick a future publish time" }, { status: 400 }),
      "Could not save",
    ),
  ).toBe("Pick a future publish time");
  expect(await errorMessage(new Response("Unavailable", { status: 503 }), "Could not save")).toBe(
    "Could not save (503)",
  );
  expect(await errorMessage(undefined, "Could not save")).toBe("Could not save");
});
