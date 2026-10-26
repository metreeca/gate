/*
 * Copyright © 2026 Metreeca srl
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * HTTP server for Express applications.
 *
 * The server takes care of the concerns every HTTP service shares, such as request logging, error responses and
 * graceful shutdown, letting applications focus on their routes. It reads no settings of its own: applications map
 * their configuration, for instance environment variables, to server options when they call `listen()`.
 *
 * @module index
 */

import { assert, isArray, isError, isNumber, isObject } from "@metreeca/core";
import { isTag } from "@metreeca/core/language";
import { isIRI } from "@metreeca/core/resource";
import { BadRequest, InternalServerError, NotFound } from "@metreeca/http";
import { log } from "@metreeca/tape";
import type { Store, StoreScope } from "@metreeca/keep";
import express, { type ErrorRequestHandler, type Express, type RequestHandler } from "express";
import type { Server as HTTPServer } from "node:http";
import { BaseSetting, ScopeSetting, StoreSetting } from "./index.core.js";


const logger = log(import.meta.url);


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * HTTP serving extension for Express applications.
 */
export type Server = {

	/**
	 * Serves the application over HTTP.
	 *
	 * Every request is traced in the log with its outcome and duration. Requests that match no route get a bodiless
	 * `404`. Errors that no route handles are logged, and the client gets a bodiless response: the error status for
	 * client errors, `500` otherwise, so that no internal detail of the failure ever reaches the client.
	 *
	 * Once listening, the server runs until the `signal` is aborted or the process receives `SIGINT` or `SIGTERM`.
	 *
	 * Closing refuses new connections at once, and gives the requests in flight the `grace` period to complete.
	 * Repeating the process signal that started the close terminates the process.
	 *
	 * Calls in the native Express form, with no argument, a port, a path or a callback, return the underlying
	 * `http.Server`. Their requests are still traced in the log, but unmatched routes and unhandled errors get the
	 * standard Express responses, and closing the server is left to the caller.
	 *
	 * @param options The server options; every option may be omitted, and `{}` applies the defaults
	 *
	 * @returns A promise resolving once the server is closed, rejecting if an option is malformed or listening fails
	 */
	listen(options: ServerOpts): Promise<void>

}

/**
 * HTTP server options.
 *
 * Configures where {@link Server.listen} accepts connections, how it identifies the resources it serves, which
 * forwarded caller addresses it trusts and how it shuts down. Every option may be omitted: the defaults suit a server
 * exposed directly to clients on a free port, serving resources under the host each request was received on.
 */
export type ServerOpts = {

	/**
	 * The address the server listens on, containing no whitespace; if omitted or empty, the server listens on every
	 * interface, over IPv4 and IPv6 alike, as containers and hosting platforms require of a server they expose.
	 *
	 * Set it to `localhost` to keep a local server unreachable from the network.
	 */
	readonly host?: string

	/**
	 * The port the server listens on, from `0` to `65535`; if omitted or `0`, the server listens on a free port
	 * assigned by the operating system, and the port actually used is logged once the server is listening.
	 */
	readonly port?: number

	/**
	 * The canonical absolute hierarchical IRI of the service, identifying the resources it serves wherever the server
	 * runs; if omitted, resources are identified by the scheme and host each request was received on.
	 *
	 * Drivers resolve request paths against it, keeping the IRIs of stored resources stable across deployments.
	 *
	 * Resolution follows RFC 3986, as for the relative IRIs in queries and bodies: request paths are root-relative, so
	 * the base contributes its scheme and authority, and any path it holds is replaced. With the base below, a request
	 * for `/products/1` addresses `https://data.example.com/products/1`, whatever host the server itself runs on.
	 *
	 * ```typescript
	 * server(store).listen({ base: "https://data.example.com/" })
	 * ```
	 */
	readonly base?: string


	/**
	 * The number of proxy hops in front of the server whose forwarded caller address is trusted; defaults to `0`.
	 *
	 * Trusted hops let routes see the address of the caller rather than that of a proxy. The default trusts no
	 * forwarded address, as fits a server exposed directly, where clients could otherwise forge their address.
	 *
	 * Set it to the number of proxies in front of the server, for instance `1` behind the front-end proxy of a hosting
	 * platform, or `2` behind a load balancer in front of that proxy. A count above the actual number of proxies trusts
	 * an address supplied by the client itself, which lets clients forge their address again as if no proxy existed.
	 */
	readonly proxies?: number

	/**
	 * The milliseconds granted to the requests in flight to complete when the server closes; `0`, the default, sets no
	 * limit of its own and leaves the limit to the hosting platform, which may kill the process before requests end.
	 *
	 * Requests still running at the end of the period have their connections closed. Set it below the period the
	 * hosting platform allows between the termination signal and a forced kill, so that the server exits cleanly.
	 */
	readonly grace?: number


	/**
	 * A signal that closes the server when aborted, as `SIGINT` or `SIGTERM` would. A signal that is already aborted
	 * when `listen()` is called closes the server as soon as it starts listening, and the returned promise resolves.
	 */
	readonly signal?: AbortSignal

}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Creates an Express application served over HTTP.
 *
 * @param store The store holding the resources the application serves, shared by every driver mounted on the
 *     application or on its sub-applications; if omitted, requests reaching a driver fail with a `500` status
 * @param scope The bounds on the page size, nesting and aggregates that client templates may ask for, enforced by
 *     every driver mounted on the application or on its sub-applications; if omitted, only shapes bound templates.
 *     Its `locale` replaces the store default for requests whose `Accept-Language` header names no language
 *
 * @returns A new Express application, whose `listen()` serves it as described by {@link Server.listen}
 *
 * @throws {@link !TypeError | TypeError} If `scope` states a `locale` with values other than language tags, a `limit`
 *     or `depth` other than a non-negative integer, or a `plain` flag other than a boolean
 */
