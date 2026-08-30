export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        agora: new Date().toISOString(),
        odoo: env.ODOO_URL,
      });
    }

    return new Response("404 — rota de API inexistente", { status: 404 });
  },
} satisfies ExportedHandler<Env>;