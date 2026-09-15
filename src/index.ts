/**
 * The Ledger worker.
 *
 * Everything under `src/generated/` is emitted and never edited. This file, `deps.ts` and `env.ts`
 * are the whole of what an application writes.
 */
import { Hono } from "hono";
import { RegExpRouter } from "hono/router/reg-exp-router";
import { swaggerUI } from "@hono/swagger-ui";
import { Scalar } from "@scalar/hono-api-reference";
import { registerRoutes, type Operations } from "./generated/app.gen.js";
import { openApiDocument, OPENAPI_DOCUMENT_PATH } from "./generated/document.gen.js";
import {
	ResponseContractError,
	UndeclaredStatusError,
	type AppEnv,
} from "./generated/runtime.gen.js";
import { deps } from "./deps.js";
import type { Caller } from "./env.js";

/** Stand-in persistence. A real service reaches through `c.env` for a binding. */
const accounts = new Map<number, { id: number; name: string; balanceMinor: number; currency: string; active: boolean; openedAt: string }>([
	[1, { id: 1, name: "Operating", balanceMinor: 250_00, currency: "GBP", active: true, openedAt: "2026-01-01T00:00:00Z" }],
]);

/**
 * One handler per operation. Each returns `{ status, body }` for a response its operation declares,
 * failures included, so `Accounts_read` answers a missing account with the `404` `Problem` the
 * document publishes rather than throwing.
 *
 * `satisfies`, not an annotation: it keeps every `status` a literal, which is what selects the
 * response it belongs to, and it leaves the value unwidened so the surplus-key check in
 * `registerRoutes` still refuses a handler for an operation the spec no longer declares.
 */
const handlers = {
	Accounts_list: () => ({
		status: 200,
		body: { items: [...accounts.values()], total: accounts.size },
	}),

	Accounts_read: (_ctx, input) => {
		const account = accounts.get(input.accountId);
		return account === undefined
			? { status: 404, body: { code: "not_found", detail: `no account ${input.accountId}` } }
			: { status: 200, body: account };
	},

	Accounts_create: (_ctx, input) => {
		accounts.set(input.id, input);
		return { status: 201, body: input };
	},

	Accounts_close: (_ctx, input) => {
		accounts.delete(input.accountId);
		return { status: 204 };
	},

	Entries_list: (_ctx, input) => ({
		status: 200,
		body: {
			items: [
				{ id: 1, accountId: input.accountId, amountMinor: 500, memo: "opening", postedAt: "2026-01-01T00:00:00Z" },
			],
			total: 1,
		},
	}),

	Entries_add: (_ctx, input) => ({
		status: 200,
		body: {
			id: input.id,
			accountId: input.accountId,
			amountMinor: input.amountMinor,
			postedAt: input.postedAt,
		},
	}),

	/** The multipart parts arrive parsed; the binary one is a file because the document says so. */
	Statements_upload: (_ctx, input) => ({
		status: 202,
		body: { accepted: input.reference.length > 0 },
	}),

	/**
	 * A raw binary body arrives UNREAD, as the stream the platform gave us: materialising a 100 MB
	 * upload inside a 128 MB isolate, to produce a value the document says nothing about, is a cost no
	 * spec asked for.
	 */
	Statements_attach: async (_ctx, input) => {
		// A body sent with no bytes is reported as `null` by the platform, not as an empty stream.
		if (input.body === null) return { status: 202, body: { bytes: 0 } };
		// `getReader()` rather than `for await`: a ReadableStream is async-iterable at runtime on
		// workerd, but the lib does not declare it so, and a cast to paper over that is the one thing
		// this example must not teach. The reader is typed, and released whatever happens.
		const reader = input.body.getReader();
		let bytes = 0;
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				bytes += value.byteLength;
			}
		} finally {
			reader.releaseLock();
		}
		return { status: 202, body: { bytes } };
	},

	Health_check: () => ({ status: 200, body: { status: "ok", version: "0.1.0" } }),
} satisfies Operations<Caller>;

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

/**
 * A response the document does not permit is not served: the generated route throws, and this is
 * where an application decides what that answers with. Reported as a 500 here, because it is this
 * service's own fault rather than the caller's.
 */
app.onError((error, c) => {
	if (error instanceof ResponseContractError || error instanceof UndeclaredStatusError) {
		console.error("a response broke the contract", error);
		return c.json({ code: "internal", detail: "response contract violated" }, 500);
	}
	return c.json({ code: "internal", detail: error.message }, 500);
});

/** The chained value, which is what Hono's RPC client reads. */
const routes = registerRoutes(app, () => handlers, deps);

export type LedgerRoutes = typeof routes;
export default routes;
