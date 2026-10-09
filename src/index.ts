export {};


// !!! document that gate endpoint are compatible with the protocol defined by keep/proxy


/*
 * Copyright © 2026 Metreeca srl. All rights reserved.
 */

/**
 * HTTP server hosting an Express router behind a proxy.
 *
 * The server lifecycle is exported as {@link server}, configured with {@link HTTPOpts} whose defaults fit a container
 * behind a single front-end proxy, as on Cloud Run. The module reads no settings of its own: applications map their
 * configuration, for instance the environment, to options.
 *
 * Every request is traced in the log with its outcome and duration. Requests that match no route get a bodiless
 * `404`. Errors that no route handles are logged, and the client gets a bodiless response with no internal detail: the
 * error status if it is a client error, `500` otherwise.
 *
 * @module gate
 */

import { assert, isError, isNumber } from "@metreeca/core";
import { BadRequest, InternalServerError, NotFound } from "@metreeca/http";
import { log } from "@metreeca/tape";
import express, { type ErrorRequestHandler, type RequestHandler, type Router } from "express";
import type { Server } from "node:http";


/**
 * The HTTP server.
 *
 * One server runs at a time: a router may be started again only after the running server stops.
 */
export const server: {

	/**
	 * Starts serving a router over HTTP.
	 *
	 * Once listening, the server stops on `SIGINT` or `SIGTERM` as by `stop()` with the `shutdown` timeout; a
	 * second signal while stopping terminates the process.
	 *
	 * @param router The router serving the application
	 * @param opts The server options
	 *
	 * @returns A promise resolving when the server is listening, and rejecting if an option is malformed, a server is
	 *     already running or the server fails to listen
	 */
	start(router: Router, opts?: {

		/**
		 * The address the server listens on; if omitted or empty, the server listens on every interface, over IPv4 and
		 * IPv6 alike, as containers and hosting platforms require. Set it to `localhost` to keep a local server
		 * unreachable from the network
		 */
		readonly host?: string;

		/**
		 * The port the server listens on, from `0` to `65535`; defaults to `8080`.
		 */
		readonly port?: number;

		/**
		 * The number of proxy hops in front of the server whose forwarded caller address is trusted, so that the
		 * router
		 * sees the address of the caller rather than that of a proxy; defaults to `1`.
		 *
		 * Set it to `0` when the server is exposed directly, as clients could otherwise forge their address, or to the
		 * number of proxies when more than one is chained, for instance `2` behind a load balancer in front of the
		 * platform proxy.
		 */
		readonly proxies?: number;

		/**
		 * The milliseconds a stop triggered by `SIGINT` or `SIGTERM` waits for the requests in flight before closing
		 * their connections; `0`, the default, waits for them indefinitely, leaving the limit to the hosting platform.
		 *
		 * Set it below the grace period the hosting platform allows between the signal and a forced kill, 10 seconds
		 * on
		 * Cloud Run, so that the server closes lingering connections and exits cleanly before being killed.
		 */
		readonly shutdown?: number;

	}): Promise<void>;

	/**
	 * Stops the running server.
	 *
	 * New connections are refused at once, while the requests in flight are completed. Calls made while the server is
	 * stopping share the same outcome; calls made while no server is running resolve at once.
	 *
	 * @param timeout The milliseconds to wait for the requests in flight before closing their connections; `0`, the
	 *     default, waits for them indefinitely
	 *
	 * @returns A promise resolving when the server is stopped, and rejecting if `timeout` is malformed
	 */
	stop(timeout?: number): Promise<void>;

} = Object.freeze<typeof server>({

	start,
	stop

});


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const logger = log(import.meta.url);

// the server currently running, its signal shutdown timeout and its pending stop, if any; shared by every call to
// start() and stop()

let state: undefined | {

	readonly instance: Server;
	readonly shutdown: number;
	readonly stopping?: Promise<void>;

};


async function start(router: Router, {

	host = "",
	port = 8080,
	proxies = 1,
	shutdown = 0

}: {

	/**
	 * The address the server listens on; if omitted or empty, the server listens on every interface, over IPv4 and
	 * IPv6 alike, as containers and hosting platforms require. Set it to `localhost` to keep a local server
	 * unreachable from the network
	 */
	readonly host?: string;

	/**
	 * The port the server listens on, from `0` to `65535`; defaults to `8080`.
	 */
	readonly port?: number;

	/**
	 * The number of proxy hops in front of the server whose forwarded caller address is trusted, so that the router
	 * sees the address of the caller rather than that of a proxy; defaults to `1`.
	 *
	 * Set it to `0` when the server is exposed directly, as clients could otherwise forge their address, or to the
	 * number of proxies when more than one is chained, for instance `2` behind a load balancer in front of the platform
	 * proxy.
	 */
	readonly proxies?: number;

	/**
	 * The milliseconds a stop triggered by `SIGINT` or `SIGTERM` waits for the requests in flight before closing their
	 * connections; `0`, the default, waits for them indefinitely, leaving the limit to the hosting platform.
	 *
	 * Set it below the grace period the hosting platform allows between the signal and a forced kill, 10 seconds on
	 * Cloud Run, so that the server closes lingering connections and exits cleanly before being killed.
	 */
	readonly shutdown?: number;

} = {}): Promise<void> {

	if ( state ) {

		throw new Error("conflicting start() call while server is running");

	} else {

		const $port = assert(port, isPort, `malformed port <${port}>`);
		const $proxies = assert(proxies, isCount, `malformed proxies <${proxies}>`);
		const $shutdown = assert(shutdown, isCount, `malformed shutdown <${shutdown}>`);

		return new Promise<void>((resolve, reject) => {

			const instance = express()

				.set("trust proxy", $proxies)
				.disable("x-powered-by")

				.use(tracing())

				.use(router)

				.use(unmatched())
				.use(unhandled())

				.listen({ port: $port, host }, (error?: Error) => { // invoked once, with the error if listening fails

					if ( error ) {

						state = undefined;

						reject(error);

					} else {

						process.once("SIGINT", signal);
						process.once("SIGTERM", signal);

						logger.info`listening on ${host || "every interface"} at port ${$port}`;

						resolve();

					}

				});

			state = { instance, shutdown: $shutdown };

		});

	}

}

function stop(timeout = 0): Promise<void> {

	if ( !isCount(timeout) ) {

		return Promise.reject(new TypeError(`malformed timeout <${timeout}>`));

	} else if ( state === undefined ) {

		return Promise.resolve();

	} else if ( state.stopping ) {

		return state.stopping;

	} else {

		const { instance, shutdown } = state;

		const stopping = new Promise<void>((resolve, reject) => {

			logger.info`shutting down`;

			const timer = timeout > 0 ? setTimeout(() => instance.closeAllConnections(), timeout) : undefined;

			instance.close(error => {

				clearTimeout(timer);

				process.off("SIGINT", signal);
				process.off("SIGTERM", signal);

				state = undefined;

				if ( error ) {
					reject(error);
				} else {
					resolve();
				}

			});

		});

		state = { instance, shutdown, stopping };

		return stopping;

	}

}

function signal(): void {
	stop(state?.shutdown).catch(error => logger.error("{error}", { error }));
}

function isCount(value: number): boolean {
	return Number.isInteger(value) && value >= 0;
}

function isPort(value: number): boolean {
	return isCount(value) && value <= 65535;
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