export function server(store?: Store, scope?: StoreScope): Server & Express {

	assert(scope, isScope, `malformed scope <${JSON.stringify(scope)}>`);

	const server = express()

		.disable("x-powered-by")

		.set(StoreSetting, store)
		.set(ScopeSetting, scope)

		.use(tracing());


	return Object.assign(server, { listen });


	function listen(this: Express, options: ServerOpts): Promise<void>;
	function listen(this: Express, ...args: unknown[]): Promise<void> | HTTPServer {

		if ( isArray<ServerOpts>(args, [value => isObject(value)]) ) {

			const [{

				host = "",
				port = 0,
				base,

				proxies = 0,
				grace = 0,

				signal

			}] = args;

			return new Promise<void>((resolve, reject) => {

				assert(host, isHost, `malformed host <${host}>`);
				assert(port, isPort, `malformed port <${port}>`);
				assert(base, isBase, `malformed base <${base}>`);
				assert(proxies, isCount, `malformed proxies <${proxies}>`);
				assert(grace, isTimeout, `malformed grace <${grace}>`);

				const server: HTTPServer = Reflect.apply(express.application.listen, this

					.set("trust proxy", proxies)
					.set(BaseSetting, base)

					.use(unmatched())
					.use(unhandled()), [{ port, host }]
				);

				server.once("error", reject);

				server.once("listening", () => { // not a listen() callback, which Express 5 also invokes on failure

					server.off("error", reject); // failures after listening are no longer startup failures

					const actual: number = Object(server.address()).port ?? port; // if assigned by the operating system

					logger.info`listening on ${host || "every interface"} at port ${actual}`;

					process.once("SIGINT", close);
					process.once("SIGTERM", close);

					if ( signal?.aborted ) {
						close();
					} else {
						signal?.addEventListener("abort", close, { once: true });
					}

				});

				server.once("close", () => {

					process.off("SIGINT", close);
					process.off("SIGTERM", close);

					signal?.removeEventListener("abort", close);

					resolve();

				});


				function close(): void {

					if ( server.listening ) { // not closing yet

						logger.info`shutting down`;

						const timer = grace > 0 ? setTimeout(() => server.closeAllConnections(), grace) : undefined;

						server.close(() => clearTimeout(timer));

					}

				}

			});

		} else {

			return Reflect.apply(express.application.listen, this, args);

		}

	}

}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function isHost(value: string): boolean {
	return /^\S*$/u.test(value);
}

function isPort(value: number): boolean {
	return Number.isInteger(value) && value >= 0 && value <= 65535;
}

function isBase(value: undefined | string): boolean {
	return value === undefined || isIRI(value, "hierarchical");
}

function isScope(value: undefined | StoreScope): boolean {
	return value === undefined || (value.locale === undefined || value.locale.every(isTag))
		&& (value.limit === undefined || isCount(value.limit))
		&& (value.depth === undefined || isCount(value.depth))
		&& (value.plain === undefined || typeof value.plain === "boolean");
}

function isCount(value: number): boolean {
	return Number.isInteger(value) && value >= 0;
}

function isTimeout(value: number): boolean {
	return Number.isInteger(value) && value >= 0;
}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function tracing(): RequestHandler {

	return (request, response, next) => {

		const trace = crypto.randomUUID();
		const start = Date.now();

		logger.info("{method} {url}", {
			trace,
			method: request.method,
			url: request.url,
			userAgent: request.get("User-Agent"),
			ip: request.ip
		});

		response.locals.trace = trace;

		response.on("close", () => logger[response.statusCode >= BadRequest ? "warning" : "debug"](
			"{method} {url} {statusCode}", {
				trace,
				method: request.method,
				url: request.url,
				statusCode: response.statusCode,
				duration: Date.now()-start
			}
		));

		next();

	};

}

function unmatched(): RequestHandler {

	return (_, response) => {

		response.status(NotFound).end();

	};

}

function unhandled(): ErrorRequestHandler {

	return (error, request, response, next) => {

		const code = isStatusError(error) && error.status >= BadRequest && error.status < InternalServerError
			? error.status
			: InternalServerError;

		logger.error("{method} {url} error: {error.name} - {error.message}", {
			trace: response.locals.trace,
			error: {
				name: error.name,
				message: error.message,
				stack: error.stack
			},
			method: request.method,
			url: request.url,
			statusCode: code
		});

		if ( response.headersSent ) {
			next(error);
		} else {
			response.status(code).end();
		}

	};


	function isStatusError(value: unknown): value is Error & { status: number } {
		return isError(value) && "status" in value && isNumber(value.status);
	}

}
