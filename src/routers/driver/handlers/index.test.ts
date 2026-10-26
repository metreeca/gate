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

import { integer } from "@metreeca/blue/number";
import { reference } from "@metreeca/blue/reference";
import { id, multiple, optional, required, resource } from "@metreeca/blue/resource";
import { string } from "@metreeca/blue/string";
import { isObject } from "@metreeca/core";
import { TraceError } from "@metreeca/core/trace";
import type { Store } from "@metreeca/keep";
import { encodeTemplate, type Template } from "@metreeca/qest/model";
import express, { type RequestHandler } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, type Mock, vi } from "vitest";
import { BaseSetting, StoreSetting } from "../../../index.core.js";
import { populate } from "../model/populate.js";
import { create, slug } from "./create.js";
import { deleet } from "./delete.js";
import { lookup } from "./lookup.js";
import { update } from "./update.js";


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const base = "https://data.example.com/v1/";

const Product = resource({
	id: id(),
	name: required(string()),
	price: optional(integer())
});

const Products = resource({
	id: id(),
	label: optional(string()),
	tags: multiple(string()),
	members: multiple(reference(Product))
});


/**
 * Creates a store stub, every method resolving to nothing unless overridden.
 */
function stub(overrides: Partial<Record<keyof Store, Mock>> = {}): Store {

	const store: Readonly<Record<string, unknown>> = {
		lookup: resolving(undefined),
		create: resolving(undefined),
		update: resolving(undefined),
		delete: resolving(undefined),
		insert: vi.fn(async () => { throw new Error("unexpected insert"); }),
		remove: vi.fn(async () => { throw new Error("unexpected remove"); }),
		observe: vi.fn(() => () => {}),
		execute: vi.fn(async (task: (client: unknown) => unknown) => task(store)),
		close: vi.fn(async () => {}),
		...overrides
	};

	return store as unknown as Store; // ;(cast) test mock: a Vitest mock cannot implement the generic store methods

}

/**
 * Creates a store method stub resolving to a fixed value, recording the requests it receives.
 */
function resolving(value: unknown) {
	return vi.fn(async (_request: Record<string, unknown>, _scope?: Record<string, unknown>) => value);
}

/**
 * Creates a store method stub rejecting with a fixed error.
 */
function rejecting(error: Error) {
	return vi.fn(async (_request: Record<string, unknown>) => { throw error; });
}

/**
 * Creates a store method stub resolving to the entry of the request it receives, as a successful write does.
 */
function acknowledging() {
	return vi.fn(async ({ entry }: Record<string, unknown>) => entry);
}

/**
 * Mounts a handler on an application created with a store and started with an optional base.
 */
function mounted(handler: RequestHandler, store: Store, base?: string): RequestHandler {

	return express().set(StoreSetting, store).set(BaseSetting, base).use(handler);

}

/**
 * Serves a single request through a handler, returning the response and the origin the request was addressed to;
 * handlers not {@link mounted} on an application of their own are served over a stub store.
 */
async function serve(handler: RequestHandler, path: string, request: RequestInit = {}) {

	const server: Server = express().set(StoreSetting, stub()).use(handler).listen(0);

	await new Promise(resolve => server.once("listening", resolve));

	const origin = `http://localhost:${(server.address() as AddressInfo).port}`; // ;(cast) bound to a TCP port

	try {

		return { origin, response: await fetch(`${origin}${path}`, request) };

	} finally {

		await new Promise(resolve => server.close(resolve));

	}

}

/**
 * Builds a JSON request with the given method and body, stated verbatim where it is a string.
 */
function json(method: string, body: unknown, headers: Record<string, string> = {}): RequestInit {
	return {
		method,
		headers: { "Content-Type": "application/json", ...headers },
		body: typeof body === "string" ? body : JSON.stringify(body)
	};
}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

