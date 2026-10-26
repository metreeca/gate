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
 * Bounded retrieval models.
 *
 * Supplies the retrieval template a request carrying a query component is served with, so that a client may choose
 * what to retrieve without ever reaching beyond what the server template allows.
 *
 * @module
 */

import { getShapeTarget } from "@metreeca/blue/reference";
import { getShapeProperties, type Member, type ResourceShape } from "@metreeca/blue/resource";
import { error, type Lazy, type Optional } from "@metreeca/core";
import {
	isAtomic,
	isCriteria,
	isLocale,
	isSelector,
	isSlot,
	isTemplate,
	type Locale,
	type Query,
	type Slot,
	type Template
} from "@metreeca/qest/model";
import { expand } from "./expand.js";
import { narrowCriteria } from "../_qest.js";


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Populates a client template within the bounds of a server template.
 *
 * Returns the template a request carrying a query component is served with: the client chooses which members to
 * retrieve, while the server template, expanded as by {@link expand}, fixes the entries it states. An empty client
 * template returns the expanded server template, as a bare request would. No client entry is ever dropped: each is
 * either served or rejected, here or by the validation the result is meant for.
 *
 * **Members**
 *
 * - every member the shape declares may be asked for, hidden ones included, as hiding a member is presentational and
 *   only leaves it out of the view served to a request carrying no query component
 * - client members the shape doesn't declare are kept as stated, so that validation rejects them
 * - a client atomic leaf takes the server entry, so a client naming a member receives its server-side default view
 * - a nested client template on a resource-valued member is populated in turn against the resource it reaches
 * - a client locale map is kept over an atomic server entry; over a server locale map, its `*` wildcard is replaced
 *   by the language tags the server states, so a client asking for every language receives the ones served
 * - any other client entry is kept over an atomic server entry and rejected over a non-atomic one
 * - a malformed client entry is kept as stated, so that validation rejects it
 *
 * **Criteria**
 *
 * - client criteria narrow the server ones as by {@link narrowCriteria}, so that a client filters within the partial
 *   collection view the server defines, ordering and paging it as it states, but never widens that view
 *
 * @param shape The shape of the target resource, possibly deferred to break definition cycles
 * @param client The template decoded from the query component of the request
 * @param server The server template bounding the request; omitted, the request is bounded by `shape` alone
 *
 * @returns A template retrieving the members `client` asks for within the bounds of `server`
 *
 * @throws {@link @metreeca/core!TraceError | TraceError} Where a deferred definition reached from `shape` reaches
 *     itself, or where a union it reaches declares a shared member name inconsistently across its branches
 * @throws {@link !RangeError | RangeError} Where client and server criteria stated on the same key cannot be combined,
 *     as detailed by {@link narrowCriteria}, for instance where the client filter falls wholly outside the server view,
 *     or where a client entry other than an atomic leaf, a template or a locale map meets a non-atomic server entry
 */
export function populate(shape: Lazy<ResourceShape>, client: Template, server: Template = {}): Template {

	const members = getShapeProperties(shape);
	const bounds = expand(shape, server, { hidden: true });

	return isAtomic(client) ? expand(shape, server) : Object.fromEntries(Object.entries(client)
		.map(([name, query]) => [name, name in bounds ? merge(members[name], query, bounds[name]) : query])
	);

}


/**
 * Merges a client entry into the server entry bounding it.
 */
function merge(member: Optional<Member>, client: Query<Slot>, server: Query<Slot>): Query<Slot> {

	const [clientCriteria, clientFields] = split(client);
	const [serverCriteria, serverFields] = split(server);

	return !isCriteria(clientCriteria) || !isSlot(clientFields) ? client // a malformed client entry is left to validation
		: isCriteria(serverCriteria) && isSlot(serverFields)
			? { ...narrowCriteria(serverCriteria, clientCriteria), ...fields(member, clientFields, serverFields) }
			: server; // a malformed server entry is left to validation

}

/**
 * Splits an entry into its constraint and retrieval halves.
 */
function split(query: Query<Slot>): readonly [unknown, unknown] {

	return [
		Object.fromEntries(Object.entries(query).filter(([key]) => isSelector(key))),
		Object.fromEntries(Object.entries(query).filter(([key]) => !isSelector(key)))
	];

}

/**
 * Merges the retrieval halves of a client and a server entry.
 */
function fields(member: Optional<Member>, client: Slot, server: Slot): Slot {

	const target = member?.kind === "property" ? getShapeTarget(member.range.shape) : undefined;

	return isAtomic(client) ? server
		: target !== undefined && isTemplate(client) && (isAtomic(server) || isTemplate(server))
			? populate(target, client, server)
			: isLocale(client) && isLocale(server) ? locale(client, server)
				: isAtomic(server) ? client
					: error<Slot>(new RangeError(`conflicting client entry <${JSON.stringify(client)}>`));

}

/**
 * Merges a client locale map into a server one, replacing the client wildcard with the server language tags.
 */
function locale(client: Locale, server: Locale): Locale {

	return Object.fromEntries(Object.entries(client).flatMap(([range, atomic]) =>
		range === "*" ? Object.entries(server) : [[range, atomic]]
	));

}
