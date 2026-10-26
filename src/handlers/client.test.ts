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

import { DELETE, GET, HEAD, OK, POST, PUT } from "@metreeca/http";
import express from "express";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client } from "./client.js";


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

describe("client()", () => {

	const shell = "<!doctype html><title>shell</title>";
	const entry = "<!doctype html><title>entry</title>";
	const asset = "console.log('asset');";
	const nested = "body { margin: 0; }";

	const navigation = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
	const fallthrough = JSON.stringify({ fallthrough: true });


	/**
	 * Serves a client ahead of a fall-through route marking its responses as varying by `Origin`.
	 */
	const listen = async (path: string): Promise<Server> => {

		const server = express()
			.use(client(path))
			.use((_request, response) => response.vary("Origin").json({ fallthrough: true }))
			.listen(0);

		await new Promise(resolve => server.once("listening", resolve));

		return server;

	};

	const address = (server: Server) => new URL(
		`http://localhost:${(server.address() as AddressInfo).port}/` // ;(cast) bound to a TCP port
	);


	let folder: string;
	let server: Server;

	beforeAll(async () => {

		folder = await mkdtemp(join(tmpdir(), "client-"));

		await writeFile(join(folder, "index.html"), shell);
		await writeFile(join(folder, "entry.html"), entry);
		await writeFile(join(folder, "app.js"), asset);
		await mkdir(join(folder, "styles"));
		await writeFile(join(folder, "styles", "app.css"), nested);

		server = await listen(`${folder}/`);

	});

	afterAll(async () => {

		await new Promise(resolve => server.close(resolve));
		await rm(folder, { recursive: true, force: true });

	});


	const request = async (path: string, accept: string, method: string = GET) => fetch(
		new URL(path, address(server)), { method, headers: { Accept: accept } }
	);

	const body = async (path: string, accept: string, method: string = GET) => request(path, accept, method)
		.then(response => response.text());


	describe("navigation requests", () => {

		it.each(["/", "/index.html", "/events/123", "/app.js"])("serves the entry page at %s", async path => {

			expect(await body(path, navigation)).toBe(shell);

		});

		it("serves the entry page where text/html is the only acceptable type", async () => {

			expect(await body("/events/123", "text/html")).toBe(shell);

		});

		it("serves the entry page bodiless to HEAD requests", async () => {

			const response = await request("/events/123", navigation, HEAD);

			expect(response.status).toBe(OK);
			expect(response.headers.get("Content-Type")).toMatch(/^text\/html/);
			expect(await response.text()).toBe("");

		});

	});

	describe("other requests", () => {

		it("serves static assets", async () => {

			expect(await body("/app.js", "*/*")).toBe(asset);

		});

		it("serves static assets under their relative paths within the folder", async () => {

			expect(await body("/styles/app.css", "*/*")).toBe(nested);

		});

		it.each([
			["any type", "*/*"],
			["a wildcard ranked first", "text/*"],
			["another type", "application/json"],
			["another type ranked first", "application/json, text/html;q=0.5"],
			["another type tied first", "application/json, text/html"],
			["text/html refused", "text/html;q=0, */*"],
			["a type extending text/html", "text/html-fragment"]
		])("falls through where no asset matches when accepting %s", async (_, accept) => {

			expect(await body("/events/123", accept)).toBe(fallthrough);

		});

		it.each([POST, PUT, DELETE])("falls through on %s requests ranking text/html first", async method => {

			expect(await body("/events/123", navigation, method)).toBe(fallthrough);

		});

	});

	describe("Vary", () => {

		it.each([
			["the entry page", "/events/123", navigation, GET, "Accept"],
			["static assets", "/app.js", "*/*", GET, "Accept"],
			["fall-through responses", "/events/123", "application/json", GET, "Accept, Origin"],
			["fall-through responses to other methods", "/events/123", navigation, POST, "Accept, Origin"]
		])("marks %s as varying by Accept", async (_, path, accept, method, vary) => {

			expect((await request(path, accept, method)).headers.get("Vary")).toBe(vary);

		});

	});

	describe("path", () => {

		/**
		 * Serves a single request through a client hosted at a path computed from the fixture folder.
		 */
		const serving = async (path: (folder: string) => string, target: string, accept: string) => {

			const hosted = await listen(path(folder));

			try {

				return await (await fetch(new URL(target, address(hosted)), { headers: { Accept: accept } })).text();

			} finally {

				await new Promise(resolve => hosted.close(resolve));

			}

		};


		it.each<[string, (folder: string) => string]>([
			["a folder without a trailing slash", folder => folder],
			["a folder relative to the working directory", folder => relative(process.cwd(), folder)]
		])("serves the index.html of %s to navigation requests", async (_, path) => {

			expect(await serving(path, "/events/123", navigation)).toBe(shell);

		});

		it("serves the named entry page to navigation requests", async () => {

			expect(await serving(folder => join(folder, "entry.html"), "/events/123", navigation)).toBe(entry);

		});

		it("serves static assets from the folder holding the named entry page", async () => {

			expect(await serving(folder => join(folder, "entry.html"), "/app.js", "*/*")).toBe(asset);

		});

	});

});