describe("lookup()", () => {

	const model = { label: {}, members: { name: {} } };


	describe("templates", () => {

		it("retrieves the expanded server template where the query is empty", async () => {

			const mock = resolving({ id: "x", label: "products" });

			const { origin, response } = await serve(
				mounted(lookup({ shape: Products, model }), stub({ lookup: mock })),
				"/products/"
			);

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ id: "x", label: "products" });

			expect(mock.mock.calls[0]?.[0]).toEqual({
				entry: `${origin}/products/`,
				shape: Products,
				model: populate(Products, {}, model)
			});

		});

		it("populates client templates within the server template, addressing the target with no query", async () => {

			const mock = resolving({ id: "x" });

			const template = encodeTemplate({ members: { name: {}, "#": 5 } }, { format: "url" });

			const { origin } = await serve(
				mounted(lookup({ shape: Products, model }), stub({ lookup: mock })),
				`/products/?${template}`
			);

			expect(mock.mock.calls[0]?.[0]).toMatchObject({
				entry: `${origin}/products/`,
				model: populate(Products, { members: { name: {}, "#": 5 } }, model)
			});

		});

		it("applies form data to the collection within the server template", async () => {

			const Catalog = resource({ id: id(), label: optional(string()), members: multiple(reference(Product)) });
			const bounds = { members: { ">=price": 10 } };

			const mock = resolving({ id: "x" });

			await serve(
				mounted(lookup({ shape: Catalog, model: bounds }), stub({ lookup: mock })),
				"/products/?~name=axel"
			);

			expect(mock.mock.calls[0]?.[0]).toMatchObject({
				model: { members: { "~name": "axel", ">=price": 10 } }
			});

		});

		it("computes the server template for each request", async () => {

			const mock = resolving({ id: "x" });

			await serve(
				mounted(lookup({
					shape: Products,
					model: (request): Template => ({ members: { "#": request.get("X-View") === "short" ? 5 : 50 } })
				}), stub({ lookup: mock })),
				"/products/",
				{ headers: { "X-View": "short" } }
			);

			expect(mock.mock.calls[0]?.[0]).toMatchObject({ model: { members: { "#": 5 } } });

		});

		it("reports form data on shapes holding several collections", async () => {

			const { response } = await serve(lookup({ shape: Products }), "/products/?~name=axel");

			expect(response.status).toBe(400);

		});

		it("reports malformed queries", async () => {

			const { response } = await serve(lookup({ shape: Products }), "/products/?bogus");

			expect(response.status).toBe(400);

		});

		it("retrieves hidden members the client template names", async () => {

			const Catalog = resource({ id: id(), secret: optional(string(), { hidden: true }) });

			const mock = resolving({ id: "x" });

			await serve(
				mounted(lookup({ shape: Catalog }), stub({ lookup: mock })),
				`/products/?${encodeTemplate({ secret: {} }, { format: "url" })}`
			);

			expect(mock.mock.calls[0]?.[0]).toMatchObject({ model: { secret: {} } });

		});

		it("reports client templates naming undeclared members with the violation trace", async () => {

			const template = encodeTemplate({ label: {}, unknown: {} }, { format: "url" });

			const { response } = await serve(lookup({ shape: Products }), `/products/?${template}`);

			expect(response.status).toBe(422);
			expect(await response.json()).toBeDefined();

		});

		it("reports client entries conflicting with the server template", async () => {

			const template = encodeTemplate({ members: { "count=count:": {} } }, { format: "url" });

			const { response } = await serve(lookup({ shape: Products, model }), `/products/?${template}`);

			expect(response.status).toBe(422);

		});

		it("reports templates exceeding the scope with the violation trace", async () => {

			const template = encodeTemplate({ members: { name: {}, "#": 100 } }, { format: "url" });

			const { response } = await serve(
				lookup({ shape: Products, scope: { limit: 10 } }),
				`/products/?${template}`
			);

			expect(response.status).toBe(422);
			expect(await response.json()).toBeDefined();

		});

	});

	describe("locales", () => {

		it("negotiates locales through the Accept-Language header", async () => {

			const mock = resolving({ id: "x" });

			await serve(mounted(lookup({ shape: Products }), stub({ lookup: mock })), "/products/", {
				headers: { "Accept-Language": "fr;q=0.5, en" }
			});

			expect(mock.mock.calls[0]?.[1]).toMatchObject({ locale: ["en", "fr"] });

		});

		it("falls back to the store default where the Accept-Language header names no language", async () => {

			const mock = resolving({ id: "x" });

			await serve(mounted(lookup({ shape: Products }), stub({ lookup: mock })), "/products/", {
				headers: { "Accept-Language": "*" }
			});

			expect(mock.mock.calls[0]?.[1]).not.toHaveProperty("locale");

		});

	});

	describe("IRIs", () => {

		it("resolves request paths against the base", async () => {

			const mock = resolving({ id: "x" });

			await serve(mounted(lookup({ shape: Products }), stub({ lookup: mock }), base), "/products/");

			expect(mock.mock.calls[0]?.[0]).toMatchObject({ entry: "https://data.example.com/products/" });

		});

		it("relativizes IRIs against the base", async () => {

			const mock = resolving({
				id: "https://data.example.com/products/",
				members: [{ id: "https://data.example.com/products/1" }, { id: "https://other.example.com/products/2" }]
			});

			const { response } = await serve(
				mounted(lookup({ shape: Products }), stub({ lookup: mock }), base),
				"/products/"
			);

			expect(await response.json()).toEqual({
				id: "/products/",
				members: [{ id: "/products/1" }, { id: "https://other.example.com/products/2" }]
			});

		});

		it("relativizes IRIs against the request origin where no base is given", async () => {

			const mock = vi.fn(async ({ entry }: Record<string, unknown>) => ({ id: entry }));

			const { response } = await serve(
				mounted(lookup({ shape: Products }), stub({ lookup: mock })),
				"/products/"
			);

			expect(await response.json()).toEqual({ id: "/products/" });

		});

	});

	describe("review", () => {

		it.each([
			["synchronous", (match: object) => ({ ...match, reviewed: true })],
			["asynchronous", async (match: object) => ({ ...match, reviewed: true })]
		])("serves the resource returned by %s reviews", async (_, review) => {

			const { response } = await serve(
				mounted(lookup({ shape: Products, review }), stub({ lookup: resolving({ id: "x" }) })),
				"/products/"
			);

			expect(await response.json()).toEqual({ id: "x", reviewed: true });

		});

		it("relativizes IRIs in the reviewed resource against the base", async () => {

			const { response } = await serve(
				mounted(lookup({
					shape: Products,
					review: match => ({ ...match, related: "https://data.example.com/products/1" })
				}), stub({ lookup: resolving({ id: "https://data.example.com/products/" }) }), base),
				"/products/"
			);

			expect(await response.json()).toEqual({ id: "/products/", related: "/products/1" });

		});

		it("accepts only reviews returning resources", async () => {

			// @ts-expect-error reviews return a resource or nothing
			expect(() => lookup({ shape: Products, review: () => ["x"] })).not.toThrow();

		});

		it("reports resources the review withholds", async () => {

			const { response } = await serve(
				mounted(lookup({ shape: Products, review: () => undefined }), stub({ lookup: resolving({ id: "x" }) })),
				"/products/"
			);

			expect(response.status).toBe(404);

		});

	});

	it("reports missing resources", async () => {

		const { response } = await serve(lookup({ shape: Products }), "/products/");

		expect(response.status).toBe(404);

	});

});

