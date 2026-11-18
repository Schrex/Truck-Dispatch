/** A tiny Worker that only owns the tests' local D1 (localD1.ts). */
export default {
  fetch: () => new Response('d1-only'),
};
