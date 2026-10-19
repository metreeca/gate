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

import express from "express";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client } from "./client.js";


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

describe("client", () => {

	const shell = "<!doctype html><title>shell</title>";
	const asset = "console.log('asset');";

	const navigation = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";


	const entry = "<!doctype html><title>entry</title>";


	let folder: string;
	let server: Server;
	let base: URL;

	const listen = async (path: string) => {

		const server = express()
			.use(client(path))
			.use((request, response) => response.vary("Origin").json({ fallthrough: true }))
			.listen(0);

		await new Promise(resolve => server.once("listening", resolve));

		return server;

	};

	const origin = (server: Server) => new URL(
		`http://localhost:${(server.address() as AddressInfo).port}/` // ;(cast) bound to a TCP port
	);

	beforeAll(async () => {

		folder = await mkdtemp(join(tmpdir(), "client-"));

		await writeFile(join(folder, "index.html"), shell);
		await writeFile(join(folder, "entry.html"), entry);
		await writeFile(join(folder, "app.js"), asset);

		server = await listen(`${folder}/`);
		base = origin(server);

	});

	afterAll(async () => {

		await new Promise(resolve => server.close(resolve));
		await rm(folder, { recursive: true, force: true });

	});


	const request = async (path: string, accept: string, method: string = "GET") => fetch(new URL(path, base), {
		method,
		headers: { Accept: accept }
	});

	const isShell = async (response: Response) => (await response.text()) === shell;
	const isFallthrough = async (response: Response) => (await response.text()) === JSON.stringify({ fallthrough: true });


	describe("page loads", () => {

		it.each(["/", "/index.html", "/events/123", "/app.js"])("serves the application at %s", async path => {

			expect(await isShell(await request(path, navigation))).toBeTruthy();

		});

		it("serves the application to bodiless HEAD page loads", async () => {

			const response = await request("/events/123", navigation, "HEAD");

			expect(response.status).toBe(200);
			expect(response.headers.get("Content-Type")).toMatch(/^text\/html/);
			expect(await response.text()).toBe("");

		});

		it("serves the application when text/html is the only acceptable type", async () => {

			expect(await isShell(await request("/events/123", "text/html"))).toBeTruthy();

		});

	});

	describe("entry page paths", () => {

		let named: Server;

		beforeAll(async () => {

			named = await listen(join(folder, "entry.html"));

		});

		afterAll(async () => {

			await new Promise(resolve => named.close(resolve));

		});


		it("serves the named entry page to page loads", async () => {

			const response = await fetch(new URL("/events/123", origin(named)), { headers: { Accept: navigation } });

			expect(await response.text()).toBe(entry);

		});

		it("serves static assets from the folder holding the entry page", async () => {

			const response = await fetch(new URL("/app.js", origin(named)), { headers: { Accept: "*/*" } });

			expect(await response.text()).toBe(asset);

		});

	});

	describe("folder paths", () => {

		let bare: Server;

		beforeAll(async () => {

			bare = await listen(folder);

		});

		afterAll(async () => {

			await new Promise(resolve => bare.close(resolve));

		});


		it("serves the folder index.html to page loads without a trailing slash", async () => {

			const response = await fetch(new URL("/events/123", origin(bare)), { headers: { Accept: navigation } });

			expect(await response.text()).toBe(shell);

		});

	});

	describe("other requests", () => {

		it("serves static assets", async () => {

			expect(await (await request("/app.js", "*/*")).text()).toBe(asset);

		});

		it.each([
			["any type", "*/*"],
			["a wildcard ranked first", "text/*"],
			["another type", "application/json"],
			["another type ranked first", "application/json, text/html;q=0.5"],
			["another type tied first", "application/json, text/html"],
			["text/html refused", "text/html;q=0, */*"],
			["a type extending text/html", "text/html-fragment"]
		])("falls through when accepting %s", async (_, accept) => {

			expect(await isFallthrough(await request("/events/123", accept))).toBeTruthy();

		});

		it.each(["POST", "PUT", "DELETE"])("falls through on %s page loads", async method => {

			expect(await isFallthrough(await request("/events/123", navigation, method))).toBeTruthy();

		});

	});

	describe("Vary", () => {

		it.each([
			["the application", "/events/123", navigation],
			["static assets", "/app.js", "*/*"]
		])("marks %s as varying by Accept", async (_, path, accept) => {

			expect((await request(path, accept)).headers.get("Vary")).toBe("Accept");

		});

		it("marks fall-through responses as varying by Accept, keeping later entries", async () => {

			expect((await request("/events/123", "application/json")).headers.get("Vary")).toBe("Accept, Origin");

		});

		it("marks non-GET responses as varying by Accept", async () => {

			expect((await request("/events/123", navigation, "POST")).headers.get("Vary")).toBe("Accept, Origin");

		});

	});

});