describe("create()", () => {

	/**
	 * Creates a creation stub resolving to the identifier of the state it receives.
	 */
	const echoing = () => vi.fn(async ({ state }: Record<string, unknown>) => isObject(state) ? state.id : undefined);


	describe("identifiers", () => {

		it("creates resources named after the Slug header", async () => {

			const mock = echoing();

			const { origin, response } = await serve(
				mounted(create({ shape: Products }), stub({ create: mock })),
				"/products/",
				json("POST", { name: "widget" }, { Slug: "New Widget" })
			);

			expect(response.status).toBe(201);
			expect(response.headers.get("Location")).toBe("/products/new-widget");

			expect(mock.mock.calls[0]?.[0]).toEqual({
				entry: `${origin}/products/`,
				shape: Products,
				model: { members: {} },
				state: { id: `${origin}/products/new-widget`, name: "widget" }
			});

		});

		it.each<[string, Record<string, string>]>([
			["no Slug header is given", {}],
			["the Slug header holds no letter or digit", { Slug: " -!? " }]
		])("generates identifiers where %s", async (_, headers) => {

			const mock = echoing();

			const { origin } = await serve(
				mounted(create({ shape: Products }), stub({ create: mock })),
				"/products/",
				json("POST", { name: "widget" }, headers)
			);

			expect(mock.mock.calls[0]?.[0]).toMatchObject({
				state: { id: expect.stringMatching(new RegExp(`^${origin}/products/[-0-9a-f]{36}$`)) }
			});

		});

		it("keeps identifiers stated by the body", async () => {

			const mock = echoing();

			const { origin } = await serve(
				mounted(create({ shape: Products }), stub({ create: mock })),
				"/products/",
				json("POST", { name: "widget", id: "/products/kept" }, { Slug: "ignored" })
			);

			expect(mock.mock.calls[0]?.[0]).toMatchObject({ state: { id: `${origin}/products/kept` } });

		});

		it("reports identifiers stated by the body that are no IRI", async () => {

			const mock = echoing();

			const { response } = await serve(
				mounted(create({ shape: Products }), stub({ create: mock })),
				"/products/",
				json("POST", { name: "widget", id: 123 }, { Slug: "ignored" })
			);

			expect(response.status).toBe(422);
			expect(mock).not.toHaveBeenCalled();

		});

		it("names resources resolving against the base, locating them root-relative to it", async () => {

			const mock = echoing();

			const { response } = await serve(
				mounted(create({ shape: Products }), stub({ create: mock }), base),
				"/products/",
				json("POST", { name: "widget" }, { Slug: "New Widget" })
			);

			expect(response.headers.get("Location")).toBe("/products/new-widget");

			expect(mock.mock.calls[0]?.[0]).toMatchObject({
				entry: "https://data.example.com/products/",
				state: { id: "https://data.example.com/products/new-widget" }
			});

		});

		it("locates resources outside the base by their absolute IRI", async () => {

			const { response } = await serve(
				mounted(
					create({ shape: Products }),
					stub({ create: resolving("https://other.example.com/products/x") }),
					base
				),
				"/products/",
				json("POST", { name: "widget" })
			);

			expect(response.headers.get("Location")).toBe("https://other.example.com/products/x");

		});

	});

	describe("bodies", () => {

		const Item = resource({ id: id(), name: required(string()), related: multiple(reference(Product)) });
		const Items = resource({ id: id(), members: multiple(reference(Item)) });


		it("resolves body IRIs against the base before decoding", async () => {

			const mock = echoing();
			const decode = vi.fn((state: unknown) => state);

			await serve(
				mounted(create({ shape: Items, decode }), stub({ create: mock }), base),
				"/products/",
				json("POST", { id: "/products/x", name: "widget", related: ["/products/1"] })
			);

			expect(decode.mock.calls[0]?.[0]).toEqual({
				id: "https://data.example.com/products/x",
				name: "widget",
				related: ["https://data.example.com/products/1"]
			});

			expect(mock.mock.calls[0]?.[0]).toMatchObject({
				state: { id: "https://data.example.com/products/x", related: ["https://data.example.com/products/1"] }
			});

		});

		it("resolves body IRIs against the request origin where no base is given", async () => {

			const mock = echoing();

			const { origin } = await serve(
				mounted(create({ shape: Items }), stub({ create: mock })),
				"/products/",
				json("POST", { name: "widget", related: ["/products/1"] })
			);

			expect(mock.mock.calls[0]?.[0]).toMatchObject({ state: { related: [`${origin}/products/1`] } });

		});

		it("reuses bodies parsed by an upstream JSON parser, resolving their IRIs against the base", async () => {

			const mock = echoing();

			await serve(
				express()
					.set(StoreSetting, stub({ create: mock }))
					.set(BaseSetting, base)
					.use(express.json())
					.use(create({ shape: Items })),
				"/products/",
				json("POST", { name: "widget", related: ["/products/1"] }, { Slug: "x" })
			);

			expect(mock.mock.calls[0]?.[0]).toMatchObject({
				state: { name: "widget", related: ["https://data.example.com/products/1"] }
			});

		});

		it("decodes bodies before validation, awaiting asynchronous hooks", async () => {

			const mock = echoing();

			await serve(
				mounted(create({
					shape: Products,
					decode: async state => isObject(state) ? { ...state, name: "default" } : state
				}), stub({ create: mock })),
				"/products/",
				json("POST", {}, { Slug: "x" })
			);

			expect(mock.mock.calls[0]?.[0]).toMatchObject({ state: { name: "default" } });

		});

		it("reports bodies not stated as JSON, accepting JSON", async () => {

			const { response } = await serve(create({ shape: Products }), "/products/", {
				method: "POST",
				headers: { "Content-Type": "text/plain" },
				body: "widget"
			});

			expect(response.status).toBe(415);
			expect(response.headers.get("Accept")).toBe("application/json");

		});

		it("reports malformed JSON bodies", async () => {

			const { response } = await serve(create({ shape: Products }), "/products/", json("POST", "{ name"));

			expect(response.status).toBe(400);

		});

		it("reports invalid bodies with the violation trace", async () => {

			const { response } = await serve(create({ shape: Products }), "/products/", json("POST", { name: 1 }));

			expect(response.status).toBe(422);
			expect(await response.json()).toBeDefined();

		});

	});

	describe("shapes", () => {

		it("rejects shapes holding no collection of resources", async () => {

			expect(() => create({ shape: Product })).toThrow(TypeError);

		});

		it("rejects shapes holding several collections of resources", async () => {

			const Catalog = resource({ products: multiple(reference(Product)), more: multiple(reference(Product)) });

			expect(() => create({ shape: Catalog })).toThrow(TypeError);

		});

	});

	it("reports refused creations", async () => {

		const { response } = await serve(create({ shape: Products }), "/products/", json("POST", { name: "widget" }));

		expect(response.status).toBe(409);

	});

});

