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
 * Qest model extensions.
 *
 * Collects the operations on Qest retrieval models that belong with `@metreeca/qest` rather than with the gateway,
 * staged here until they move upstream, at which point the gateway imports them from Qest instead.
 *
 * @module
 */

import { assert, error, isArray, isNumber } from "@metreeca/core";
import { type Criteria, decodeProbe, isCriteria, isOptions, type Options } from "@metreeca/qest/model";
import { isDictionary, isLiteral } from "@metreeca/qest/state";


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Narrows a collection view with further criteria.
 *
 * Returns the criteria selecting the items both `base` and `criteria` select, so that a client filtering a partial
 * collection view defined by the server stays within that view. Constraints stated on the same key are combined so
 * that both hold, while ordering, focus and paging follow the ones `criteria` states, falling back to `base`:
 *
 * | Operator         | Combination                                              |
 * |------------------|----------------------------------------------------------|
 * | `<`, `<=`        | the lower bound                                          |
 * | `>`, `>=`        | the higher bound                                         |
 * | `~`              | every token of both searches                             |
 * | `?`              | the options both sets admit                              |
 * | `!`              | every option of both sets                                |
 * | `^`, `+`, `@`    | the value `criteria` states, `base` applying otherwise   |
 * | `#`              | the smaller limit, a zero or missing limit counting as no limit |
 *
 * > [!NOTE]
 * > On a multi-valued expression, combined `~` and `?` constraints are stricter than both constraints taken apart: a
 * > single value must satisfy the combination, where each constraint alone may be satisfied by a different value.
 *
 * @param base The criteria defining the view, such as the ones a server fixes on a collection
 * @param criteria The criteria narrowing the view, such as the ones a client states
 *
 * @returns The criteria selecting the items both `base` and `criteria` select, ordered and paged as `criteria` states
 *
 * @throws {@link !RangeError | RangeError} Where values stated on the same key cannot be combined: `?` option sets
 *     with no shared option, bounds of different types, or option sets mixing plain and language-tagged options
 */
export function narrowCriteria(base: Criteria, criteria: Criteria): Criteria {

	const x: Readonly<Record<string, unknown>> = base;
	const y: Readonly<Record<string, unknown>> = criteria;

	const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])];

	return assert(Object.fromEntries(keys.map(key => [key,
		!(key in x) ? y[key]
			: !(key in y) ? x[key]
				: Combiners[operator(key)](key, x[key], y[key])
	])), isCriteria);

}


/**
 * A function combining two values stated for the same criteria key so that both constraints hold.
 */
type Combiner = (key: string, base: unknown, criteria: unknown) => unknown;

/**
 * The combiners for each criteria operator.
 */
const Combiners: Readonly<Record<string, Combiner>> = {

	"<": (key, x, y) => compare(key, x, y) <= 0 ? x : y,
	"<=": (key, x, y) => compare(key, x, y) <= 0 ? x : y,
	">": (key, x, y) => compare(key, x, y) >= 0 ? x : y,
	">=": (key, x, y) => compare(key, x, y) >= 0 ? x : y,

	"~": (_, x, y) => unique([...tokens(x), ...tokens(y)]).join(" "),

	"?": (key, x, y) => any(key, x, y),
	"!": (key, x, y) => all(key, x, y),

	"^": (_, _x, y) => y,
	"+": (_, _x, y) => y,
	"@": (_, _x, y) => y,

	"#": (_, x, y) => {

		const limits = [x, y].flatMap(limit => isNumber(limit) && limit > 0 ? [limit] : []);

		return limits.length > 0 ? Math.min(...limits) : 0;

	}

};


/**
 * Identifies the operator of a criteria key.
 */
function operator(key: string): string {

	return key === "@" || key === "#" ? key : decodeProbe(key).target;

}

/**
 * Compares two bounds of the same type.
 */
function compare(key: string, x: unknown, y: unknown): number {

	return typeof x !== typeof y || !isLiteral(x) || !isLiteral(y)
		? error(new RangeError(`mismatched <${key}> bounds`))
		: x < y ? -1 : x > y ? 1 : 0;

}

/**
 * Splits a text search into its tokens.
 */
function tokens(search: unknown): readonly string[] {

	return String(search).split(/\s+/).filter(token => token !== "");

}

/**
 * Removes duplicate values, keeping the first occurrence of each.
 */
function unique<T>(values: readonly T[]): readonly T[] {

	return [...new Set(values)];

}


/**
 * Admits the options both any-of sets admit.
 */
function any(key: string, x: unknown, y: unknown): Options {

	const admitted = new Set(entries(y).map(identify));
	const shared = entries(x).filter(entry => admitted.has(identify(entry)));

	return shared.length > 0 ? options(key, shared) : error(new RangeError(`disjoint <${key}> options`));

}

/**
 * Requires every option of both all-of sets.
 */
function all(key: string, x: unknown, y: unknown): Options {

	const required = [...entries(x), ...entries(y)];
	const identifiers = required.map(identify);

	return options(key, required.filter((entry, index) => identifiers.indexOf(identify(entry)) === index));

}


/**
 * Flattens an option set into language-tagged values, plain options carrying an empty tag.
 */
function entries(options: unknown): readonly (readonly [string, unknown])[] {

	return isDictionary(options)
		? Object.entries(options).flatMap(([tag, values]) =>
			(isArray(values) ? values : [values]).map((value): readonly [string, unknown] => [tag, value])
		)
		: (isArray(options) ? options : [options]).map((value): readonly [string, unknown] => ["", value]);

}

/**
 * Identifies a language-tagged value for equality comparisons.
 */
function identify(entry: readonly [string, unknown]): string {

	return JSON.stringify(entry);

}

/**
 * Rebuilds an option set from language-tagged values.
 */
function options(key: string, entries: readonly (readonly [string, unknown])[]): Options {

	const tagged = entries.filter(([tag]) => tag !== "");

	return tagged.length === 0 ? assert(entries.map(([, value]) => value), isOptions)
		: tagged.length === entries.length ? assert(entries.reduce<Readonly<Record<string, readonly unknown[]>>>(
			(dictionary, [tag, value]) => ({ ...dictionary, [tag]: [...dictionary[tag] ?? [], value] }), {}
		), isOptions)
			: error(new RangeError(`mismatched <${key}> options`));

}
