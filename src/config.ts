/**
 * Global configuration singleton for talon-sandbox SDK.
 *
 * Priority: explicit client arg > configure() > env vars > defaults
 */

import { Client, type ClientOptions } from "./client.js";

let globalClient: Client | undefined;

/**
 * Set global SDK configuration.
 *
 * @example
 * configure({ server: "https://api.example.com", apiKey: "ask_..." });
 */
export function configure(opts: ClientOptions): void {
  globalClient = new Client(opts);
}

/**
 * Get or create the global default client.
 * Reads TALON_SANDBOX_SERVER and TALON_SANDBOX_API_KEY from env.
 */
export function getDefaultClient(): Client {
  if (!globalClient) globalClient = new Client();
  return globalClient;
}

/**
 * Override the global client (used in tests).
 */
export function setDefaultClient(client: Client): void {
  globalClient = client;
}

/**
 * Reset global client to undefined (used in tests).
 */
export function resetDefaultClient(): void {
  globalClient = undefined;
}
