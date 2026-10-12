
/**
 * NIVORA ONE — Cloudflare Worker
 * Serves frontend files from the public/ directory.
 */

export default {
  async fetch(request, env) {
    try {
      // Serve website files using the ASSETS binding
      if (!env.ASSETS) {
        return new Response(
          "NIVORA ONE: ASSETS binding is not configured.",
          {
            status: 500,
            headers: { "Content-Type": "text/plain; charset=UTF-8" }
          }
        );
      }

      const response = await env.ASSETS.fetch(request);

      // Add basic security headers without changing the file contents
      const headers = new Headers(response.headers);
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
      headers.set("X-Frame-Options", "SAMEORIGIN");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    } catch (error) {
      return new Response("NIVORA ONE service error.", {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=UTF-8" }
      });
    }
  }
};
