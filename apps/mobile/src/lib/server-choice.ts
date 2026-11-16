import type { ServerHeader } from "./server-headers";

type ServerChoiceDependencies = {
  probe: (
    target: string,
    headers: ServerHeader[],
  ) => Promise<{ ok: true; baseUrl: string } | { ok: false; error: string }>;
  persist: (target: string, headers: ServerHeader[]) => Promise<unknown>;
};

type ServerChoiceResult = { status: "connected" } | { status: "failed"; message: string };

type ServerChoice = {
  start: (target: string, headers?: ServerHeader[]) => Promise<ServerChoiceResult> | null;
};

export function createServerChoice(dependencies: ServerChoiceDependencies): ServerChoice {
  let active: Promise<ServerChoiceResult> | null = null;

  return {
    start(target, headers = []) {
      if (active) return null;
      const operation = connect(
        target,
        headers.map((header) => ({ ...header })),
        dependencies,
      ).finally(() => {
        if (active === operation) active = null;
      });
      active = operation;
      return operation;
    },
  };
}

export function serverChoiceErrorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.name === "AbortError") {
    return "The selected server changed. Try again.";
  }
  return "Could not save this server. Try again.";
}

async function connect(
  target: string,
  headers: ServerHeader[],
  dependencies: ServerChoiceDependencies,
): Promise<ServerChoiceResult> {
  const result = await dependencies.probe(target, headers);
  if (!result.ok) return { status: "failed", message: result.error };
  await dependencies.persist(result.baseUrl, headers);
  return { status: "connected" };
}
