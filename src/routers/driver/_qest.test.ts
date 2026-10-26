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

import { type Criteria } from "@metreeca/qest/model";
import { describe, expect, it } from "vitest";
import { narrowCriteria } from "./_qest.js";


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

describe("narrowCriteria()", () => {

	it("keeps constraints stated on different keys", async () => {
		expect(narrowCriteria({ ">=price": 10 }, { "~name": "acme" })).toEqual({ ">=price": 10, "~name": "acme" });
	});


	describe("bounds", () => {

		it.each<[string, Criteria, Criteria, Criteria]>([
			["the lower of < bounds", { "<price": 50 }, { "<price": 20 }, { "<price": 20 }],
			["the lower of <= bounds", { "<=price": 20 }, { "<=price": 50 }, { "<=price": 20 }],
			["the higher of > bounds", { ">price": 10 }, { ">price": 50 }, { ">price": 50 }],
			["the higher of >= bounds", { ">=price": 50 }, { ">=price": 10 }, { ">=price": 50 }],
			["string bounds in lexical order", { ">=name": "b" }, { ">=name": "a" }, { ">=name": "b" }]
		])("takes %s", async (_, base, criteria, expected) => {
			expect(narrowCriteria(base, criteria)).toEqual(expected);
		});

		it("rejects bounds of different types", async () => {
			expect(() => narrowCriteria({ ">=price": 10 }, { ">=price": "10" })).toThrow(RangeError);
		});

	});

	describe("text search", () => {

		it("requires every token of both searches, each once", async () => {
			expect(narrowCriteria({ "~name": "red widget" }, { "~name": "widget large" }))
				.toEqual({ "~name": "red widget large" });
		});

	});

	describe("options", () => {

		it("admits the options both any-of sets admit", async () => {
			expect(narrowCriteria({ "?code": ["a", "b", "c"] }, { "?code": ["b", "c", "d"] }))
				.toEqual({ "?code": ["b", "c"] });
		});

		it("admits single options as one-option sets", async () => {
			expect(narrowCriteria({ "?code": ["a", "b"] }, { "?code": "b" })).toEqual({ "?code": ["b"] });
		});

		it("rejects any-of sets sharing no option", async () => {
			expect(() => narrowCriteria({ "?code": ["a", "b"] }, { "?code": ["c"] })).toThrow(RangeError);
		});

		it("requires every option of both all-of sets, each once", async () => {
			expect(narrowCriteria({ "!tags": ["a", "b"] }, { "!tags": ["b", "c"] }))
				.toEqual({ "!tags": ["a", "b", "c"] });
		});

		it("combines localised options tag by tag", async () => {
			expect(narrowCriteria({ "?label": { en: ["red", "blue"] } }, { "?label": { en: "red" } }))
				.toEqual({ "?label": { en: ["red"] } });
		});

		it("rejects localised options combined with plain ones", async () => {
			expect(() => narrowCriteria({ "!label": { en: "red" } }, { "!label": ["red"] })).toThrow(RangeError);
		});

	});

	describe("presentation", () => {

		it("orders and focuses as the narrowing criteria state", async () => {
			expect(narrowCriteria({ "^name": 1, "+code": "a" }, { "^name": -1, "+code": "b" }))
				.toEqual({ "^name": -1, "+code": "b" });
		});

		it.each<[string, Criteria, Criteria, Criteria]>([
			["the narrowing offset", { "@": 20 }, { "@": 10 }, { "@": 10 }],
			["the base offset where the narrowing criteria state none", { "@": 20 }, {}, { "@": 20 }]
		])("takes %s", async (_, base, criteria, expected) => {
			expect(narrowCriteria(base, criteria)).toEqual(expected);
		});

		it.each<[string, Criteria, Criteria, Criteria]>([
			["the narrowing limit where larger", { "#": 20 }, { "#": 50 }, { "#": 50 }],
			["the narrowing limit where smaller", { "#": 20 }, { "#": 10 }, { "#": 10 }],
			["a zero narrowing limit", { "#": 20 }, { "#": 0 }, { "#": 0 }],
			["the base limit where the narrowing criteria state none", { "#": 20 }, {}, { "#": 20 }]
		])("takes %s", async (_, base, criteria, expected) => {
			expect(narrowCriteria(base, criteria)).toEqual(expected);
		});

	});

});
