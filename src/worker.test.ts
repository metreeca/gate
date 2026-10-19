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

import express, { type ErrorRequestHandler } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { worker } from "./worker.js";


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

describe("worker", () => {

	const failure: ErrorRequestHandler = (error, _request, response, _next) => {
		response.status(503).json({ error: String(error) });
	};

	const serve = async (action: () => Promise<unknown>, request: RequestInit = {}) => {

		const server: Server = express()
			.use(worker(action))
			.use(failure)
			.listen(0);

		await new Promise(resolve => server.once("listening", resolve));

		try {

			return await fetch(
				`http://localhost:${(server.address() as AddressInfo).port}/`, // ;(cast) bound to a TCP port
				request
			);

		} finally {

			await new Promise(resolve => server.close(resolve));

		}

	};


	describe("completed actions", () => {

		it("acknowledges with an empty 200 OK", async () => {

			const response = await serve(async () => "discarded");

			expect(response.status).toBe(200);
			expect(await response.text()).toBe("");

		});

		it("responds only once the action settles", async () => {

			const settled = { value: false };

			await serve(async () => {
				await new Promise(resolve => setTimeout(resolve, 50));
				settled.value = true;
			});

			expect(settled.value).toBeTruthy();

		});

		it.each(["GET", "POST", "PUT", "DELETE"])("runs the action on %s requests", async method => {

			const action = vi.fn(async () => {});

			const response = await serve(action, { method, body: method === "GET" ? undefined : "ignored" });

			expect(response.status).toBe(200);
			expect(action).toHaveBeenCalledOnce();

		});

	});

	describe("rejected actions", () => {

		it("passes the error on to the error middleware", async () => {

			const response = await serve(async () => { throw new Error("failed"); });

			expect(response.status).toBe(503);
			expect(await response.json()).toEqual({ error: "Error: failed" });

		});

	});

});
