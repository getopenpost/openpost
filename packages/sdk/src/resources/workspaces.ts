import type { HttpClient } from "../client.js";
import type { Workspace } from "../types.js";

export class Workspaces {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<Workspace[]> {
    return (await this.http.get("/api/v1/workspaces")) as Workspace[];
  }

  async create(name: string): Promise<Workspace> {
    return (await this.http.post("/api/v1/workspaces", { name })) as Workspace;
  }
}
