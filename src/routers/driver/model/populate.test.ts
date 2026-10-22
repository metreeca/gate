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
import { reference } from "@metreeca/blue/reference";
import { id, multiple, optional, required, resource } from "@metreeca/blue/resource";
import { string } from "@metreeca/blue/string";
import { describe, expect, it } from "vitest";
import { expand } from "./expand.js";
import { populate } from "./populate.js";


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

describe("populate()", () => {

	const Vendor = resource({
		id: id(),
		name: required(string()),
		code: optional(string())
	});

	const Product = resource({
		id: id(),
		name: required(string()),
		label: optional(dictionary()),
		secret: optional(string(), { hidden: true }),
		vendor: optional(reference(Vendor)),
		vendors: multiple(reference(Vendor))
	});


	describe("members", () => {

		it("serves the expanded server template to empty client templates", async () => {

			expect(populate(Product, {}, { vendor: { name: {} } })).toEqual(
				expand(Product, { vendor: { name: {} } })
			);

		});

		it("retrieves only the members the client asks for", async () => {

			expect(populate(Product, { name: {}, label: {} })).toEqual({
				name: {},
				label: {}
			});

		});

		it("drops members the expanded server template leaves out", async () => {

			expect(populate(Product, { name: {}, secret: {}, unknown: {} })).toEqual({
				name: {}
			});

		});

		it("admits hidden members the server template states", async () => {

			expect(populate(Product, { secret: {} }, { secret: {} })).toEqual({
				secret: {}
			});

		});

		it("serves the server entry to atomic client entries", async () => {

			expect(populate(Product, { vendor: {} }, { vendor: { name: {} } })).toEqual({
				vendor: { id: {}, name: {}, code: {} }
			});

		});

		it("populates nested client templates against the resource they reach", async () => {

			expect(populate(Product, { vendor: { name: {}, unknown: {} } })).toEqual({
				vendor: { name: {} }
			});

		});

		it("keeps client locale maps over atomic server entries", async () => {

			expect(populate(Product, { label: { en: {}, fr: {} } })).toEqual({
				label: { en: {}, fr: {} }
			});

		});

		it("replaces client locale wildcards with the server language tags", async () => {

			expect(populate(Product, { label: { "*": {}, de: {} } }, { label: { en: {}, fr: {} } })).toEqual({
				label: { en: {}, fr: {}, de: {} }
			});

		});

		it("keeps other client entries over atomic server entries", async () => {

			expect(populate(Product, { vendors: { "count=count:": {} } })).toEqual({
				vendors: { "count=count:": {} }
			});

		});

		it("gives way to non-atomic server entries", async () => {

			expect(populate(Product, { vendors: { "count=count:": {} } }, { vendors: { name: {} } })).toMatchObject({
				vendors: { id: {}, name: {}, code: {} }
			});

		});

	});

	describe("criteria", () => {

		it("combines client and server criteria", async () => {

			expect(populate(Product,
				{ vendors: { name: {}, "~name": "acme" } },
				{ vendors: { "?code": "x" } }
			)).toEqual({
				vendors: { name: {}, "~name": "acme", "?code": "x" }
			});

		});

		it("narrows server criteria with client ones on shared keys", async () => {

			expect(populate(Product,
				{ vendors: { name: {}, "?code": ["x", "y"] } },
				{ vendors: { "?code": ["x", "z"] } }
			)).toEqual({
				vendors: { name: {}, "?code": ["x"] }
			});

		});

		it("rejects client criteria falling wholly outside the server view", async () => {

			expect(() => populate(Product,
				{ vendors: { name: {}, "?code": "y" } },
				{ vendors: { "?code": "x" } }
			)).toThrow(RangeError);

		});

	});

});
