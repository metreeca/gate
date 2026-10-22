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
 * Client retrieval queries.
 *
 * Turns the query component of a `GET` request into the retrieval template it stands for, so that a client may state
 * a template in any of the encodings Qest produces, or filter a container with plain form-encoded criteria.
 *
 * @module
 */

import { getShapeProperties, type ResourceShape } from "@metreeca/blue/resource";
import { eager } from "@metreeca/blue/value";
import { error, type Lazy } from "@metreeca/core";
import { type Criteria, decodeCriteria, decodeTemplate, type Template } from "@metreeca/qest/model";
import { expand } from "./expand.js";


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Decodes the query component of a request into a retrieval template.
 *
 * Accepts the query in either of the forms below:
 *
 * - a template as plain, URL-encoded or base64url-encoded JSON, in any of the formats produced by
 *   {@link @metreeca/qest/model!encodeTemplate | encodeTemplate}, its internal IRIs resolved against the base
 * - {@link @metreeca/qest/model!Criteria | criteria} as `application/x-www-form-urlencoded` form data, constraining
 *   the items of the collection the target resource holds, keys and values encoded one by one as form data requires
 *
 * Form data is told apart by the `=` separating each key from its value, which no template encoding carries outside
 * plain JSON; form data URL-encoded as a whole is therefore read as an encoded template and rejected.
 *
 * Form data applies only where `shape` holds a single collection, that is a single multi-valued member other than a
 * language map, as a container does. The criteria are merged into the default view of the collection items, so that
 * a client filtering a container receives the same item fields an unfiltered request returns.
 *
 * An empty query returns the empty retrieval model `{}`, which requests nothing beyond the server defaults.
 *
 * @param shape The shape of the target resource, possibly deferred to break definition cycles
 * @param encoded The query component of the request, without the leading `?`
 * @param opts Decoding options
 * @param opts.base The base IRI relative IRIs in the query resolve against, usually the target resource IRI
 *
 * @returns The template `encoded` states, or one applying the criteria it states to the target resource collection
 *
 * @throws {@link !TypeError | TypeError} Where `base` is not a hierarchical IRI, `encoded` is in no known format or
 *     decodes to a malformed template, or form data reaches a shape holding no collection or several collections
 * @throws {@link !SyntaxError | SyntaxError} Where an encoded template is no valid JSON
 * @throws {@link !Error | Error} Where form data is malformed
 */
export function query(shape: Lazy<ResourceShape>, encoded: string, { base }: {

	readonly base?: string

} = {}): Template {

	// plain JSON may hold any character, but the transport encodings of a template never hold a raw `=`, which every
	// form data pair carries: the separator alone tells the two apart, leaving template decoding wholly to Qest

	return encoded === "" ? {}
		: !encoded.startsWith("{") && encoded.includes("=") ? collection(shape, decodeCriteria(encoded, { base }))
			: decodeTemplate(encoded, { base });

}


/**
 * Applies form-encoded criteria to the collection held by a resource.
 */
function collection(shape: Lazy<ResourceShape>, criteria: Criteria): Template {

	const collections = Object.entries(getShapeProperties(shape))
		.filter(([, member]) => member.kind === "property"
			&& member.range.maxCount !== 1
			&& eager(member.range.shape).kind !== "dictionary" // a language map is stated whole and takes no criteria
		)
		.map(([name]) => name);

	const name = collections.length === 1 ? collections[0]
		: collections.length === 0 ? error<string>(new TypeError("missing collection property"))
			: error<string>(new TypeError(`conflicting collection properties [${collections.join(", ")}]`));

	return { [name]: { ...expand(shape)[name], ...criteria } };

}
