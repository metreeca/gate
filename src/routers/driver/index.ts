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
 * Model-driven resource drivers.
 *
 * Serves resources held in a `@metreeca/keep` store, so that an Express application exposes a REST API for the
 * resources a shape describes. The application enables the HTTP methods each route supports, with no handler to write.
 *
 * ```typescript
 * server(store)
 *     .use("/products/", driver(Products).lookup().create())
 *     .use("/products/:id", driver(Product).lookup().update().delete());
 * ```
 *
 * Drivers serve the store the application was created with, hold client templates to the application `scope`, and
 * identify resources by the `base` the server was started with, so that every driver of an application shares them.
 * Without a store, requests reaching a driver fail, and the error middleware of the surrounding stack answers them.
 *
 * IRIs sharing the scheme and authority of the base are exchanged in root-relative form. Response bodies and `Location`
 * headers always state them so, and request bodies may state them so. Decoding hooks and validation only ever see
 * absolute IRIs. Without a base, the scheme and host each request was received on stand in for it.
 *
 * Each driver is an Express handler mounted with `use()`, like a nested router. It serves the path it is mounted on,
 * with or without a trailing slash, and passes requests for paths below it on to the next handler of the stack, so
 * that the drivers of a container and of its items may be mounted on nested paths. Methods are enabled Express style,
 * on the driver itself, and may be enabled after the driver is mounted; enabling the same method again replaces its
 * options. Once at least one method is enabled, every request for the mount path is answered by the driver itself:
 *
 * - `HEAD` through the `GET` handler, where `GET` is enabled
 * - `OPTIONS` with `204 No Content` and an `Allow` header listing the methods enabled
 * - any other method not enabled with `405 Method Not Allowed` and the same `Allow` header
 *
 * A driver with no method enabled passes every request on to the next handler of the surrounding stack.
 *
 * **Request bodies**
 *
 * Drivers read JSON request bodies on their own, so an application serving only drivers needs no body parser. A body
 * must be stated as `application/json`: other media types are answered with `415 Unsupported Media Type`, and a body
 * that is not valid JSON with `400 Bad Request`. Where an upstream `express.json()` has already parsed the body, the
 * driver uses that result instead of reading the request again, so the limits that parser enforces still apply.
 *
 * > [!WARNING]
 * > Drivers set no limit on the size of the bodies they read, so an untrusted client may send arbitrarily large
 * > ones. To bound them, mount `express.json({ limit })` ahead of the drivers, which then reuse the body it parses:
 * >
 * > ```typescript
 * > server(store)
 * >     .use(express.json({ limit: "1mb" }))
 * >     .use("/products/", driver(Products).lookup().create());
 * > ```
 *
 * **Failures**
 *
 * Drivers answer the failures of a request on their own:
 *
 * - `400 Bad Request` with the error message, where the query component or the JSON body cannot be decoded
 * - `415 Unsupported Media Type` with an `Accept` header, where a body is not stated as `application/json`
 * - `422 Unprocessable Content` with the violation trace as JSON, where a template or a body fails validation against
 *   the shape or the server `scope`, with the error message, where client criteria cannot be combined with those of
 *   the server template, or with the trace or message of the rejection, where the store rejects the request
 *
 * Any other error is passed on to the error middleware of the surrounding stack.
 *
 * @module
 */

import type { ResourceShape } from "@metreeca/blue/resource";
import type { Lazy, Optional } from "@metreeca/core";
import { DELETE, GET, HEAD, MethodNotAllowed, NoContent, OPTIONS, POST, PUT } from "@metreeca/http";
import type { Template } from "@metreeca/qest/model";
import type { Resource } from "@metreeca/qest/state";
import type { Request, RequestHandler } from "express";
import { create as createHandler } from "./handlers/create.js";
import { deleet as deleetHandler } from "./handlers/delete.js";
import { lookup as lookupHandler } from "./handlers/lookup.js";
import { update as updateHandler } from "./handlers/update.js";


/**
 * The methods a driver may list in its `Allow` header, in the order they are listed.
 */
const Methods: readonly string[] = [GET, HEAD, POST, PUT, DELETE, OPTIONS];


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Retrieval hooks, as accepted by the `lookup()` method of a {@link Driver}.
 */
export type LookupHooks = {

	/**
	 * The server template fixing the entries it states and the collection views clients filter within; if omitted,
	 * the shape alone describes what clients may retrieve, hidden members included.
	 *
	 * Stated as a function, the template is computed for each request, so that the view served may depend on the
	 * caller, as when scoping a collection to the resources a user or tenant may see.
	 */
	readonly model?: Template | ((request: Request) => Template)

	/**
	 * Reviews the retrieved resource before it is served, returning the resource to send, or `undefined` to answer
	 * `404 Not Found` as if the store held no such resource, as when the caller may not see it.
	 */
	readonly review?: (match: Resource, request: Request) => Optional<Resource> | Promise<Optional<Resource>>

}

