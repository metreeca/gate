# @metreeca/gate

[![npm](https://img.shields.io/npm/v/@metreeca/gate)](https://www.npmjs.com/package/@metreeca/gate)

Zero-code model-driven endpoints for linked data resources.

**@metreeca/gate** serves linked data resources over HTTP straight from the resource models that describe them:

- **Model-Driven Endpoints**: shapes defined with [@metreeca/blue](https://github.com/metreeca/blue) drive retrieval,
  creation, replacement and removal of resources held in a [@metreeca/keep](https://github.com/metreeca/keep) store
- **Client-Driven Retrieval**: clients choose what to retrieve with [@metreeca/qest](https://github.com/metreeca/qest)
  templates, and filter collections with plain form data, always within the bounds the server sets
- **Portable Identifiers**: resources keep stable IRIs across deployments, exchanged in root-relative form with clients
- **Production-Ready Hosting**: request logging, bodiless error responses and graceful shutdown for containers
- **Same-Origin Companions**: browser clients and background jobs served by the same application as the API

> [!NOTE]
>
> **@metreeca/gate** is part of the
> [@metreeca/qest integrated ecosystem](https://github.com/metreeca/qest#ecosystem)
> for rapid development of linked data applications.

# Installation

```shell
npm install @metreeca/gate express
```

> [!WARNING]
>
> TypeScript consumers must use `"moduleResolution": "nodenext"/"node16"/"bundler"` in `tsconfig.json`.
> The legacy `"node"` resolver is not supported.

# Usage

> [!NOTE]
>
> This section introduces essential concepts; for complete coverage, see the API reference:
>
> | Module                    | Description                          |
> |---------------------------|--------------------------------------|
> | [@metreeca/gate]          | HTTP server for Express applications |
> | [@metreeca/gate/driver]   | Model-driven resource drivers        |
> | [@metreeca/gate/client]   | Browser client hosting               |
> | [@metreeca/gate/worker]   | Worker hosting                       |

[@metreeca/gate]: https://metreeca.github.io/gate/modules/index.html

[@metreeca/gate/driver]: https://metreeca.github.io/gate/modules/driver.html

[@metreeca/gate/client]: https://metreeca.github.io/gate/modules/client.html

[@metreeca/gate/worker]: https://metreeca.github.io/gate/modules/worker.html

## Serving Applications

`server()` creates an Express application that already takes care of request logging, error responses and graceful
shutdown. Define its routes as usual, then serve it over HTTP with `listen()`, passing the server options:

```typescript
import { server } from "@metreeca/gate";

await server()

	.get("/", (request, response) => response.send("hello"))

	.listen({ port: 8080 }); // settles once the server is closed
```

The server runs until it receives `SIGINT` or `SIGTERM`, or until the `signal` option is aborted. Requests that match
no route get a bodiless `404`, and unhandled errors get a bodiless response with no internal detail.

Behind a proxy, declare the hops to trust, so that routes see the address of the caller rather than that of the proxy.
Keep the shutdown within the grace period the hosting platform allows before a forced kill:

```typescript
await server()

	.get("/", (request, response) => response.send(`hello ${request.ip}`)) // the caller, not the proxy

	.listen({
		port: Number(process.env.PORT ?? 8080),
		proxies: 1,  // one front-end proxy, as on Cloud Run
		grace: 8_000 // below the 10 seconds Cloud Run waits before killing the container
	});
```

## Serving Resources

Drivers expose the resources a shape describes as a REST/JSON API. Pass the store holding the resources to `server()`,
then mount a driver on each route, enabling only the HTTP methods the route supports:

```typescript
import { server } from "@metreeca/gate";
import { driver } from "@metreeca/gate/driver";
import { number } from "@metreeca/blue/number";
import { reference } from "@metreeca/blue/reference";
import { id, multiple, required, resource } from "@metreeca/blue/resource";
import { string } from "@metreeca/blue/string";
import { store } from "./store.js"; // any @metreeca/keep store

await server(store)

	.use("/products/", driver(Products).lookup().create())
	.use("/products/:id", driver(Product).lookup().update().delete())

	.listen({
		port: 8080,
		base: "https://data.example.com/"
	});

function Products() {
	return resource({
		id: id(),
		items: multiple(reference(Product))
	});
}

function Product() {
	return resource({
		id: id(),
		name: required(string()),
		price: required(number({ minInclusive: 0 }))
	});
}
```

The `base` option names the canonical IRI of the service, so stored resources keep the same identifiers wherever the
server runs. Without it, resources are identified by the scheme and host each request was received on.

Each enabled method follows the payload conventions of [@metreeca/qest](https://github.com/metreeca/qest#usage):

| Method    | Enabled by       | Request body | Response                                                          |
|-----------|------------------|--------------|-------------------------------------------------------------------|
| GET, HEAD | `lookup()`       | none         | `200 OK` with the resource, `404 Not Found`                       |
| POST      | `create()`       | resource     | `201 Created` with the `Location` of the new item, `409 Conflict` |
| PUT       | `update()`       | resource     | `204 No Content`, `404 Not Found`                                 |
| DELETE    | `delete()`       | none         | `204 No Content`, `404 Not Found`                                 |
| OPTIONS   | any of the above | none         | `204 No Content` with an `Allow` header                           |

Methods not enabled are answered with `405 Method Not Allowed`. Templates and request bodies are validated against the
shape, and a violation is answered with `422 Unprocessable Content` and a trace of every violation found.

A bare `GET` returns the default view of the resource, as the shape describes it. Linked resources are returned as
references, and IRIs sharing the scheme and authority of the `base` are exchanged in root-relative form:

```http request
GET https://data.example.com/products/
```

```json
{
  "id": "/products/",
  "items": [
    "/products/123",
    "/products/456"
  ]
}
```

Clients may state a [template](https://github.com/metreeca/qest#client-driven-retrieval) in the query string to choose
what to retrieve, or filter the collection with plain form data, as an HTML form would submit it:

```http request
GET https://data.example.com/products/?~name=widget&price>=50
```

```json
{
  "items": [
    "/products/123"
  ]
}
```

Hooks adapt each driver to the needs of its route:

- **`lookup({ model })`**: fixes the entries and collection views clients receive with a server template, possibly
  computed for each request, as when scoping a collection to the resources the current user or tenant may see
- **`lookup({ review })`**: reviews each retrieved resource before it is served, and may hide it behind a `404`
- **`create({ decode })`, `update({ decode })`**: prepare request bodies before validation, for instance filling in
  defaults or stamping the resource with its author, so that clients never have to state them

Driver endpoints follow the protocol of the
[@metreeca/keep-rest](https://metreeca.github.io/keep/modules/_metreeca_keep-rest.html) connector, so remote
applications may access the published resources through the standard `@metreeca/keep` store API. Drivers support the
`lookup()`, `create()`, `update()` and `delete()` store methods. They ignore the `Prefer: handling=lenient` header,
so `insert()` succeeds only on resources that already exist, while `remove()` behaves as usual.

> [!WARNING]
>
> Drivers set no limit on the size of request bodies, so untrusted clients may send arbitrarily large ones. Mount
> `express.json({ limit })` ahead of the drivers to bound them: drivers then reuse the body that parser reads.

> [!WARNING]
>
> Client templates choose their own page size, nesting and aggregates, and nothing bounds them by default. Create the
> server with `server(store, { limit, depth, plain })` to cap every route at once. Requests exceeding the caps are
> rejected with `422 Unprocessable Content` before they reach the store, so they never load it with oversized queries.

## Hosting Clients

To deliver a browser client from the same origin as the API, mount `client()` ahead of the API routes. Pass it the
folder holding the client build, or the path of its entry page when it is not named `index.html`:

```typescript
import { server } from "@metreeca/gate";
import { client } from "@metreeca/gate/client";

await server()

	.use(client("./dist/client")) // serves index.html to navigation requests, static assets otherwise

	.get("/items", (request, response) => response.json([]))

	.listen({ port: 8080 });
```

Navigation requests from the browser receive the entry page whatever their path, so client-side addresses survive a
reload. Requests for API resources at the same address fall through to the API routes.

## Running Workers

To run a background job on request, for instance from a scheduler, mount `worker()` on a dedicated route:

```typescript
import { server } from "@metreeca/gate";
import { worker } from "@metreeca/gate/worker";

await server()

	.post("/jobs/sync", worker(async () => sync())) // answers 200 OK once sync() completes

	.listen({ port: 8080 });
```

The caller learns the outcome from the status code alone. A completed run is acknowledged with an empty `200 OK`, and
the error middleware of the application answers a failed one. The worker performs no authentication of its own, so
access control is left to the surrounding routes, for instance to the IAM checks of the hosting platform.

# Support

- Open an [issue](https://github.com/metreeca/gate/issues) to report a problem or to suggest a new feature
- Start a [discussion](https://github.com/metreeca/gate/discussions) to ask a how-to question or to share an idea

# License

This project is licensed under the Apache 2.0 License –
see [LICENSE](https://github.com/metreeca/gate?tab=Apache-2.0-1-ov-file) file for details.
