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

import { Forbidden, InternalServerError, NotFound, ServiceUnavailable } from "@metreeca/http";
import type { Store } from "@metreeca/keep";
import type { Request, Response } from "express";
import { Server as HTTPServer } from "node:http";
import { createServer, type AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { BaseSetting, StoreSetting } from "./index.core.js";
import { server, type ServerOpts } from "./index.js";


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

describe("server()", () => {

	const host = "127.0.0.1";


	/**
	 * Picks a port no other server is listening on.
	 */
	const vacant = async (): Promise<number> => {

		const probe = createServer();

		await new Promise<void>(resolve => probe.listen(0, host, resolve));

		const { port } = probe.address() as AddressInfo; // ;(cast) bound to a TCP port

		await new Promise(resolve => probe.close(resolve));

		return port;

	};

	/**
	 * Waits until a server answers requests at an origin.
	 */
	const ready = async (origin: URL, attempts: number = 100): Promise<void> => fetch(origin).then(
		() => undefined,
		error => attempts > 0
			? new Promise(resolve => setTimeout(resolve, 10)).then(() => ready(origin, attempts-1))
			: Promise.reject(error)
	);

	/**
	 * Serves an application while a task runs against its origin, then closes it through the signal option.
	 */
	const serving = async <T>(
		app: ReturnType<typeof server>,
		options: ServerOpts,
		task: (origin: URL) => Promise<T>
	): Promise<T> => {

		const port = await vacant();
		const origin = new URL(`http://${host}:${port}/`);
		const controller = new AbortController();

		const served = app.listen({ host, port, ...options, signal: controller.signal });

		await ready(origin);

		return task(origin).finally(() => controller.abort()).then(async value => served.then(() => value));

	};


	it("should create an Express application", async () => {

		const app = server();

		expect(app).toBeTypeOf("function");
		expect(app.use).toBeTypeOf("function");
		expect(app.get).toBeTypeOf("function");

	});

	describe("store", () => {

		it("should hold no store by default", async () => {

			expect(server().get(StoreSetting)).toBeUndefined();

		});

		it("should share the store with routes", async () => {

			const store = {} as Store; // ;(cast) opaque token: the server never calls the store

			expect(server(store).get(StoreSetting)).toBe(store);

		});

	});

	describe("routing", () => {

		it("should serve matched routes", async () => {

			const app = server();

			app.get("/", (_, response) => response.send("hello"));

			await serving(app, {}, async origin => {

				const response = await fetch(origin);

				expect(response.status).toBe(200);
				expect(await response.text()).toBe("hello");

			});

		});

		it("should respond with a bodiless 404 to unmatched requests", async () => {

			await serving(server(), {}, async origin => {

				const response = await fetch(new URL("/missing", origin));

				expect(response.status).toBe(NotFound);
				expect(await response.text()).toBe("");

			});

		});

	});

	describe("unhandled errors", () => {

		it.each<[string, Error, number]>([
			["plain errors", new Error("internal detail"), InternalServerError],
			["client errors", Object.assign(new Error("forbidden"), { status: Forbidden }), Forbidden],
			["server errors", Object.assign(new Error("down"), { status: ServiceUnavailable }), InternalServerError],
			["errors carrying a non-error status", Object.assign(new Error("moved"), { status: 302 }), InternalServerError]
		])("should respond to %s with a bodiless %i", async (_, error, status) => {

			const app = server();

			app.get("/", () => { throw error; });

			await serving(app, {}, async origin => {

				const response = await fetch(origin);

				expect(response.status).toBe(status);
				expect(await response.text()).toBe("");

			});

		});

	});

	describe("base", () => {

		const echoing = () => {

			const app = server();

			app.get("/", (request: Request, response: Response) => response.json(request.app.get(BaseSetting) ?? null));

			return app;

		};

		const base = (origin: URL) => fetch(origin).then(response => response.json());


		it("should expose no base by default", async () => {

			expect(await serving(echoing(), {}, base)).toBeNull();

		});

		it("should expose the base to routes", async () => {

			expect(await serving(echoing(), { base: "https://data.example.com/" }, base))
				.toBe("https://data.example.com/");

		});

	});

	describe("proxies", () => {

		const forwarded = "203.0.113.7";

		const echoing = () => {

			const app = server();

			app.get("/", (request: Request, response: Response) => response.send(request.ip));

			return app;

		};

		const ip = (origin: URL) => fetch(origin, { headers: { "X-Forwarded-For": forwarded } })
			.then(response => response.text());


		it("should ignore forwarded caller addresses by default", async () => {

			expect(await serving(echoing(), {}, ip)).not.toBe(forwarded);

		});

		it("should trust forwarded caller addresses from trusted hops", async () => {

			expect(await serving(echoing(), { proxies: 1 }, ip)).toBe(forwarded);

		});

	});

	describe("closing", () => {

		it("should close as soon as listening on an already aborted signal", async () => {

			await expect(server().listen({ host, port: await vacant(), signal: AbortSignal.abort() }))
				.resolves.toBeUndefined();

		});

		it.each(["SIGINT", "SIGTERM"] as const)("should close on %s", async signal => {

			const before = new Set(process.listeners(signal));

			const port = await vacant();
			const served = server().listen({ host, port });

			await ready(new URL(`http://${host}:${port}/`));

			// invoke the listener the server installed rather than emitting the signal, which would reach the test runner

			const installed = process.listeners(signal).filter(listener => !before.has(listener));

			expect(installed).toHaveLength(1);

			const [close] = installed;

			close?.(signal);

			await expect(served).resolves.toBeUndefined();

		});

		it("should let requests in flight complete within the grace period", async () => {

			const app = server();

			app.get("/slow", (_, response) => { setTimeout(() => response.send("done"), 100); });

			const { pending } = await serving(app, { grace: 1000 }, async origin => {

				const pending = fetch(new URL("/slow", origin)).then(response => response.text());

				await new Promise(resolve => setTimeout(resolve, 50)); // let the request reach the route

				return { pending }; // wrapped, so that closing doesn't wait for the request to settle

			});

			expect(await pending).toBe("done");

		});

		it("should close lingering connections at the end of the grace period", async () => {

			const app = server();

			app.get("/lingering", () => { /* never responds */ });

			const { lingering } = await serving(app, { grace: 100 }, async origin => {

				const lingering = fetch(new URL("/lingering", origin));

				await new Promise(resolve => setTimeout(resolve, 50)); // let the request reach the route

				return { lingering }; // wrapped, so that closing doesn't wait for the request to settle

			});

			await expect(lingering).rejects.toThrow();

		});

	});

	describe("failures", () => {

		it("should reject if the port is taken", async () => {

			const blocker = createServer();

			await new Promise<void>(resolve => blocker.listen(0, host, resolve));

			const { port } = blocker.address() as AddressInfo; // ;(cast) bound to a TCP port

			await expect(server().listen({ host, port })).rejects.toThrow();

			await new Promise(resolve => blocker.close(resolve));

		});

		it.each<[string, ServerOpts]>([
			["host", { host: "local host" }],
			["port", { port: -1 }],
			["port", { port: 65536 }],
			["port", { port: 1.5 }],
			["base", { base: "/v1/" }],
			["base", { base: "urn:example:v1/" }],
			["proxies", { proxies: -1 }],
			["proxies", { proxies: 1.5 }],
			["grace", { grace: -1 }],
			["grace", { grace: 1.5 }]
		])("should reject malformed %s %o", async (_, options) => {

			await expect(server().listen(options)).rejects.toThrow(TypeError);

		});

	});

	describe("native form", () => {

		/**
		 * Serves an application in the native form while a task runs against its origin.
		 */
		const natively = async (app: ReturnType<typeof server>, task: (origin: URL) => Promise<void>) => {

			const native = app.listen(0, host);

			await new Promise(resolve => native.once("listening", resolve));

			const { port } = native.address() as AddressInfo; // ;(cast) bound to a TCP port

			try {

				await task(new URL(`http://${host}:${port}/`));

			} finally {

				await new Promise(resolve => native.close(resolve));

			}

		};


		it.each<[string, (app: ReturnType<typeof server>) => HTTPServer]>([
			["no argument", app => app.listen()],
			["a port", app => app.listen(0)],
			["a callback", app => app.listen(() => {})]
		])("should return the underlying HTTP server to calls with %s", async (_, listen) => {

			const native = listen(server());

			expect(native).toBeInstanceOf(HTTPServer);

			await new Promise(resolve => native.close(resolve));

		});

		it("should leave unmatched requests to the standard Express response", async () => {

			await natively(server(), async origin => {

				const response = await fetch(new URL("/missing", origin));

				expect(response.status).toBe(NotFound);
				expect(await response.text()).not.toBe("");

			});

		});

		it("should leave unhandled errors to the standard Express response", async () => {

			const app = server();

			app.get("/", () => { throw new Error("internal detail"); });

			await natively(app, async origin => {

				const response = await fetch(origin);

				expect(response.status).toBe(InternalServerError);
				expect(await response.text()).not.toBe("");

			});

		});

	});

});
