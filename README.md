# typespec-hono-example

A Cloudflare Worker whose routing, validation, types and OpenAPI document are all generated from one
TypeSpec definition, by three emitters, with **no edits to anything they produce**.

It is deployed and answering:

```
https://ledger-acceptance.bison-digital.workers.dev
```

| | |
| --- | --- |
| written by hand | `main.tsp`, `src/runtime.ts`, `src/deps.ts`, `src/index.ts` — 4 files |
| generated, never edited | `src/generated/app.gen.ts`, `schemas.gen.ts`, `document.gen.ts` |
| bundle | 664.91 KiB raw, **106.38 KiB gzipped** — against a 3 MB free-plan limit |
| worker startup | **13 ms** — against a 1 s budget |
| operations | 9, across 3 sub-apps plus an unauthenticated one |

## What it is for

Two jobs, and it is honest about both.

**A proof.** The emitters are tested by their own suites, which configure their own compiles. This
project does not. It installs the packages the way a stranger does, compiles with the options a
stranger writes, and deploys. Every defect it found was one the suites could not see, because the
suites were the thing configuring the problem away.

**A starting point.** It is the shortest complete answer to "what do I actually have to write". The
answer is four files, and three of them are small.

## Run it

```sh
pnpm install
pnpm generate     # tsp compile . — writes src/generated/
pnpm typecheck    # the generated code and your handlers, checked together
pnpm dev          # wrangler dev
pnpm deploy       # wrangler deploy
```

> **Before `typespec-hono@0.1.0` is on npm**, `^0.1.0` cannot resolve, so build the tarballs first:
>
> ```sh
> (cd ../typespec-http-zod         && pnpm build && pnpm pack)
> (cd ../typespec-hono             && pnpm build && pnpm pack)
> (cd ../typespec-openapi-document && pnpm build && pnpm pack)
> pnpm install
> ```
>
> `pnpm-workspace.yaml` redirects all three to those tarballs, and that block is deleted the day
> 0.1.0 publishes. It is `overrides` rather than `file:` specifiers in `package.json` for two reasons:
> the manifest then reads exactly as a consumer's does and needs no edit at publish time, and
> `typespec-http-zod` is a **transitive** dependency of `typespec-hono` — `pnpm add <tarball>` cannot
> reach it and fails with a 404, which is what happens if you try.

## What you write, and why it cannot be generated

`src/deps.ts` is the whole of it. Six functions, each one a decision the document does not contain:

| | the document says | your application says |
| --- | --- | --- |
| `authorize` | *which* schemes and scopes an operation demands | whether this caller satisfies them |
| `context` | whether a caller is required | who the caller is |
| `noContext` | — | what to answer when there isn't one |
| `notAcceptable` | which media types are offered | what to answer when none match |
| `invalid` | the schema | what a validation failure looks like on the wire |
| `respond` | every status arm and its schema | which arm this result is |

Everything else — which validator applies to which target, how a numeric path parameter is decoded,
which status each arm answers, when a body is `form` rather than `json`, when it is bytes rather than
text — is generated, because the document determines it.

### `authorize` gets the requirements verbatim

`@useAuth(BearerAuth)` reaches OpenAPI as `security: [{ "BearerAuth": [] }]`, and that is exactly what
the handler receives — a list of alternatives, each a map of scheme name to its scopes. Satisfying any
**one** authorises; every scheme **within** one must be satisfied together. A flat list of scopes could
not tell those apart.

```ts
authorize: (requirements) => async (c, next) => {
  const bearer = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "")?.[1];
  const satisfied = requirements.some((requirement) =>
    Object.entries(requirement).every(
      ([scheme, scopes]) => scheme === "BearerAuth" && bearer !== undefined && scopes.length === 0,
    ),
  );
  if (!satisfied) return c.json({ code: "unauthorized", detail: "bearer token required" }, 401);
  await next();
  return undefined;
},
```

Refusing an undeclared scheme is the point. An application that only checked "is somebody here" would
serve a bearer-only route to a cookie, and nothing would notice.

## What it exercises, and what each one previously broke

`main.tsp` is not a tour. Every construct in it is there because it is something a real definition asks
for **and** something that has broken one of these emitters:

- a **numeric path parameter** — `@path accountId: int64` arrives as text and must be decoded, or every
  conformant caller is refused;
- **numeric and boolean query parameters** — same decode, different target;
- **`multipart/form-data`** — whose `boundary` parameter a literal content-type check once refused;
- **a raw binary body** — `application/octet-stream`, which `c.req.text()` silently corrupted. The live
  worker is checked with 11 bytes that are not valid UTF-8, and returns all 11;
- **a scoped surface beside `@useAuth(NoAuth)`** — so the gate is graded in both directions;
- **`@server("/api/v1")`** — an OpenAPI path is relative to its server, so a router mounted at the root
  answers 404 to every client generated from the same document;
- **a bodyless 204**, **a 201**, **`@error` arms**, **pagination**, and **content negotiation**.

## Verified against the deployed worker

Not against a harness, and not against `wrangler dev`:

```
servers[0].url in the emitted document      /api/v1
GET  /api/v1/accounts        Bearer         200
GET  /api/v1/accounts        none           401
GET  /api/v1/accounts        Basic          401     ← undeclared scheme refused
GET  /accounts               unprefixed     404     ← the base path is real
GET  /api/v1/health          NoAuth         200
POST /api/v1/accounts        bad body       400
POST /api/v1/accounts        good body      201
DEL  /api/v1/accounts/7                     204
POST …/statements/raw        11 bad bytes   {"bytes":11}   ← nothing was decoded
POST …/statements            multipart      {"accepted":true}
POST …/statements            no reference   400
x-route header                              /api/v1/accounts/:accountId   ← usable as a span name
```

## Notes for anyone wiring this up

**`handlersFor` is deliberately unannotated.** Annotating it widens the value to the generated
`Operations` interface, and the surplus-key check evaporates — a handler for an operation the spec no
longer declares would then compile forever against a route nobody mounts. Leave it inferred.

**Middleware goes before `registerRoutes`.** Hono applies middleware only to routes registered after
it. Registering it afterwards does not error; it just never runs.

**`registerRoutes` returns the chained value.** That return is what `hc<typeof routes>` reads — assign
it and export its type, or the RPC client is empty.

**The root is yours.** The spec declares no operation at `/`, correctly — it is not part of the
contract. `src/index.ts` redirects it to the documentation, because an API that 404s at its own root
reads as broken.

## Licence

MIT.