describe("slug()", () => {

	it("converts text to lowercase hyphenated slugs", async () => {
		expect(slug("  Héllo,   Wörld! ")).toBe("hello-world");
	});

	it("url-decodes text", async () => {
		expect(slug("caf%C3%A9%20bar")).toBe("cafe-bar");
	});

	it("returns undefined where no letter or digit is left", async () => {
		expect(slug(" -!? ")).toBeUndefined();
	});

});

describe("update()", () => {

	it("replaces resources named by the request target", async () => {

		const mock = acknowledging();

		const { origin, response } = await serve(
			mounted(update({ shape: Product }), stub({ update: mock })),
			"/products/1",
			json("PUT", { id: "/products/1", name: "widget" })
		);

		expect(response.status).toBe(204);

		expect(mock.mock.calls[0]?.[0]).toEqual({
			entry: `${origin}/products/1`,
			shape: Product,
			state: { id: `${origin}/products/1`, name: "widget" }
		});

	});

	it("reports bodies naming another resource", async () => {

		const mock = acknowledging();

		const { response } = await serve(
			mounted(update({ shape: Product }), stub({ update: mock })),
			"/products/1",
			json("PUT", { id: "/products/2", name: "widget" })
		);

		expect(response.status).toBe(422);
		expect(mock).not.toHaveBeenCalled();

	});

	it("resolves request paths against the base", async () => {

		const mock = acknowledging();

		await serve(
			mounted(update({ shape: Product }), stub({ update: mock }), base),
			"/products/1",
			json("PUT", { name: "widget" })
		);

		expect(mock.mock.calls[0]?.[0]).toMatchObject({
			entry: "https://data.example.com/products/1",
			state: { id: "https://data.example.com/products/1" }
		});

	});

	describe("bodies", () => {

		it("resolves body IRIs against the base before decoding", async () => {

			const mock = acknowledging();
			const decode = vi.fn((state: unknown) => state);

			await serve(
				mounted(update({ shape: Products, decode }), stub({ update: mock }), base),
				"/products/",
				json("PUT", { members: ["/products/1"] })
			);

			expect(decode.mock.calls[0]?.[0]).toEqual({ members: ["https://data.example.com/products/1"] });

			expect(mock.mock.calls[0]?.[0]).toMatchObject({
				state: { members: ["https://data.example.com/products/1"] }
			});

		});

		it("resolves body IRIs against the request origin where no base is given", async () => {

			const mock = acknowledging();

			const { origin } = await serve(
				mounted(update({ shape: Products }), stub({ update: mock })),
				"/products/",
				json("PUT", { members: ["/products/1"] })
			);

			expect(mock.mock.calls[0]?.[0]).toMatchObject({ state: { members: [`${origin}/products/1`] } });

		});

		it("decodes bodies before validation", async () => {

			const mock = acknowledging();

			await serve(
				mounted(update({
					shape: Product,
					decode: state => isObject(state) ? { ...state, name: "default" } : state
				}), stub({ update: mock })),
				"/products/1",
				json("PUT", {})
			);

			expect(mock.mock.calls[0]?.[0]).toMatchObject({ state: { name: "default" } });

		});

		it("reports bodies not stated as JSON", async () => {

			const { response } = await serve(update({ shape: Product }), "/products/1", {
				method: "PUT",
				headers: { "Content-Type": "text/plain" },
				body: "widget"
			});

			expect(response.status).toBe(415);

		});

		it("reports invalid bodies", async () => {

			const { response } = await serve(update({ shape: Product }), "/products/1", json("PUT", { name: 1 }));

			expect(response.status).toBe(422);

		});

	});

	describe("store rejections", () => {

		it("reports trace rejections with the violation trace", async () => {

			const { response } = await serve(
				mounted(
					update({ shape: Product }),
					stub({ update: rejecting(new TraceError("rejected", ["conflicting state"])) })
				),
				"/products/1",
				json("PUT", { name: "widget" })
			);

			expect(response.status).toBe(422);
			expect(await response.json()).toEqual(["conflicting state"]);

		});

		it("reports range rejections with their message", async () => {

			const { response } = await serve(
				mounted(update({ shape: Product }), stub({ update: rejecting(new RangeError("conflicting state")) })),
				"/products/1",
				json("PUT", { name: "widget" })
			);

			expect(response.status).toBe(422);
			expect(await response.json()).toEqual("conflicting state");

		});

	});

	it("reports missing resources", async () => {

		const { response } = await serve(update({ shape: Product }), "/products/1", json("PUT", { name: "widget" }));

		expect(response.status).toBe(404);

	});

});

