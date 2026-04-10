/*
 * Copyright © 2025-2026 Metreeca srl
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

import { describe, expect, it } from "vitest";
import { decodeBase64, encodeBase64 } from "./base64.js";


describe("base64", () => {

	describe("encodeBase64()", () => {

		it("should encode an empty string to empty output", async () => {
			expect(encodeBase64("")).toBe("");
		});

		it.each([
			["foo", "Zm9v"],
			["hello", "aGVsbG8"]
		])("should encode ASCII input %s", async (plain, expected) => {
			expect(encodeBase64(plain)).toBe(expected);
		});

		it("should strip trailing base64 padding", async () => {
			// standard base64 would emit "Zg==" / "Zm8=" — URL-safe form drops "="
			expect(encodeBase64("f")).toBe("Zg");
			expect(encodeBase64("fo")).toBe("Zm8");
		});

		it("should replace + with - for URL safety", async () => {
			// ">>>" → bytes 3e 3e 3e → standard base64 "Pj4+"
			expect(encodeBase64(">>>")).toBe("Pj4-");
		});

		it("should replace / with _ for URL safety", async () => {
			// "???" → bytes 3f 3f 3f → standard base64 "Pz8/"
			expect(encodeBase64("???")).toBe("Pz8_");
		});

		it("should encode multi-byte UTF-8 characters", async () => {
			// "日" → UTF-8 bytes e6 97 a5 → base64 "5pel"
			expect(encodeBase64("日")).toBe("5pel");
		});

	});

	describe("decodeBase64()", () => {

		it("should decode an empty string to empty output", async () => {
			expect(decodeBase64("")).toBe("");
		});

		it.each([
			["Zm9v", "foo"],
			["aGVsbG8", "hello"]
		])("should decode ASCII input %s", async (encoded, expected) => {
			expect(decodeBase64(encoded)).toBe(expected);
		});

		it("should accept unpadded input", async () => {
			expect(decodeBase64("Zg")).toBe("f");
			expect(decodeBase64("Zm8")).toBe("fo");
		});

		it("should accept padded input", async () => {
			expect(decodeBase64("Zg==")).toBe("f");
			expect(decodeBase64("Zm8=")).toBe("fo");
		});

		it("should translate - back to +", async () => {
			expect(decodeBase64("Pj4-")).toBe(">>>");
		});

		it("should translate _ back to /", async () => {
			expect(decodeBase64("Pz8_")).toBe("???");
		});

		it("should decode multi-byte UTF-8 characters", async () => {
			expect(decodeBase64("5pel")).toBe("日");
		});

	});

});
