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
 * Browser client hosting for Express applications.
 *
 * Lets a server deliver a browser client from the same origin as its API. Client-side addresses stay valid across
 * reloads, and HTTP caches keep the pages of the client apart from API responses for the same address.
 *
 * @module client
 */

import { GET, HEAD } from "@metreeca/http";
import express, { type RequestHandler } from "express";
import { dirname, resolve } from "node:path";


/**
 * HTTP methods a browser may issue a navigation request with.
 */
const Navigation: ReadonlySet<string> = new Set([GET, HEAD]);


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Serves a browser client.
 *
 * Navigation requests receive the client's entry page whatever their path, so that client-side addresses survive a
 * reload. Other requests receive the client's static assets, or fall through to the next handler if no asset matches.
 *
 * A navigation request is a `GET` or `HEAD` request that ranks `text/html` first among its accepted media types.
 * Wildcards do not count: a request that ranks a wildcard or any other media type first always reaches the resource it
 * names, and never receives the entry page in its place, even if it targets a client-side address.
 *
 * Every response is marked as varying by `Accept`, including the responses of handlers a request falls through to.
 * HTTP caches then keep the entry page apart from the other representations of the same address.
 *
 * @param path The path of the client's entry page if it ends in `.html`, or else of a folder holding the entry page
 *     as `index.html`; relative paths are resolved against the working directory, and static assets are served from
 *     the folder holding the entry page, under their relative paths within that folder
 *
 * @returns A handler serving the client, to be mounted ahead of other routes so that navigation requests reach it first
 */
export function client(path: string): RequestHandler {

	const index = path.endsWith(".html") ? resolve(path) : resolve(path, "index.html");
	const assets = express.static(dirname(index), { index: false });

	return (request, response, next) => {

		response.vary("Accept");

		return Navigation.has(request.method) && request.accepts()[0] === "text/html"
			? response.sendFile(index)
			: assets(request, response, next);

	};

}
