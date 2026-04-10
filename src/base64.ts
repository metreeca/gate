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

/**
 * URL-safe base64 string codec.
 *
 * Wraps the standard {@link https://developer.mozilla.org/docs/Web/API/Window/btoa `btoa`} /
 * {@link https://developer.mozilla.org/docs/Web/API/Window/atob `atob`} primitives to address two limitations that
 * make them unsuitable on their own for encoding text destined for URLs:
 *
 * - **Unicode** — `btoa` / `atob` only accept binary (Latin-1) strings and throw on any code point above `0xFF`,
 *   so multi-byte characters (for example, `"日"`) cannot be passed in directly. The codec routes input through
 *   {@link TextEncoder} / {@link TextDecoder} to convert between JavaScript strings and UTF-8 byte sequences before
 *   delegating to the standard primitives.
 *
 * - **URL safety** — the standard base64 alphabet uses `+`, `/`, and `=`, all of which carry special meaning in
 *   URLs and `application/x-www-form-urlencoded` payloads (`+` is interpreted as space, `/` as a path separator,
 *   `=` as the key/value separator) and would otherwise need to be percent-encoded. The codec adopts the URL-safe
 *   variant defined in {@link https://www.rfc-editor.org/rfc/rfc4648#section-5 RFC 4648 §5}, mapping `+` / `/` to
 *   `-` / `_` on encode (and back on decode) and stripping the trailing `=` padding.
 *
 * @module
 */


/**
 * Encodes a string to URL-safe base64.
 *
 * @param plain The string to encode
 *
 * @returns The URL-safe base64-encoded string
 *
 * @see {@link decodeBase64}
 */
export function encodeBase64(plain: string): string {

	const bytes = new TextEncoder().encode(plain);
	const base64 = btoa(String.fromCharCode(...bytes));

	return base64
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

}

/**
 * Decodes a URL-safe base64 string.
 *
 * Handles both padded and unpadded input, restoring padding as needed before decoding.
 *
 * @param encoded The URL-safe base64-encoded string
 *
 * @returns The decoded string
 *
 * @see {@link encodeBase64}
 */
export function decodeBase64(encoded: string): string {

	const base64 = encoded
		.replace(/-/g, "+")
		.replace(/_/g, "/");

	const padLen = (4-base64.length%4)%4;
	const padded = padLen > 0 && !base64.endsWith("=") ? base64+"=".repeat(padLen) : base64;
	const bytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0));

	return new TextDecoder().decode(bytes);

}
