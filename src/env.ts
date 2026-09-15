/**
 * This Worker's environment, added to the one the generated server mounts on.
 *
 * `AppEnv` is an interface in the emitted `runtime.gen.ts`, so the application augments it rather
 * than replacing the module that declares it. Every generated route, and every `deps` hook, is then
 * typed against these bindings and variables.
 */
declare module "./generated/runtime.gen.js" {
	interface AppEnv {
		readonly Bindings: {
			readonly SERVICE_VERSION?: string;
		};
		readonly Variables: {
			readonly requestId: string;
		};
	}
}

/** Who is calling. Established once per request by `deps.context`, and handed to every handler. */
export interface Caller {
	readonly subject: string;
	readonly requestId: string;
}
