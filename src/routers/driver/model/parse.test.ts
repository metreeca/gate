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
import { id, multiple, optional, required, resource } from "@metreeca/blue/resource";
import { string } from "@metreeca/blue/string";
import { encodeTemplate } from "@metreeca/qest/model";
import { describe, expect, it } from "vitest";
import { query } from "./parse.js";


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

describe("query()", () => {

	const base = "https://example.com/products/";

	const Vendor = resource({
		id: id(),
		name: required(string())
	});

	const Product = resource({
		id: id(),
		name: required(string()),
		price: optional(integer())
	});

	const Products = resource({
		id: id(),
		label: optional(string()),
		vendor: optional(reference(Vendor)),
		members: multiple(reference(Product))
	});


	describe("templates", () => {

		const template = { members: { name: {}, "#": 10 } };

		it("decodes json templates", async () => {

			expect(query(Products, JSON.stringify(template))).toEqual(template);

		});

		it("decodes url-encoded templates", async () => {

			expect(query(Products, encodeTemplate(template, { format: "url" }))).toEqual(template);

		});

		it("decodes base64url-encoded templates", async () => {

			expect(query(Products, encodeTemplate(template, { format: "base64" }))).toEqual(template);

		});

		it("resolves relative iris against the base", async () => {

			expect(query(Products, JSON.stringify({ members: { "?id": "/products/1" } }), { base })).toEqual({
				members: { "?id": "https://example.com/products/1" }
			});

		});

		it("decodes json templates holding key/value separators", async () => {

			expect(query(Products, JSON.stringify({ members: { "~name": "a=b&c" } }))).toEqual({
				members: { "~name": "a=b&c" }
			});

		});

		it("decodes empty queries to the empty retrieval model", async () => {

			expect(query(Products, "")).toEqual({});
			expect(query(Products, "{}")).toEqual({});

		});

	});

	describe("form data", () => {

		it("applies criteria to the collection", async () => {

			expect(query(Products, "~name=axel&price>=30")).toEqual({
				members: { "~name": "axel", ">=price": 30 }
			});

		});

		it("tells form data from encoded templates sharing their leading characters", async () => {

			expect(query(Products, "eyes=blue")).toEqual({
				members: { "?eyes": "blue" }
			});

			expect(query(Products, "%3Eprice=30")).toEqual({
				members: { ">price": 30 }
			});

		});

		it("rejects form data url-encoded as a whole", async () => {

			expect(() => query(Products, encodeURIComponent("~name=axel&price>=30"))).toThrow(TypeError);

		});

		it("ignores single-valued and localised members", async () => {

			const Catalog = resource({
				label: optional(string()),
				titles: multiple(dictionary()),
				vendor: optional(reference(Vendor)),
				items: multiple(reference(Product))
			});

			expect(query(Catalog, "~name=axel")).toEqual({
				items: { "~name": "axel" }
			});

		});

		it("applies criteria to collections of scalars", async () => {

			expect(query(resource({ tags: multiple(string()) }), "~=red&#=5")).toEqual({
				tags: { "~": "red", "#": 5 }
			});

		});

		it("merges criteria into the default view of embedded items", async () => {

			const Order = resource({
				lines: multiple(resource({
					sku: required(string()),
					quantity: required(integer())
				}))
			});

			expect(query(Order, ">=quantity=2")).toEqual({
				lines: { sku: {}, quantity: {}, ">=quantity": 2 }
			});

		});

		it("resolves relative iris against the base", async () => {

			expect(query(Products, "?id=/products/1", { base })).toEqual({
				members: { "?id": "https://example.com/products/1" }
			});

		});

		it("rejects shapes holding no collection", async () => {

			expect(() => query(resource({ name: required(string()) }), "~name=axel")).toThrow(TypeError);

		});

		it("rejects shapes holding several collections", async () => {

			const Catalog = resource({
				tags: multiple(string()),
				items: multiple(reference(Product), { forward: "http://www.w3.org/2000/01/rdf-schema#member" })
			});

			expect(() => query(Catalog, "~name=axel")).toThrow(TypeError);

		});

		it("rejects malformed form data", async () => {

			expect(() => query(Products, "#=abc")).toThrow(Error);

		});

	});

	describe("failures", () => {

		it("rejects queries in no known format", async () => {

			expect(() => query(Products, "bogus")).toThrow(TypeError);

		});

		it("rejects encoded templates that are no valid JSON", async () => {

			expect(() => query(Products, "{ members")).toThrow(SyntaxError);

		});

		it("rejects malformed templates", async () => {

			expect(() => query(Products, JSON.stringify({ members: 1 }))).toThrow(TypeError);

		});

		it("rejects bases that are no hierarchical IRI", async () => {

			const template = JSON.stringify({ members: { "?id": "/products/1" } });

			expect(() => query(Products, template, { base: "urn:example:products" })).toThrow(TypeError);

		});

	});

});
