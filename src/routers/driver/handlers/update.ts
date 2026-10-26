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
 * Replacement handler.
 *
 * @module
 */

import { validate } from "@metreeca/blue";
import { getShapeId } from "@metreeca/blue/resource";
import { error, isObject } from "@metreeca/core";
import { NoContent, NotFound } from "@metreeca/http";
import type { RequestHandler } from "express";
import { body, checked, handler, storage, target, type WriteOpts } from "./index.js";


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Serves `PUT` requests on a resource.
 *
 * Replaces the resource the request addresses with the JSON body of the request, validated against the shape and
 * named by the request target, so a client cannot redirect the update elsewhere. A body stating no identifier is
 * completed with the request target, and one naming another resource is rejected.
 *
 * - `204 No Content` where the resource is replaced
 * - `404 Not Found` where the store holds no such resource
 *
 * @param opts Handler options
 *
 * @returns A handler replacing the resource each request addresses
 */
export function update({ shape, decode }: WriteOpts): RequestHandler {

	const name = getShapeId(shape);

	return handler(async (request, response) => {

		const entry = target(request);
		const state = await body(request).then(state => decode === undefined ? state : decode(state, request));

		const draft = !isObject(state) || name === undefined || state[name] === entry ? state
			: !(name in state) ? { ...state, [name]: entry }
				: error(new RangeError(`mismatched resource identifier <${String(state[name])}>`));

		const updated = await storage(request).update({ entry, shape, state: checked(validate(draft, { shape, entry })) });

		response.status(updated === undefined ? NotFound : NoContent).end();

	});

}
