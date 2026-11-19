import { handle, type Env } from './app';

/** The Truck Dispatch Worker: every request goes to app.ts before any file is served. */
export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env, { devServer: import.meta.env?.DEV === true });
  },
} satisfies ExportedHandler<Env>;
