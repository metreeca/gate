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
 * Worker hosting for Express applications.
 *
 * Lets a server run asynchronous actions on request, such as background jobs triggered by a scheduler. Callers learn
 * the outcome of each run from the status code alone, so no response body needs to be parsed or kept.
 *
 * @module worker
 */

import { OK } from "@metreeca/http";
import type { RequestHandler } from "express";


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Serves an asynchronous action as a worker.
 *
 * Every request reaching the handler runs the action, whatever its method and content. The response is sent only once
 * the action settles, so the caller waits for the whole run to complete before learning its outcome.
 *
 * A completed action is acknowledged with an empty `200 OK`. A rejected action is passed on to the error middleware of
 * the surrounding stack, which is then responsible for the error response and the status code it carries.
 *
 * The handler performs no authentication of its own: access control is left to the surrounding stack.
 *
 * @param handler The action to run on each request; its result is discarded
 *
 * @returns A handler running the action on every request it receives, to be mounted on a dedicated route
 */
export function worker(handler: () => Promise<unknown>): RequestHandler {

	return async (_request, response) => {

		await handler();

		response.status(OK).end();

	};

}
