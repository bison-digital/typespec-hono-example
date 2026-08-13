/**
 * ⚠️ **The route names carry the document's base path** — `client.api.v1.accounts`, not
 * `client.accounts`. `@server("/api/v1")` means the document publishes `/api/v1/accounts`, the
 * generated server mounts there, and the RPC surface follows. All three agree by construction.
 *
 * A typed client for this service, derived from the same spec that generated the server.
 *
 * ⚠️ **`typeof routes`, the value `registerRoutes` returns** — not the `Hono` instance passed in.
 * `hc` reads the `Schema` type Hono accumulates through the chain; the bare instance carries none.
 */
import { hc } from "hono/client";
import type { LedgerRoutes } from "./index.js";

export const client = hc<LedgerRoutes>("http://localhost:8810");

export async function readAccount(id: string): Promise<unknown> {
	const response = await client.api.v1.accounts[":accountId"].$get({ param: { accountId: id } });
	return response.json();
}

export async function listEntries(id: string): Promise<unknown> {
	const response = await client.api.v1.accounts[":accountId"].entries.$get({
		param: { accountId: id },
		query: {},
	});
	return response.json();
}

export async function refusesUndeclaredRoute(): Promise<unknown> {
	// @ts-expect-error — the service declares no `/ledgers`, and the client must know it.
	return client.api.v1.ledgers.$get();
}

export async function refusesAWrongParamShape(): Promise<unknown> {
	// @ts-expect-error — `param` is required for this route; omitting it must not compile.
	return client.api.v1.accounts[":accountId"].$get({});
}
