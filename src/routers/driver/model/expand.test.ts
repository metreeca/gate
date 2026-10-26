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

import { dictionary } from "@metreeca/blue/dictionary";
import { integer } from "@metreeca/blue/number";
import { reference } from "@metreeca/blue/reference";
import { id, multiple, optional, required, resource, type ResourceShape, type } from "@metreeca/blue/resource";
import { string } from "@metreeca/blue/string";
import { union } from "@metreeca/blue/union";
import { TraceError } from "@metreeca/core/trace";
import { describe, expect, it } from "vitest";
import { expand } from "./expand.js";


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

describe("expand()", () => {

	const Vendor = resource({
		id: id(),
		name: required(string()),
		code: optional(string())
	});


	describe("shape defaults", () => {

		it("retrieves literal members as atomic leaves", async () => {

			expect(expand(resource({
				name: required(string()),
				rank: optional(integer())
			}))).toEqual({
				name: {},
				rank: {}
			});

		});

		it("retrieves localised members as atomic leaves", async () => {

			expect(expand(resource({
				label: optional(dictionary())
			}))).toEqual({
				label: {}
			});

		});

		it("retrieves reference members as atomic leaves", async () => {

			expect(expand(resource({
				vendor: optional(reference(Vendor)),
				owner: optional(reference(Vendor), { captive: true })
			}))).toEqual({
				vendor: {},
				owner: {}
			});

		});

		it("retrieves identifier and type members", async () => {

			expect(expand(resource({
				id: id(),
				type: type(),
				name: required(string())
			}))).toEqual({
				id: {},
				type: {},
				name: {}
			});

		});

		it("leaves out hidden members", async () => {

			expect(expand(resource({
				id: id({ hidden: true }),
				name: required(string()),
				secret: optional(string(), { hidden: true })
			}))).toEqual({
				name: {}
			});

		});

		it("retrieves hidden members on request, keeping the resources they reach to their default view", async () => {

			expect(expand(resource({
				id: id({ hidden: true }),
				secret: optional(string(), { hidden: true }),
				address: optional(resource({
					street: required(string()),
					code: optional(string(), { hidden: true })
				}), { hidden: true })
			}), {}, { hidden: true })).toEqual({
				id: {},
				secret: {},
				address: { street: {} }
			});

		});

		it("retrieves multi-valued members as single-valued ones", async () => {

			expect(expand(resource({
				tags: multiple(string()),
				vendors: multiple(reference(Vendor))
			}))).toEqual({
				tags: {},
				vendors: {}
			});

		});

		it("expands embedded resources to their default view", async () => {

			expect(expand(resource({
				address: optional(resource({
					street: required(string()),
					geo: optional(resource({
						lat: required(integer()),
						hidden: optional(integer(), { hidden: true })
					}))
				}))
			}))).toEqual({
				address: {
					street: {},
					geo: { lat: {} }
				}
			});

		});

		it("retrieves unions of non-embedded branches as atomic leaves", async () => {

			expect(expand(resource({
				value: optional(union(string(), integer(), reference(Vendor)))
			}))).toEqual({
				value: {}
			});

		});

		it("retrieves unions with embedded branches branch by branch", async () => {

			expect(expand(resource({
				party: optional(union(
					resource({ name: required(string()) }),
					reference(Vendor)
				))
			}))).toEqual({
				party: {
					"0": { name: {} },
					"1": {}
				}
			});

		});

		it("resolves deferred shapes", async () => {

			const Address = () => resource({ street: required(string()) });

			expect(expand(() => resource({
				address: optional(Address)
			}))).toEqual({
				address: { street: {} }
			});

		});

		it("returns an empty template for shapes with no visible members", async () => {

			expect(expand(resource({
				secret: optional(string(), { hidden: true })
			}))).toEqual({});

		});

		it("rejects deferred definitions reaching themselves", async () => {

			const Loop = (): ResourceShape => resource({ loop: optional(Loop) });

			expect(() => expand(Loop)).toThrow(TraceError);

		});

	});

	describe("template entries", () => {

		const Product = resource({
			id: id(),
			name: required(string()),
			label: optional(dictionary()),
			price: optional(integer()),
			secret: optional(string(), { hidden: true }),
			vendor: optional(reference(Vendor)),
			vendors: multiple(reference(Vendor))
		});


		it("fills in the members the template leaves out", async () => {

			expect(expand(Product, {
				name: {}
			})).toEqual({
				id: {},
				name: {},
				label: {},
				price: {},
				vendor: {},
				vendors: {}
			});

		});

		it("keeps entries as stated", async () => {

			expect(expand(Product, {
				label: { "*": {} }
			})).toMatchObject({
				label: { "*": {} }
			});

		});

		it("keeps entries for members the shape doesn't declare", async () => {

			expect(expand(Product, {
				unknown: {}
			})).toMatchObject({
				unknown: {}
			});

		});

		it("keeps hidden members the template states", async () => {

			expect(expand(Product, {
				secret: {}
			})).toMatchObject({
				secret: {}
			});

		});

		it("expands nested templates against the resource they reach", async () => {

			expect(expand(Product, {
				vendor: { name: {} }
			})).toMatchObject({
				vendor: { id: {}, name: {}, code: {} }
			});

		});

		it("keeps collection criteria on expanded entries", async () => {

			expect(expand(Product, {
				vendors: { name: {}, "^name": 1, "#": 10 }
			})).toMatchObject({
				vendors: { id: {}, name: {}, code: {}, "^name": 1, "#": 10 }
			});

		});

		it("keeps projections unexpanded", async () => {

			expect(expand(Product, {
				vendors: { "count=count:": {} }
			})).toMatchObject({
				vendors: { "count=count:": {} }
			});

		});

		it("keeps atomic leaves on resource-valued members unexpanded", async () => {

			expect(expand(Product, {
				vendor: {}
			})).toMatchObject({
				vendor: {}
			});

		});

	});

});
