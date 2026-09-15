# typespec-hono-example

A Cloudflare Worker whose routing, validation, types and OpenAPI document are all generated from one
TypeSpec definition, by three emitters, with **no edits to anything they produce**.

It is deployed and answering:

```
https://ledger-acceptance.bison-digital.workers.dev
```

| | |
| --- | --- |
| written by hand | `main.tsp`, `src/env.ts`, `src/deps.ts`, `src/index.ts`, 4 files |
| generated, never edited | `src/generated/app.gen.ts`, `runtime.gen.ts`, `schemas.gen.ts`, `document.gen.ts` |
| bundle | 846.25 KiB raw, **136.79 KiB gzipped**, against a 3 MB free-plan limit |
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

> Everything installs from npm. The versions here are the published ones, and a fresh
> `pnpm install` in an empty checkout is the whole setup.

## What you write, and why it cannot be generated

`src/deps.ts` is the whole of it. Five functions, each one a decision the document does not contain:

| | the document says | your application says |
| --- | --- | --- |
| `authorize` | *which* schemes and scopes an operation demands | whether this caller satisfies them |
| `context` | whether a caller is required | who the caller is |
| `noContext` | — | what to answer when there isn't one |
| `notAcceptable` | which media types are offered | what to answer when none match |
| `invalid` | the schema | what a validation failure looks like on the wire |

Everything else, which validator applies to which target, how a numeric path parameter is decoded,
when a body is `form` rather than `json`, when it is bytes rather than text, and which status and body
each response is served with, is generated, because the document determines it.

### A handler returns any response its operation declares

`Accounts_read` declares `Account | Problem`, so a missing account is the `404` the document publishes,
returned rather than thrown:

```ts
Accounts_read: (_ctx, input) => {
  const account = accounts.get(input.accountId);
  return account === undefined
    ? { status: 404, body: { code: "not_found", detail: `no account ${input.accountId}` } }
    : { status: 200, body: account };
},
```

A status the operation does not declare, or the wrong body for a status, does not compile. What is served
is the body parsed against the schema the document publishes for that status, and the typed client in
`src/client.ts` narrows the body by `response.status`.

### The environment and the caller are yours, and nothing is substituted

`src/env.ts` adds this Worker's bindings and variables to the `AppEnv` the generated server mounts on, by
augmenting it, and declares the `Caller` that `deps.context` returns. Every handler receives that
`Caller` as `ctx`, inferred from `deps` rather than declared in a copy of the runtime.

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

**The handler object uses `satisfies Operations<Caller>`, not an annotation.** `satisfies` keeps each
`status` a literal, which is what selects the response it belongs to, and leaves the value unwidened, so
the surplus-key check still refuses a handler for an operation the spec no longer declares. An
annotation widens it and the check evaporates.

**A response the document does not permit reaches `app.onError`**, as `ResponseContractError` or
`UndeclaredStatusError`. `src/index.ts` answers it with a 500, because it is the service's own fault.

**Middleware goes before `registerRoutes`.** Hono applies middleware only to routes registered after
it. Registering it afterwards does not error; it just never runs.

**`registerRoutes` returns the chained value.** That return is what `hc<typeof routes>` reads — assign
it and export its type, or the RPC client is empty.

**The root is yours.** The spec declares no operation at `/`, correctly — it is not part of the
contract. `src/index.ts` redirects it to the documentation, because an API that 404s at its own root
reads as broken.

## Licence

MIT.
