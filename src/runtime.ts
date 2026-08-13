/**
 * What this application substitutes for the emitter's identity defaults.
 *
 * ⚠️ **This is the documented seam, and it is what makes the generated signatures concretely typed.**
 * Left at the defaults, `Ctx` is `unknown` and `Result<T>` is `T`, so the generated `Operations`
 * interface degrades to something almost any function satisfies. Pointing `runtime-module` here and
 * re-declaring these four names is how an application gets its own caller context, its own bindings
 * and its own result envelope carried end to end without a cast anywhere.
 */
import type { Env } from "hono";

// Re-exported so the generated files import their whole runtime contract from one module.
export { armFor, selectContentType, type ResponseArm } from "typespec-hono/runtime";
export type { Awaitable, RouteDeps as BaseRouteDeps } from "typespec-hono/runtime";

import type { RouteDeps as BaseRouteDeps } from "typespec-hono/runtime";

/** The Worker's bindings, exactly as `wrangler.jsonc` declares them. */
export interface AppEnv extends Env {
	readonly Bindings: {
		readonly SERVICE_VERSION?: string;
	};
	readonly Variables: {
		readonly requestId: string;
	};
}

/** Who is calling. Established once per request by `deps.context`. */
export interface Ctx {
	readonly subject: string;
	readonly requestId: string;
}

/**
 * The result envelope.
 *
 * An operation may return its value, or a failure this service knows how to render. Declaring it
 * here rather than in the emitter is what lets the generated `Operations` interface stay concrete.
 */
export type Result<T> = T | { readonly failure: { readonly code: string; readonly detail: string } };

/** Bound once, so every generated `deps.*` call site is typed against this app's own environment. */
export type RouteDeps = BaseRouteDeps<AppEnv, Ctx>;
