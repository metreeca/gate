# @metreeca/gate

[![npm](https://img.shields.io/npm/v/@metreeca/gate)](https://www.npmjs.com/package/@metreeca/gate)

Zero-code model-driven endpoints for linked data resources.

**@metreeca/gate** serves linked data resources over HTTP straight from the resource models that describe them, with no
endpoint code to write.

# Installation

```shell
npm install @metreeca/gate
```

> [!WARNING]
>
> TypeScript consumers must use `"moduleResolution": "nodenext"/"node16"/"bundler"` in `tsconfig.json`.
> The legacy `"node"` resolver is not supported.

# Usage

> [!NOTE]
>
> This section introduces essential concepts and common patterns of serving Express applications: see the
> [API reference](https://metreeca.github.io/gate/) for complete coverage of the server options and behaviour.

`server()` creates an Express application that already takes care of request logging, error responses and graceful
shutdown. Define its routes as usual, then serve it over HTTP with `listen()`, passing the server options:

```typescript
import { server } from "@metreeca/gate";

const app = server();

app.get("/", (request, response) => response.send("hello"));

await app.listen({ port: 8080 }); // settles once the server is closed
```

The server runs until it receives `SIGINT` or `SIGTERM`, or until the `signal` option is aborted. Requests that match
no route get a bodiless `404`, and unhandled errors get a bodiless response with no internal detail.

Behind a proxy, declare the hops to trust, so that routes see the address of the caller rather than that of a proxy,
and keep the shutdown within the grace period the hosting platform allows before a forced kill:

```typescript
await app.listen({
	port: Number(process.env.PORT ?? 8080),
	proxies: 1,  // one front-end proxy, as on Cloud Run
	grace: 8_000 // below the 10 seconds Cloud Run waits before killing the container
});
```

<!-- !!! document that gate endpoint are compatible with the protocol defined by keep/proxy -->

# Support

- Open an [issue](https://github.com/metreeca/gate/issues) to report a problem or to suggest a new feature
- Start a [discussion](https://github.com/metreeca/gate/discussions) to ask a how-to question or to share an idea

# License

This project is licensed under the Apache 2.0 License –
see [LICENSE](https://github.com/metreeca/gate?tab=Apache-2.0-1-ov-file) file for details.
