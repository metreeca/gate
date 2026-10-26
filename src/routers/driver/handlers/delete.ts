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
 * Removal handler.
 *
 * @module
 */

import { NoContent, NotFound } from "@metreeca/http";
import type { RequestHandler } from "express";
import { handler, type HandlerOpts, storage, target } from "./index.js";


/**
 * Serves `DELETE` requests on a resource.
 *
 * Removes the resource the request addresses, along with the embedded and captive data the shape ties to it.
 *
 * - `204 No Content` where the resource is removed
 * - `404 Not Found` where the store holds no such resource
 *
 * @param opts Handler options
 *
 * @returns A handler removing the resource each request addresses
 */
export function deleet({ shape }: HandlerOpts): RequestHandler {

	return handler(async (request, response) => {

		const deleted = await storage(request).delete({ entry: target(request), shape });

		response.status(deleted === undefined ? NotFound : NoContent).end();

	});

}