describe("deleet()", () => {

	it("removes resources named by the request target", async () => {

		const mock = acknowledging();

		const { origin, response } = await serve(
			mounted(deleet({ shape: Product }), stub({ delete: mock })),
			"/products/1",
			{ method: "DELETE" }
		);

		expect(response.status).toBe(204);
		expect(mock.mock.calls[0]?.[0]).toEqual({ entry: `${origin}/products/1`, shape: Product });

	});

	it("resolves request paths against the base", async () => {

		const mock = acknowledging();

		await serve(
			mounted(deleet({ shape: Product }), stub({ delete: mock }), base),
			"/products/1",
			{ method: "DELETE" }
		);

		expect(mock.mock.calls[0]?.[0]).toMatchObject({ entry: "https://data.example.com/products/1" });

	});

	it("reports missing resources", async () => {

		const { response } = await serve(deleet({ shape: Product }), "/products/1", { method: "DELETE" });

		expect(response.status).toBe(404);

	});

	describe("other failures", () => {

		it("passes on store failures to the error middleware", async () => {

			const { response } = await serve(
				mounted(deleet({ shape: Product }), stub({ delete: rejecting(new Error("unavailable")) })),
				"/products/1",
				{ method: "DELETE" }
			);

			expect(response.status).toBe(500);

		});

		it("passes on failures where the application holds no store", async () => {

			const { response } = await serve(
				express().set(StoreSetting, undefined).use(deleet({ shape: Product })),
				"/products/1",
				{ method: "DELETE" }
			);

			expect(response.status).toBe(500);

		});

	});

});
