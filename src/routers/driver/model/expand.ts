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
 * Default retrieval models.
 *
 * Supplies the retrieval template a request is served with when the client states none, so that a bare `GET` returns
 * every visible member of the target resource, nested embedded resources included, rather than an empty view.
 *
 * @module
 */

import { getShapeTarget } from "@metreeca/blue/reference";
import { getShapeProperties, type Member, type ResourceShape } from "@metreeca/blue/resource";
import { getShapeBranches } from "@metreeca/blue/union";
import type { Shape } from "@metreeca/blue/value";
import type { Lazy } from "@metreeca/core";
import {
	type Cell,
	isCriteria,
	isSelector,
	isTemplate,
	type Placeholder,
	type Query,
	type Slot,
	type Template
} from "@metreeca/qest/model";


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Expands a retrieval template to the default view of a resource shape.
 *
 * Returns the template a request without a query component is served with: every member of the shape not marked
 * as hidden is retrieved, so the client receives the full default view of the resource without stating it. Server
 * template entries take precedence over the shape defaults, which fill in only the members the template leaves out.
 *
 * **Shape defaults**
 *
 * - literal, localised and reference members, identifier and type included, are retrieved as they stand, as an
 *   {@link @metreeca/qest/model!Atomic | Atomic} leaf: a linked resource is returned as its reference and never
 *   expanded, and a localised member is returned as the label coalesced under the negotiated language priority
 * - embedded resources, which have no identity of their own, are expanded to their own default view
 * - unions are retrieved as an `Atomic` leaf unless a branch is an embedded resource, in which case each branch is
 *   retrieved under its own {@link @metreeca/qest/model!Union | Union} key, embedded branches expanded
 * - multi-valued members take the same entry as single-valued ones, with no paging of their own
 *
 * **Template entries**
 *
 * - entries are kept as stated, hidden members and collection criteria included
 * - a nested template on a resource-valued member is expanded in turn against the shape of the resource it reaches,
 *   so a server template naming a linked resource retrieves its default view along with the members it names
 * - atomic leaves, locale maps, unions and projections are kept unexpanded
 *
 * @param shape The shape of the target resource, possibly deferred to break definition cycles
 * @param template The server template to expand; omitted, the template is built from `shape` alone
 * @param opts Expansion options
 * @param opts.hidden Whether the hidden members of `shape` are retrieved too, as the full set of members a client may
 *     ask for; the resources they reach still expand to their own default view, hidden members left out
 *
 * @returns A template retrieving the members `template` states and the visible members of `shape` it leaves out,
 *     hidden ones included where `opts.hidden` is set; empty where no member is retrieved
 *
 * @throws {@link @metreeca/core!TraceError | TraceError} Where a deferred definition reached from `shape` reaches
 *     itself, or where a union it reaches declares a shared member name inconsistently across its branches
 */
export function expand(shape: Lazy<ResourceShape>, template: Template = {}, { hidden = false }: {

	readonly hidden?: boolean

} = {}): Template {

	const members = getShapeProperties(shape);

	const declared = Object.entries(members)
		.filter(([name, member]) => name in template || hidden || !member.hidden)
		.map(([name, member]) => [name, name in template ? entry(member, template[name]) : defaults(member)]);

	const undeclared = Object.entries(template)
		.filter(([name]) => !(name in members));

	return Object.fromEntries([...declared, ...undeclared]);

}

/**
 * Expands a template entry stated for a member, descending into the resource it reaches.
 */
function entry(member: Member, query: Query<Slot>): Query<Slot> {

	const target = member.kind === "property" ? getShapeTarget(member.range.shape) : undefined;

	// projections, unions and atomic leaves leave a retrieval half that is no template, and are kept as stated

	const criteria = Object.fromEntries(Object.entries(query).filter(([key]) => isSelector(key)));
	const fields = Object.fromEntries(Object.entries(query).filter(([key]) => !isSelector(key)));

	return target !== undefined && isTemplate(fields) && isCriteria(criteria)
		? { ...criteria, ...expand(target, fields) }
		: query;

}

/**
 * Builds the default entry for a member left out of the template.
 */
function defaults(member: Member): Cell {

	return member.kind === "property" ? cell(member.range.shape) : {};

}

/**
 * Builds the default entry for the values of a shape, retrieving embedded branches on their own.
 */
function cell(shape: Lazy<Shape>): Cell {

	const branches = getShapeBranches(shape);
	const [branch] = branches;

	return branches.length === 1 ? placeholder(branch)
		: branches.some(branch => branch.kind === "resource")
			? Object.fromEntries(branches.map((branch, index) => [`${index}`, placeholder(branch)]))
			: {};

}

/**
 * Builds the default entry for a single value, expanding an embedded resource to its default view.
 */
function placeholder(shape: Shape): Placeholder {

	return shape.kind === "resource" ? expand(shape) : {};

}
