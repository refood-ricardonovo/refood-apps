import { createOdooClient } from "@refood/odoo";

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

    if (url.pathname === "/api/version") {
      try {
        const odoo = createOdooClient(env);
        const versao = await odoo.version();
        return Response.json({ ok: true, versao });
      } catch (erro) {
        return Response.json(
          { ok: false, erro: erro instanceof Error ? erro.message : String(erro) },
          { status: 502 }
        );
      }
    }

    if (url.pathname === "/api/teste") {
      try {
        const odoo = createOdooClient(env);

        const uid = await odoo.authenticate();

        const utilizadores = await odoo.searchCount("res.users", [["active", "=", true]]);
        const contactos = await odoo.searchCount("res.partner", [["active", "=", true]]);

        const amostra = await odoo.searchRead<{ id: number; name: string; login: string }>(
          "res.users",
          [["active", "=", true]],
          { fields: ["name", "login"], limit: 5, order: "id asc" }
        );

        return Response.json({ ok: true, uid, utilizadores, contactos, amostra });
      } catch (erro) {
        return Response.json(
          {
            ok: false,
            tipo: erro instanceof Error ? erro.name : "Desconhecido",
            erro: erro instanceof Error ? erro.message : String(erro),
          },
          { status: 502 }
        );
      }
    }
    return new Response("404 — rota de API inexistente", { status: 404 });
  },
} satisfies ExportedHandler<Env>;