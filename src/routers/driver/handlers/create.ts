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
 * Creation handler.
 *
 * @module
 */

import { validate } from "@metreeca/blue";
import { getShapeTarget } from "@metreeca/blue/reference";
import { getShapeId, getShapeProperties, type ResourceShape } from "@metreeca/blue/resource";
import { blueprint } from "@metreeca/blue/value";
import { error, isObject, isString, type Lazy, type Optional } from "@metreeca/core";
import { internalize } from "@metreeca/core/resource";
import { Conflict, Created } from "@metreeca/http";
import type { RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { base, body, checked, handler, storage, target, type WriteOpts } from "./index.js";


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Serves `POST` requests on a container.
 *
 * Creates a resource from the JSON body of the request in the collection the addressed resource holds, the only
 * multi-valued member of the shape ranging over resources. The body is validated against the shape of the collected
 * resources. Where that shape names its resources, an identifier stated by the body is kept. An identifier the body
 * leaves out is derived from the `Slug` header, or generated where the header is missing or holds no letter or digit.
 * Either way, the identifier is resolved against the container, so the new resource is always placed inside it.
 *
 * - `201 Created` with a `Location` header pointing to the new resource, root-relative where it shares the base
 * - `409 Conflict` where the store refuses to create the resource, as when its identifier is taken
 *
 * @param opts Handler options; `shape` describes the container
 *
 * @returns A handler creating a resource in the container each request addresses
 *
 * @throws {@link !TypeError | TypeError} Where `shape` holds no collection ranging over resources, or several
 */
export function create({ shape, decode }: WriteOpts): RequestHandler {

	const model = { [container(shape)]: {} };
	const items = blueprint(shape, model);
	const name = getShapeId(items);

	return handler(async (request, response) => {

		const entry = target(request);
		const state = await body(request).then(state => decode === undefined ? state : decode(state, request));

		const draft = isObject(state) && name !== undefined ? {
			...state,
			[name]: new URL(isString(state[name]) ? state[name] : slug(request.get("Slug") ?? "") ?? randomUUID(), entry).href
		} : state;

		const created = await storage(request).create({ entry, shape, model, state: checked(validate(draft, { shape: items })) });

		created === undefined
			? response.status(Conflict).end()
			: response.status(Created).location(internalize(base(request), created)).end();

	});

}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Converts client-suggested text into a URL-friendly slug.
 *
 * Supports the `Slug` header of a creation request, so that a client may suggest a readable name for the resource it
 * creates: the text is URL-decoded, stripped of diacritical marks, its runs of characters other than letters and
 * digits turned into single hyphens, and lowercased, so that the slug is safe to use as an IRI path segment.
 *
 * @param text The text to convert, possibly URL-encoded
 *
 * @returns The slug `text` converts to, or `undefined` where no letter or digit is left
 *
 * @see {@link https://datatracker.ietf.org/doc/html/rfc5023#section-9.7 RFC 5023 § 9.7 - The Slug Header}
 */
export function slug(text: string): Optional<string> {

	const words = decodeURIComponent(text)
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();

	return words === "" ? undefined : words.replace(/\s+/g, "-").toLowerCase();

}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Identifies the collection a container creates its resources in: its only multi-valued member ranging over resources.
 */
function container(shape: Lazy<ResourceShape>): string {

	const collections = Object.entries(getShapeProperties(shape))
		.filter(([, member]) => member.kind === "property"
			&& member.range.maxCount !== 1
			&& getShapeTarget(member.range.shape) !== undefined
		)
		.map(([name]) => name);

	return collections.length === 1 ? collections[0]
		: collections.length === 0 ? error<string>(new TypeError("missing collection property"))
			: error<string>(new TypeError(`conflicting collection properties [${collections.join(", ")}]`));

}
