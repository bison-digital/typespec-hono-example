/**
 * The Ledger worker.
 *
 * Everything under `src/generated/` is emitted and never edited. This file, `deps.ts` and
 * `runtime.ts` are the whole of what an application writes.
 */
import { Hono } from "hono";
import { RegExpRouter } from "hono/router/reg-exp-router";
import { swaggerUI } from "@hono/swagger-ui";
import { Scalar } from "@scalar/hono-api-reference";
import { registerRoutes } from "./generated/app.gen.js";
import { openApiDocument, OPENAPI_DOCUMENT_PATH } from "./generated/document.gen.js";
import { deps } from "./deps.js";
import type { AppEnv } from "./runtime.js";

/** Stand-in persistence. A real service reaches through `c.env` for a binding. */
const accounts = new Map<number, { id: number; name: string; balanceMinor: number; currency: string; active: boolean; openedAt: string }>([
	[1, { id: 1, name: "Operating", balanceMinor: 250_00, currency: "GBP", active: true, openedAt: "2026-01-01T00:00:00Z" }],
]);

/**
 * ⚠️ **Unannotated on purpose.** Annotating widens the value to `Operations`, which makes the
 * surplus-key check evaporate — a handler for an operation the spec no longer declares would then
 * compile forever against a route nobody mounts.
 */
const handlersFor = () => ({
	Accounts_list: () => ({ items: [...accounts.values()], total: accounts.size }),

	Accounts_read: (_ctx: unknown, input: { accountId: number }) => {
		const account = accounts.get(input.accountId);
		return account ?? { failure: { code: "not_found", detail: `no account ${input.accountId}` } };
	},

	Accounts_create: (_ctx: unknown, input: { id: number; name: string; balanceMinor: number; currency: string; active: boolean; openedAt: string }) => {
		accounts.set(input.id, input);
		return input;
	},

	Accounts_close: (_ctx: unknown, input: { accountId: number }) => {
		accounts.delete(input.accountId);
		return undefined;
	},

	Entries_list: (_ctx: unknown, input: { accountId: number }) => ({
		items: [
			{ id: 1, accountId: input.accountId, amountMinor: 500, memo: "opening", postedAt: "2026-01-01T00:00:00Z" },
		],
		total: 1,
	}),

	Entries_add: (_ctx: unknown, input: { accountId: number; id: number; amountMinor: number; postedAt: string }) => ({
		id: input.id,
		accountId: input.accountId,
		amountMinor: input.amountMinor,
		postedAt: input.postedAt,
	}),

	/** The multipart parts arrive parsed; the binary one is `unknown` because the document says so. */
	Statements_upload: (_ctx: unknown, input: { reference: string }) => ({
		accepted: input.reference.length > 0,
	}),

	/** ⚠️ `ArrayBuffer`, not `string` — the bytes are the contract and must survive intact. */
	Statements_attach: (_ctx: unknown, input: { body: ArrayBuffer }) => ({
		bytes: input.body.byteLength,
	}),

	Health_check: () => ({ status: "ok", version: "0.1.0" }),
});

const app = new Hono<AppEnv>({ router: new RegExpRouter() });

// Middleware BEFORE registerRoutes — Hono applies it only to routes registered after it.
app.use(async (c, next) => {
	await next();
	c.header("x-route", c.req.routePath);
});

/**
 * ⚠️ **The root is the first thing anyone tries, and an API that 404s there reads as broken.** The
 * spec declares no operation at `/` — correctly, it is not part of the contract — so this is the
 * application's to provide, and pointing it at the documentation is the useful answer.
 */
app.get("/", (c) => c.redirect("/docs"));

app.get(OPENAPI_DOCUMENT_PATH, (c) => c.json(openApiDocument));
app.get("/docs", swaggerUI({ url: OPENAPI_DOCUMENT_PATH }));
app.get("/reference", Scalar({ url: OPENAPI_DOCUMENT_PATH }));

app.onError((error, c) => c.json({ code: "internal", detail: error.message }, 500));

/** The chained value, which is what Hono's RPC client reads. */
const routes = registerRoutes(app, handlersFor, deps);

export type LedgerRoutes = typeof routes;
export default routes;
