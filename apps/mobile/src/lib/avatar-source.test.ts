import { expect, test } from "bun:test";
import { accountInitials, avatarImageSource } from "./avatar-source";

const BASE = "https://app.example.com";
const TOKEN = "TOKEN";

test("account monograms follow the shared avatar fallback rule", () => {
  expect(accountInitials("Ada Lovelace")).toBe("AL");
  expect(accountInitials("ada lovelace")).toBe("AL");
  expect(accountInitials("@ada")).toBe("AD");
  expect(accountInitials("x")).toBe("X");
  expect(accountInitials("  Ada   Lovelace  ")).toBe("AL");
  expect(accountInitials("")).toBe("?");
  expect(accountInitials("   ")).toBe("?");
  expect(accountInitials("@@@")).toBe("?");
});

test("a server-relative /avatars/ avatar absolutizes with no credential attached", () => {
  const source = avatarImageSource("/avatars/abc.png", BASE, TOKEN);
  expect(source.uri).toBe("https://app.example.com/avatars/abc.png");
  expect(source.headers).toBeUndefined();
});

test("an external provider avatar passes through with no credential attached", () => {
  const source = avatarImageSource("https://cdn.example.com/avatar.png", BASE, TOKEN);
  expect(source).toEqual({ uri: "https://cdn.example.com/avatar.png", cacheable: true });
});

test("a protected /media/ avatar keeps its bearer credential", () => {
  const source = avatarImageSource("/media/x.jpeg", BASE, TOKEN);
  expect(source.uri).toBe("https://app.example.com/media/x.jpeg");
  expect(source.headers).toEqual({ Authorization: "Bearer TOKEN" });
});

test("a foreign-origin /media/ path never receives the bearer credential", () => {
  const source = avatarImageSource("https://other.example.com/media/x.jpeg", BASE, TOKEN);
  expect(source).toEqual({ uri: "https://other.example.com/media/x.jpeg", cacheable: true });
});

test("local avatar sources pass through with no credential attached", () => {
  for (const uri of ["file:///avatar.png", "content://avatar/1", "data:image/png;base64,AAA"]) {
    expect(avatarImageSource(uri, BASE, TOKEN)).toEqual({ uri, cacheable: true });
  }
});

test("public avatars are cacheable while credentialed previews are not", () => {
  expect(avatarImageSource("/avatars/abc.png", BASE, TOKEN).cacheable).toBe(true);
  expect(avatarImageSource("https://cdn.example.com/avatar.png", BASE, TOKEN).cacheable).toBe(true);
  expect(avatarImageSource("/media/x.jpeg", BASE, TOKEN).cacheable).toBe(false);
});

test("proxy-protected public avatars are authenticated and stay out of the cache", () => {
  expect(
    avatarImageSource("/avatars/photo", BASE, TOKEN, [{ name: "P-Access-Token", value: "secret" }]),
  ).toEqual({
    uri: `${BASE}/avatars/photo`,
    headers: { "P-Access-Token": "secret" },
    cacheable: false,
  });
});
