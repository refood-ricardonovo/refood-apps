/**
 * O Worker da PWA dos voluntários — por agora, uma página e um sinal de saúde.
 *
 * Mesma forma do `apps/tv`: um Worker que serve os seus próprios ficheiros estáticos **e** a sua
 * API na mesma origem, com o frontend a usar caminhos relativos. Não há CORS para configurar e a
 * app não sabe em que domínio está publicada.
 *
 * **Os assets são servidos antes deste `fetch`.** Um pedido que corresponda a um ficheiro de
 * `public/` nunca chega aqui — portanto uma rota de API não pode sombrear um ficheiro, e o que cai
 * neste código é `/api/*` e o que não existe.
 *
 * **Não há Odoo, não há D1, não há KV.** O `Env` está vazio, e é para continuar assim até haver uma
 * decisão escrita: a autorização desta app é por sessão de voluntário, que expira, e não se parece
 * com o token de dispositivo da TV. Ver a secção «Authorization» no `CLAUDE.md` da raiz antes de
 * ligar a primeira rota que sirva dados.
 */

/** O encaminhamento é à mão, sobre o `pathname`, como na TV. Sem router: são três casos. */
export default {
	async fetch(request): Promise<Response> {
		const url = new URL(request.url);

		/*
		 * Saúde do Worker, e só isso: sem versões, sem endereços, sem nada que descreva o que está
		 * por trás. É para poder ser chamado por uma sonda externa, e é a razão de o Worker existir
		 * já — sem ele, isto era um site estático e não se saberia se o Worker está de pé.
		 */
		if (url.pathname === '/api/health') {
			if (request.method !== 'GET') {
				return Response.json({ ok: false, erro: 'metodo_nao_permitido' }, { status: 405, headers: { Allow: 'GET' } });
			}
			return Response.json({ ok: true, agora: new Date().toISOString() });
		}

		// Uma rota de API que não existe diz que não existe. Tudo o resto é um endereço fora da app —
		// e como não há encaminhamento do lado do cliente, também não há `index.html` a servir aqui.
		if (url.pathname.startsWith('/api/')) {
			return new Response('404 — rota de API inexistente', { status: 404 });
		}

		return new Response('404 — página inexistente', { status: 404 });
	},
} satisfies ExportedHandler<Env>;
