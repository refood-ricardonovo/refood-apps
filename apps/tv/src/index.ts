import { rotaAdmin } from './admin';
import { rotaEstadoEmparelhamento, rotaIniciarEmparelhamento, rotaRecolherToken } from './emparelhamento';
import { rotaEntregas } from './entregas';
import { rotaNucleo, rotaSinal } from './nucleo';
import { rotaRecolhas } from './recolhas';
import { servirRotaTv, type RotaTv } from './sessao';

/** As rotas de emparelhamento, todas em POST: escrevem no D1 e não devem entrar em cache nenhuma. */
const EMPARELHAMENTO: Record<string, (request: Request, env: Env) => Promise<Response>> = {
	'/api/emparelhamento': rotaIniciarEmparelhamento,
	'/api/emparelhamento/estado': rotaEstadoEmparelhamento,
	'/api/emparelhamento/recolher': rotaRecolherToken,
};

/**
 * As rotas de dados da TV, todas atrás do middleware.
 *
 * Passam pelo `servirRotaTv` e recebem um contexto sem `Request` e sem `Env` — não têm por onde ler
 * um núcleo que não seja o do token. Uma rota nova entra nesta tabela e nasce com o âmbito fechado.
 */
const TV: Record<string, { metodo: string; rota: RotaTv }> = {
	'/api/nucleo': { metodo: 'GET', rota: rotaNucleo },
	'/api/sinal': { metodo: 'POST', rota: rotaSinal },
	'/api/entregas': { metodo: 'GET', rota: rotaEntregas },
	'/api/recolhas': { metodo: 'GET', rota: rotaRecolhas },
};

function metodoErrado(permitido: string): Response {
	return Response.json({ ok: false, erro: 'metodo_nao_permitido' }, { status: 405, headers: { Allow: permitido } });
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);

		// Tudo o que está sob /api/admin/ entra pelo mesmo sítio, e esse sítio confere o segredo da
		// sede antes de olhar para o caminho. Uma rota nova nasce protegida.
		if (url.pathname.startsWith('/api/admin/')) {
			return await rotaAdmin(request, env);
		}

		const emparelhamento = EMPARELHAMENTO[url.pathname];
		if (emparelhamento) {
			if (request.method !== 'POST') return metodoErrado('POST');
			return await emparelhamento(request, env);
		}

		const tv = TV[url.pathname];
		if (tv) {
			if (request.method !== tv.metodo) return metodoErrado(tv.metodo);
			// O sinal de vida vai para o `waitUntil`: escreve-se depois de a resposta seguir.
			return await servirRotaTv(request, env, tv.rota, { aguardar: (promessa) => ctx.waitUntil(promessa) });
		}

		// Saúde do Worker, e só isso: sem versões, sem endereços, sem nada que descreva o que está
		// por trás. É o único ponto aberto, e é para poder ser chamado por uma sonda externa.
		if (url.pathname === '/api/health') {
			return Response.json({ ok: true, agora: new Date().toISOString() });
		}

		return new Response('404 — rota de API inexistente', { status: 404 });
	},
} satisfies ExportedHandler<Env>;
