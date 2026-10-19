/*
 * Copyright © 2026 Metreeca srl. All rights reserved.
 */

import { Forbidden, InternalServerError, NotFound, ServiceUnavailable } from "@metreeca/http";
import type { Request, Response } from "express";
import { Server as HTTPServer } from "node:http";
import { createServer, type AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
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

		const ready = async (attempts: number): Promise<void> => fetch(origin).then(
			() => undefined,
			error => attempts > 0
				? new Promise(resolve => setTimeout(resolve, 10)).then(() => ready(attempts-1))
				: Promise.reject(error)
		);

		await ready(100);

		return task(origin).finally(() => controller.abort()).then(async value => served.then(() => value));

	};


	it("should create an Express application", async () => {

		const app = server();

		expect(app).toBeTypeOf("function");
		expect(app.use).toBeTypeOf("function");
		expect(app.get).toBeTypeOf("function");

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

		const failing = (error: Error) => {

			const app = server();

			app.get("/", () => { throw error; });

			return app;

		};

		it("should respond with a bodiless 500 to plain errors", async () => {

			await serving(failing(new Error("internal detail")), {}, async origin => {

				const response = await fetch(origin);

				expect(response.status).toBe(InternalServerError);
				expect(await response.text()).toBe("");

			});

		});

		it("should respond with the error status to client errors", async () => {

			await serving(failing(Object.assign(new Error("forbidden"), { status: Forbidden })), {}, async origin => {

				const response = await fetch(origin);

				expect(response.status).toBe(Forbidden);
				expect(await response.text()).toBe("");

			});

		});

		it("should respond with 500 to server errors", async () => {

			await serving(failing(Object.assign(new Error("down"), { status: ServiceUnavailable })), {}, async origin => {

				const response = await fetch(origin);

				expect(response.status).toBe(InternalServerError);
				expect(await response.text()).toBe("");

			});

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
			["proxies", { proxies: -1 }],
			["proxies", { proxies: 1.5 }],
			["grace", { grace: -1 }],
			["grace", { grace: 1.5 }]
		])("should reject malformed %s %o", async (_, options) => {

			await expect(server().listen(options)).rejects.toThrow(TypeError);

		});

	});

	describe("native form", () => {

		it("should return the underlying HTTP server", async () => {

			const native = server().listen(0);

			expect(native).toBeInstanceOf(HTTPServer);

			await new Promise(resolve => native.close(resolve));

		});

		it("should leave unmatched requests to the standard Express response", async () => {

			const native = server().listen(0, host);

			await new Promise(resolve => native.once("listening", resolve));

			const { port } = native.address() as AddressInfo; // ;(cast) bound to a TCP port

			const response = await fetch(`http://${host}:${port}/missing`);

			expect(response.status).toBe(NotFound);
			expect(await response.text()).not.toBe("");

			await new Promise(resolve => native.close(resolve));

		});

	});

});
