/**
 * The five things the generated server cannot know, supplied once.
 *
 * Everything else is generated: routing, validation, which validator applies to which target, and
 * which status and body each response a handler returns is served with. What is left is genuinely
 * application-specific: how a request becomes a caller, and what a refusal looks like.
 */
import type { AppEnv, RouteDeps } from "./generated/runtime.gen.js";
import type { Caller } from "./env.js";

export const deps: RouteDeps<AppEnv, Caller> = {
	/**
	 * The requirements are the document's, verbatim: `[{ BearerAuth: [] }]`. Satisfying any one of them
	 * authorises; every scheme within one must be satisfied together. This app knows how to satisfy
	 * `BearerAuth` and refuses anything else rather than waving through a scheme it cannot check, which
	 * is the whole reason the scheme name is generated rather than dropped.
	 */
	authorize: (requirements) => async (c, next) => {
		// Match the PREFIX, not the remainder: `replace` on a non-bearer header is a no-op, so a
		// `Basic abc` header left a non-empty string and sailed through the first version of this.
		const bearer = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "")?.[1];
		const satisfied = requirements.some((requirement) =>
			Object.entries(requirement).every(
				([scheme, scopes]) =>
					scheme === "BearerAuth" && bearer !== undefined && scopes.length === 0,
			),
		);
		if (!satisfied) {
			return c.json({ code: "unauthorized", detail: "bearer token required" }, 401);
		}
		await next();
		return undefined;
	},

	/**
	 * Whatever this returns is the `ctx` every handler receives, and its type is inferred from here.
	 *
	 * `authentication` is what the operation declares: `"none"` admits anyone, `"optional"`
	 * (`NoAuth | BearerAuth`) recognises a caller who presents a token and admits one who does not,
	 * and `"required"` refuses a caller without one.
	 */
	context: (c, authentication) => {
		const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
		const token = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
		if (token !== "" && authentication !== "none") return { subject: token, requestId };
		return authentication === "required" ? null : { subject: "anonymous", requestId };
	},

	noContext: (c) => c.json({ code: "unauthenticated", detail: "no caller could be established" }, 401),

	notAcceptable: (c, offered) =>
		c.json({ code: "not_acceptable", detail: `offered: ${offered.join(", ")}` }, 406),

	invalid: (result, c) =>
		result.success ? undefined : c.json({ code: "invalid_request", detail: "see errors" }, 400),
};
