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

import { reference } from "@metreeca/blue/reference";
import { id, multiple, optional, required, resource as shape } from "@metreeca/blue/resource";
import { string } from "@metreeca/blue/string";
import type { Store } from "@metreeca/keep";
import express, { type RequestHandler } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { BaseSetting, StoreSetting } from "../../index.core.js";
import { driver, type Driver } from "./index.js";


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const Product = shape({
	id: id(),
	name: required(string())
});

const Products = shape({
	id: id(),
	label: optional(string()),
	members: multiple(reference(Product))
});


/**
 * Creates a store stub resolving every operation to a successful outcome.
 */
function stub(): Store {

	const store: Readonly<Record<string, unknown>> = {
		lookup: vi.fn(async () => ({ id: "x" })),
		create: vi.fn(async () => "http://localhost/products/x"),
		update: vi.fn(async ({ entry }: Record<string, unknown>) => entry),
		delete: vi.fn(async ({ entry }: Record<string, unknown>) => entry),
		insert: vi.fn(async () => { throw new Error("unexpected insert"); }),
		remove: vi.fn(async () => { throw new Error("unexpected remove"); }),
		observe: vi.fn(() => () => {}),
		execute: vi.fn(async (task: (client: unknown) => unknown) => task(store)),
		close: vi.fn(async () => {})
	};

	return store as unknown as Store; // ;(cast) test mock: a Vitest mock cannot implement the generic store methods

}

/**
 * Serves a request through a handler mounted on a path over a stub store, addressed to that path or to a target.
 */
async function serve(handler: RequestHandler, path: string, request: RequestInit = {}, target: string = path) {

	return fetching(express().set(StoreSetting, stub()).use(path, handler), target, request);

}

/**
 * Serves a single request through an application.
 */
async function fetching(app: express.Express, path: string, request: RequestInit = {}) {

	const server: Server = app.listen(0);

	await new Promise(resolve => server.once("listening", resolve));

	try {

		return await fetch(
			`http://localhost:${(server.address() as AddressInfo).port}${path}`, // ;(cast) bound to a TCP port
			request
		);

	} finally {

		await new Promise(resolve => server.close(resolve));

	}

}

/**
 * Builds a JSON request with the given method and body.
 */
