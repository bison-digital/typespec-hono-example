/**
 * The four things the generated server cannot know, supplied once.
 *
 * ⚠️ **Everything else is generated.** Routing, validation, which validator applies to which target,
 * what status each arm answers — none of it is here. What is left is genuinely application-specific:
 * how a request becomes a caller, and how a result becomes a response.
 */
import { armFor, type Ctx, type RouteDeps } from "./runtime.js";

/** A failure the service knows how to render, as opposed to a thrown error. */
function isFailure(value: unknown): value is { failure: { code: string; detail: string } } {
	return typeof value === "object" && value !== null && "failure" in value;
}

export const deps: RouteDeps = {
	/**
	 * ⚠️ **The requirements are the document's, verbatim** — `[{ BearerAuth: [] }]`. Satisfying any one
	 * of them authorises; every scheme within one must be satisfied together. This app knows how to
	 * satisfy `BearerAuth` and refuses anything else rather than waving through a scheme it cannot
	 * check, which is the whole reason the scheme name is generated rather than dropped.
	 */
	authorize: (requirements) => async (c, next) => {
		// ⚠️ Match the PREFIX, not the remainder: `replace` on a non-bearer header is a no-op, so a
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

	context: (c, authentication) => {
		const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
		if (authentication === "none") return { subject: "anonymous", requestId } satisfies Ctx;
		const token = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
		if (token === "") return null;
		return { subject: token, requestId } satisfies Ctx;
	},

	noContext: (c) => c.json({ code: "unauthenticated", detail: "no caller could be established" }, 401),

	notAcceptable: (c, offered) =>
		c.json({ code: "not_acceptable", detail: `offered: ${offered.join(", ")}` }, 406),

	invalid: (result, c) =>
		result.success ? undefined : c.json({ code: "invalid_request", detail: "see errors" }, 400),

	/**
	 * ⚠️ **The arm is chosen from what the DOCUMENT declares**, not guessed from the value's shape.
	 * `armFor` reads the emitted `Responses` array, including `4XX` and `default`, so a failure lands
	 * on the status the contract promises rather than a convention this file invented.
	 */
	respond: (c, arms, result) => {
		if (isFailure(result)) {
			const arm = armFor(arms, 400) ?? arms.find((a) => a.status !== 200);
			const status = Number(arm?.status ?? 400);
			return c.json(result.failure, (Number.isFinite(status) ? status : 400) as 400);
		}
		const success = arms.find((arm) => Number(arm.status) < 400) ?? arms[0];
		const status = Number(success?.status ?? 200);
		if (success?.schema === undefined) return new Response(null, { status: status || 204 });
		return c.json(result as never, (status || 200) as 200);
	},
};