/**
 * Write hooks, as accepted by the `create()` and `update()` methods of a {@link Driver}.
 */
export type WriteHooks = {

	/**
	 * Prepares the decoded JSON body of each request before it is validated, so that defaults may be filled in or
	 * values derived from the request, as when stamping the resource with its author.
	 */
	readonly decode?: (state: unknown, request: Request) => unknown | Promise<unknown>

}


/**
 * Model-driven resource driver.
 *
 * Serves a resource through the HTTP methods enabled on it: its retrieval, the creation of new resources in the
 * collection it holds, its replacement and its removal, so that one driver serves containers, items and standalone
 * resources alike, each enabling only the methods its role in the API calls for and answering others with `405`.
 */
export type Driver = RequestHandler & {

	/**
	 * Enables `GET` and `HEAD`, retrieving the resource.
	 *
	 * The query component of the request selects what to retrieve. It may state a `@metreeca/qest` template, or
	 * form-encoded criteria filtering the collection the resource holds, as a client filtering a list would state them.
	 * An empty query retrieves the default view the shape describes. Localised content is negotiated through the
	 * `Accept-Language` header. If the header names no language, the server `locale` applies, or else the store default.
	 *
	 * - `200 OK` with the resource as JSON
	 * - `404 Not Found` where the store holds no such resource, or the `review` hook withholds it
	 *
	 * @param hooks Retrieval hooks; if omitted, the shape alone describes what clients may retrieve
	 *
	 * @returns This driver
	 */
	lookup(hooks?: LookupHooks): Driver

	/**
	 * Enables `POST`, creating a resource from the request body in the collection the resource holds.
	 *
	 * The body is validated against the shape of the collected resources. A body stating no identifier is named after
	 * the `Slug` header, or given a generated name where the header is missing or holds no letter or digit.
	 *
	 * - `201 Created` with a `Location` header pointing to the new resource
	 * - `409 Conflict` where the store refuses to create the resource, as when its identifier is taken
	 *
	 * @param hooks Write hooks
	 *
	 * @returns This driver
	 *
	 * @throws {@link !TypeError | TypeError} Where the shape holds no collection ranging over resources, or several
	 */
	create(hooks?: WriteHooks): Driver

	/**
	 * Enables `PUT`, replacing the resource with the request body, validated against the shape.
	 *
	 * The resource keeps the identifier of the request target, so a client cannot redirect the update elsewhere: a
	 * body naming another resource is rejected with `422 Unprocessable Content`, and one naming none is completed.
	 *
	 * - `204 No Content` where the resource is replaced
	 * - `404 Not Found` where the store holds no such resource
	 *
	 * @param hooks Write hooks
	 *
	 * @returns This driver
	 */
	update(hooks?: WriteHooks): Driver

	/**
	 * Enables `DELETE`, removing the resource along with the embedded and captive data the shape ties to it.
	 *
	 * - `204 No Content` where the resource is removed
	 * - `404 Not Found` where the store holds no such resource
	 *
	 * @returns This driver
	 */
	delete(): Driver

}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Creates a resource driver.
 *
 * @param shape The shape of the resource served, possibly deferred to break definition cycles
 *
 * @returns A driver with no method enabled
 */
export function driver(shape: Lazy<ResourceShape>): Driver {

	// methods are held in a registry the dispatcher reads at request time, Express style, so that a method enabled
	// after the driver is mounted takes effect and enabling a method again replaces its handler

	const handlers = new Map<string, RequestHandler>();

	const allow = () => Methods
		.filter(method => method === HEAD ? handlers.has(GET) : method === OPTIONS || handlers.has(method))
		.join(", ");

	const dispatcher: RequestHandler = (request, response, next) => {

		const served = handlers.get(request.method === HEAD ? GET : request.method);

		// under use(), the mount path is stripped, leaving "/" for requests addressing the mount path itself

		return handlers.size === 0 || request.path !== "/" ? next()
			: served !== undefined ? served(request, response, next)
				: response.status(request.method === OPTIONS ? NoContent : MethodNotAllowed).set("Allow", allow()).end();

	};

	const self: Driver = Object.assign(dispatcher, {

		lookup: (hooks: LookupHooks = {}) => {

			handlers.set(GET, lookupHandler({ shape, ...hooks }));

			return self;

		},

		create: (hooks: WriteHooks = {}) => {

			handlers.set(POST, createHandler({ shape, ...hooks }));

			return self;

		},

		update: (hooks: WriteHooks = {}) => {

			handlers.set(PUT, updateHandler({ shape, ...hooks }));

			return self;

		},

		delete: () => {

			handlers.set(DELETE, deleetHandler({ shape }));

			return self;

		}

	});

	return self;

}
