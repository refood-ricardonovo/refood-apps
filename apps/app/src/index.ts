/**
 * O Worker da PWA dos voluntários — a demonstração: entrar por NIF, e o mural que a sala vê.
 *
 * Mesma forma do `apps/tv`: um Worker que serve os seus próprios ficheiros estáticos **e** a sua
 * API na mesma origem, com o frontend a usar caminhos relativos. Não há CORS para configurar e a
 * app não sabe em que domínio está publicada.
 *
 * **Os assets são servidos antes deste `fetch`.** Um pedido que corresponda a um ficheiro de
 * `public/` nunca chega aqui — portanto uma rota de API não pode sombrear um ficheiro, e o que cai
 * neste código é `/api/*` e o que não existe.
 *
 * ## O que este Worker é, e o que não é
 *
 * **Nada aqui autentica ninguém.** O NIF que entra em `/api/entrar` é uma entrada, não uma
 * credencial, e o mural é público. É um atalho para uma apresentação, cercado por um interruptor
 * que se liga no dia e se desliga a seguir — ver `entrar.ts` e o `CLAUDE.md` desta app.
 *
 * **Quando o login a sério entrar** — NIF, código para o `hr_email`, PIN —, as duas rotas de
 * demonstração saem e o que fica no lugar delas autoriza por **sessão de voluntário, que expira**.
 * Não se parece com o token de dispositivo do `apps/tv`, e as duas apps não partilham código de
 * autenticação. Ver "Authorization" no `CLAUDE.md` da raiz.
 */

import { rotaEntrar } from './entrar';
import { rotaMural, rotaReiniciarMural } from './mural';

function metodoErrado(permitido: string): Response {
	return Response.json({ ok: false, erro: 'metodo_nao_permitido' }, { status: 405, headers: { Allow: permitido } });
}

/** O encaminhamento é à mão, sobre o `pathname`, como na TV. Sem router: são quatro casos. */
export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/api/entrar') {
			if (request.method !== 'POST') return metodoErrado('POST');
			return await rotaEntrar(request, env);
		}

		if (url.pathname === '/api/mural') {
			if (request.method !== 'GET') return metodoErrado('GET');
			return await rotaMural(env);
		}

		// POST e não GET: apaga uma tabela. Uma sonda, um pré-carregamento ou um `<img>` apontado a
		// um GET destrutivo fariam isso sozinhos.
		if (url.pathname === '/api/mural/reiniciar') {
			if (request.method !== 'POST') return metodoErrado('POST');
			return await rotaReiniciarMural(env);
		}

		/*
		 * Saúde do Worker, e só isso: sem versões, sem endereços, sem nada que descreva o que está
		 * por trás. É para poder ser chamado por uma sonda externa.
		 */
		if (url.pathname === '/api/health') {
			if (request.method !== 'GET') return metodoErrado('GET');
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
