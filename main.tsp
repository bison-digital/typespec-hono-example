import "@typespec/http";

using Http;

/**
 * A small ledger service.
 *
 * Every construct here is present because it is something an API definition legitimately asks for and
 * something that has previously broken one of these emitters: numeric path parameters, a scoped
 * surface beside an unauthenticated one, content negotiation, a multipart upload, a raw binary body,
 * pagination, error arms, and a bodyless success.
 */
@service(#{ title: "Ledger" })
@server("/api/v1", "Versioned base path")
namespace Ledger;

@error
model Problem {
  code: string;
  detail: string;
}

model Account {
  id: int64;
  name: string;
  balanceMinor: int64;
  currency: string;
  active: boolean;
  openedAt: utcDateTime;
}

model Entry {
  id: int64;
  accountId: int64;
  amountMinor: int64;
  memo?: string;
  postedAt: utcDateTime;
}

model Page<T> {
  items: T[];
  nextCursor?: string;
  total: int32;
}

@route("/accounts")
@useAuth(BearerAuth)
interface Accounts {
  /** Numeric query parameters, which arrive as text and must be decoded. */
  @get list(@query limit?: int32, @query cursor?: string, @query activeOnly?: boolean): Page<Account>;

  /** A numeric PATH parameter - the shape that refused every conformant caller. */
  @get read(@path accountId: int64): Account | Problem;

  @post create(@body body: Account): {
    @statusCode statusCode: 201;
    @body body: Account;
  } | Problem;

  /** A bodyless success. */
  @delete close(@path accountId: int64): {
    @statusCode statusCode: 204;
  } | Problem;
}

@route("/accounts/{accountId}/entries")
@useAuth(BearerAuth)
interface Entries {
  @get list(@path accountId: int64, @query limit?: int32): Page<Entry>;
  @post add(@path accountId: int64, @body body: Entry): Entry | Problem;
}

model StatementUpload {
  /** A binary part - the library emits `z.unknown()`, and the handler must receive it intact. */
  file: HttpPart<File>;
  reference: HttpPart<string>;
}

@route("/accounts/{accountId}/statements")
@useAuth(BearerAuth)
interface Statements {
  /** multipart/form-data, whose boundary parameter a literal content-type validator once refused. */
  @post upload(
    @path accountId: int64,
    @header contentType: "multipart/form-data",
    @multipartBody body: StatementUpload,
  ): {
    @statusCode statusCode: 202;
    @body body: { accepted: boolean };
  } | Problem;

  /** A raw binary body, which `c.req.text()` silently corrupted. */
  @route("/raw")
  @post attach(
    @path accountId: int64,
    @header contentType: "application/octet-stream",
    @body body: bytes,
  ): {
    @statusCode statusCode: 202;
    @body body: { bytes: int32 };
  } | Problem;
}

/**
 * **A payee's id is the server's to assign**: read-only, so a create body leaves it out - the commonest
 * CRUD shape there is, and the one `typespec-http-zod` 0.31.0 refused at openapi3's default, OpenAPI
 * 3.0, which requires a read-only property "on the response only". `pnpm smoke` sends it.
 */
model Payee {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}

@route("/payees")
@useAuth(BearerAuth)
interface Payees {
  @post create(@body body: Payee): {
    @statusCode statusCode: 201;
    @body body: Payee;
  } | Problem;
}

/** An unauthenticated surface beside the scoped one, so `@useAuth(NoAuth)` is exercised. */
@route("/health")
@useAuth(NoAuth)
interface Health {
  @get check(): { status: string; version: string };
}