function json(method: string, body: unknown): RequestInit {
	return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

describe("driver()", () => {

	describe("enabled methods", () => {

		it.each<[string, () => Driver, RequestInit, number]>([
			["lookups", () => driver(Products).lookup(), {}, 200],
			["creations", () => driver(Products).create(), json("POST", { name: "widget" }), 201],
			["updates", () => driver(Product).update(), json("PUT", { name: "widget" }), 204],
			["deletions", () => driver(Product).delete(), { method: "DELETE" }, 204]
		])("serves enabled %s", async (_, route, request, status) => {

			expect((await serve(route(), "/products/", request)).status).toBe(status);

		});

		it("serves the resource as JSON to lookups", async () => {

			expect(await (await serve(driver(Products).lookup(), "/products/")).json()).toEqual({ id: "x" });

		});

		it("serves HEAD requests bodiless through lookups", async () => {

			const response = await serve(driver(Products).lookup(), "/products/", { method: "HEAD" });

			expect(response.status).toBe(200);
			expect(await response.text()).toBe("");

		});

		it("serves every method enabled on the same driver", async () => {

			const route = driver(Products).lookup().create().update().delete();

			expect((await serve(route, "/products/")).status).toBe(200);
			expect((await serve(route, "/products/", json("POST", { name: "widget" }))).status).toBe(201);
			expect((await serve(route, "/products/", json("PUT", { label: "products" }))).status).toBe(204);
			expect((await serve(route, "/products/", { method: "DELETE" })).status).toBe(204);

		});

		it("serves deferred shapes", async () => {

			expect((await serve(driver(() => Products).lookup(), "/products/")).status).toBe(200);

		});

		it("replaces the options of methods enabled again", async () => {

			const response = await serve(
				driver(Products)
					.lookup({ review: () => ({ first: true }) })
					.lookup({ review: () => ({ second: true }) }),
				"/products/"
			);

			expect(await response.json()).toEqual({ second: true });

		});

		it("serves methods enabled after mounting", async () => {

			const route = driver(Products).lookup();

			const app = express().set(StoreSetting, stub()).use("/products/", route);

			route.create();

			expect((await fetching(app, "/products/", json("POST", { name: "widget" }))).status).toBe(201);

		});

		it("rejects creations on shapes holding no collection of resources", async () => {

			expect(() => driver(Product).create()).toThrow(TypeError);

		});

	});

	describe("OPTIONS requests", () => {

		it.each<[string, () => Driver, string]>([
			["lookups", () => driver(Products).lookup(), "GET, HEAD, OPTIONS"],
			["creations", () => driver(Products).create(), "POST, OPTIONS"],
			["lookups and creations", () => driver(Products).create().lookup(), "GET, HEAD, POST, OPTIONS"],
			["lookups, updates and deletions", () => driver(Product).delete().update().lookup(),
				"GET, HEAD, PUT, DELETE, OPTIONS"
			],
			["every method", () => driver(Products).lookup().create().update().delete(),
				"GET, HEAD, POST, PUT, DELETE, OPTIONS"
			]
		])("answers with the methods enabled on drivers enabling %s", async (_, route, allow) => {

			const response = await serve(route(), "/products/", { method: "OPTIONS" });

			expect(response.status).toBe(204);
			expect(response.headers.get("Allow")).toBe(allow);

		});

	});

	describe("methods not enabled", () => {

		it.each<[string, () => Driver, RequestInit]>([
			["DELETE", () => driver(Products).lookup(), { method: "DELETE" }],
			["POST", () => driver(Product).lookup(), json("POST", { name: "widget" })]
		])("rejects %s with the methods enabled", async (_, route, request) => {

			const response = await serve(route(), "/products/", request);

			expect(response.status).toBe(405);
			expect(response.headers.get("Allow")).toBe("GET, HEAD, OPTIONS");

		});

	});

	describe("mount path", () => {

		it.each([
			["/products/", "/products/"],
			["/products/", "/products"],
			["/products", "/products"],
			["/products", "/products/"]
		])("serves a driver mounted on %s when requested as %s", async (path, target) => {

			expect((await serve(driver(Products).lookup(), path, {}, target)).status).toBe(200);

		});

		it("passes on requests where no method is enabled", async () => {

			expect((await serve(driver(Products), "/products/")).status).toBe(404);

		});

		it("passes on requests below its mount path", async () => {

			expect((await serve(driver(Products).lookup(), "/products/", {}, "/products/1")).status).toBe(404);

		});

		it("leaves requests below its mount path to the routes mounted there", async () => {

			const app = express()
				.set(StoreSetting, stub())
				.use("/products/", driver(Products).lookup())
				.use("/products/:id", driver(Product).delete());

			expect((await fetching(app, "/products/1", { method: "DELETE" })).status).toBe(204);

		});

	});

	describe("settings", () => {

		it("serves the store the application was created with", async () => {

			const store = stub();

			await fetching(express()
				.set(StoreSetting, store)
				.use("/products/1", driver(Product).delete()), "/products/1", { method: "DELETE" }
			);

			expect(vi.mocked(store.delete)).toHaveBeenCalledOnce();

		});

		it("passes on requests to applications created with no store", async () => {

			const response = await fetching(
				express().use("/products/1", driver(Product).delete()), "/products/1", { method: "DELETE" }
			);

			expect(response.status).toBe(500);

		});

		it("resolves request paths against the base the server was started with", async () => {

			const store = stub();

			await fetching(express()
				.set(StoreSetting, store)
				.set(BaseSetting, "https://data.example.com/v1/")
				.use("/products/1", driver(Product).delete()), "/products/1", { method: "DELETE" }
			);

			expect(vi.mocked(store.delete).mock.calls[0]?.[0]).toMatchObject({
				entry: "https://data.example.com/products/1"
			});

		});

	});

});
