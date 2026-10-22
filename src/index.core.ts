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

/**
 * The application setting holding the canonical base the server was started with, as an absolute hierarchical IRI,
 * or `undefined` where none was given; mounted sub-applications inherit it, so routes read it from `request.app`.
 */
export const BaseSetting = "@metreeca/gate:base";

/**
 * The application setting holding the store the application was created with, or `undefined` where none was given;
 * mounted sub-applications inherit it, so routes read it from `request.app` wherever they are mounted in the stack.
 */
export const StoreSetting = "@metreeca/gate:store";
