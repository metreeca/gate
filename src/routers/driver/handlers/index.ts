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
 * Model-driven resource handlers.
 *
 * Serves the resources a shape describes over a Keep store, so that an Express application exposes a REST API for
 * them without writing a handler of its own: each factory answers one HTTP method on the resource the request
 * addresses, with the status codes, headers and JSON payloads a REST client expects from a linked data service.
 *
 * Failures are answered by the handlers themselves:
 *
 * - `400 Bad Request` with the error message, where the query component or the JSON body cannot be decoded
 * - `415 Unsupported Media Type` with an `Accept` header, where a body is not stated as `application/json`
 * - `422 Unprocessable Content` with the violation trace as JSON, where a template or a body fails validation against
 *   the shape, with the error message, where client criteria cannot be combined with those of the server template,
 *   or with the trace or message of the rejection, where the store rejects the request
 *
 * Any other error is passed on to the error middleware of the surrounding stack.
 *
 * @module
 */

import type { ResourceShape } from "@metreeca/blue/resource";
import { error, isString, type Lazy, type Optional } from "@metreeca/core";
import { resolve } from "@metreeca/core/resource";
import type { Relay } from "@metreeca/core/relay";
import { type Trace, TraceError } from "@metreeca/core/trace";
import { BadRequest, UnprocessableContent, UnsupportedMediaType } from "@metreeca/http";
import type { Store } from "@metreeca/keep";
import type { Request, RequestHandler, Response } from "express";
import { decodeResource } from "@metreeca/qest/state";
import { text } from "node:stream/consumers";
import { BaseSetting, StoreSetting } from "../../../index.core.js";
import type { WriteHooks } from "../index.js";


/**
 * The media type request and response bodies are exchanged in.
 */
const JSONType = "application/json";


/**
 * A request failure answered by the handler itself rather than by the surrounding stack.
 */
class Rejection extends Error {

	constructor(
		readonly status: number,
		readonly body?: unknown,
		readonly headers: Readonly<Record<string, string>> = {}
	) {
		super(`rejected request <${status}>`);
	}

}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Resource handler options.
 */
export type HandlerOpts = {

	/**
	 * The shape of the resource each request addresses, possibly deferred to break definition cycles.
	 */
	readonly shape: Lazy<ResourceShape>

}


/**
 * Write handler options.
 */
export type WriteOpts = HandlerOpts & WriteHooks


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Wraps a request handler, answering the failures it is responsible for and passing on every other error.
 */
export function handler(serve: (request: Request, response: Response) => Promise<void>): RequestHandler {

	return (request, response, next) => serve(request, response).catch(cause =>
		cause instanceof Rejection ? reply(response, cause.status, cause.body, cause.headers)
			: cause instanceof TraceError ? reply(response, UnprocessableContent, cause.cause)
				: cause instanceof RangeError ? reply(response, UnprocessableContent, cause.message)
					: next(cause)
	);

}

/**
 * Answers a request with a status, an optional JSON body and optional headers.
 */
function reply(response: Response, status: number, body?: unknown, headers: Readonly<Record<string, string>> = {}) {

	return body === undefined
		? response.status(status).set(headers).end()
		: response.status(status).set(headers).json(body);

}


/**
 * Retrieves the store the application serving a request was created with.
 *
 * @throws {@link !Error | Error} Where the application was created with no store
 */
export function storage(request: Request): Store {

	const store: undefined | Store = request.app.get(StoreSetting);

	return store ?? error(new Error("undefined application store"));

}

/**
 * Retrieves the base IRI that client IRIs are relative to: the server `base`, or else the request scheme and host.
 */
export function base(request: Request): string {

	const server: unknown = request.app.get(BaseSetting);

	return isString(server) ? server : `${request.protocol}://${request.get("host")}`;

}

/**
 * Identifies the resource a request addresses, as an absolute IRI with no query, its path resolved against {@link base}.
 */
export function target(request: Request): string {

	const $base = base(request);

	return resolve($base, new URL(request.originalUrl, $base).pathname);

}

/**
 * Reads the JSON body of a request, reusing one already parsed by an upstream middleware, with its root-relative
 * IRIs resolved against the {@link base} of the request, so that hooks and validation only ever see absolute IRIs.
 */
export async function body(request: Request): Promise<unknown> {

	return !request.is(JSONType) ? Promise.reject(new Rejection(UnsupportedMediaType, undefined, { Accept: JSONType }))
		: (request.body !== undefined ? Promise.resolve(JSON.stringify(request.body)) : text(request))
			.then(json => decodeResource(json, { base: base(request), lenient: true }))
			.catch(cause => Promise.reject(new Rejection(BadRequest, message(cause))));

}

/**
 * Runs a decoding task, turning any failure into a `400 Bad Request` rejection.
 */
export function decoding<T>(task: () => T): T {

	try {
		return task();
	} catch ( cause ) {
		throw new Rejection(BadRequest, message(cause));
	}

}

/**
 * Unwraps a validation relay, turning a violation trace into a `422 Unprocessable Content` rejection.
 */
export function checked<T>(relay: Relay<{ readonly value: T, readonly trace: Optional<Trace> }>): T {

	return relay({
		value: value => value,
		trace: trace => error(new Rejection(UnprocessableContent, trace))
	});

}

/**
 * Retrieves the message of a thrown value.
 */
function message(cause: unknown): string {

	return cause instanceof Error ? cause.message : String(cause);

}


