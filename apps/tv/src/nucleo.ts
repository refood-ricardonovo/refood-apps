/**
 * As rotas de dados da TV. Para já, a mais pequena que existe — e é essa a intenção.
 *
 * `GET /api/nucleo` prova a cadeia toda com o mínimo de superfície: token → `company_id` → domínio
 * com o âmbito **e** `allowed_company_ids` no contexto → Odoo → ecrã. Se isto responder o nome
 * certo, e responder 401 depois de uma revogação, o resto dos painéis é mais do mesmo.
 *
 * O que o ecrã ganha com ela: passa a dizer em que núcleo ficou. Uma aprovação enganada apanha-se
 * com a pessoa ainda ao telefone, em vez de dar por ela semanas depois ao ver os números errados
 * numa cozinha.
 */

import { PAINEIS, PAINEL_POR_OMISSAO } from './paineis';
import type { RotaTv } from './sessao';

/**
 * Só o nome. O `res.company` inteiro traz logótipo em base64 e dezenas de campos de contabilidade.
 *
 * `type` e não `interface`: o `searchRead` exige um `OdooRecord`, e uma interface não satisfaz um
 * `Record<string, unknown>`.
 */
type EmpresaOdoo = {
	id: number;
	name: string;
};

/**
 * `GET /api/nucleo` — o núcleo a que este ecrã está preso.
 *
 * O domínio vai vazio de propósito: quem lhe acrescenta o âmbito é o leitor, que o monta a partir
 * do token. Na `res.company` esse âmbito é `id`, porque a empresa não tem `company_id` — ela é a
 * empresa. Daí uma leitura sem cláusula nenhuma escrita aqui devolver, ainda assim, uma só linha.
 */
export const rotaNucleo: RotaTv = async ({ sessao, leitor }) => {
	const [empresa] = await leitor.searchRead<EmpresaOdoo>('res.company', [], { fields: ['name'], limit: 1 });

	if (!empresa) {
		// O token aponta para uma empresa que o Odoo não devolve. Ou foi apagada, ou o núcleo
		// atribuído no emparelhamento nunca existiu. O ecrã não tem nada de útil para mostrar.
		console.error({ evento: 'tv.nucleo_inexistente', company_id: sessao.empresa });
		return Response.json({ ok: false, erro: 'nucleo_inexistente' }, { status: 502 });
	}

	return Response.json({ ok: true, nucleo: { nome: empresa.name } });
};

/**
 * `GET /api/ecra` — a configuração deste ecrã. Hoje, o painel com que arranca.
 *
 * **Rota separada da do núcleo, e não é arrumação.** O que o `/api/nucleo` devolve é do **núcleo** —
 * igual nos dois televisores da mesma cozinha, e por isso guardável numa cache partilhada por
 * núcleo, que é como as leituras ao Odoo aqui funcionam. Isto é do **ecrã**: se os dois valores
 * viajassem na mesma resposta, o dia em que alguém pusesse um `cache` nessa leitura passava a
 * servir a configuração de um televisor ao outro — e o sintoma seria os dois abrirem no mesmo
 * painel, que é exactamente o que esta funcionalidade existe para evitar. Separadas, não há como.
 *
 * **Nunca leva o `local`.** A etiqueta que a sede escreve é de gestão e não sai do admin; nem
 * sequer chega à sessão — ver o `autenticarDispositivo`.
 *
 * O valor sai tal e qual da base, com a lista dos painéis que este Worker conhece ao lado. É o
 * televisor que decide o que fazer com um que não reconheça, porque é ele que sabe quais é que
 * sabe desenhar — durante uma actualização os dois lados não estão na mesma versão.
 */
export const rotaEcra: RotaTv = async ({ sessao }) =>
	Response.json({
		ok: true,
		ecra: {
			painel_inicial: sessao.painelInicial,
			paineis: PAINEIS,
			por_omissao: PAINEL_POR_OMISSAO,
		},
	});

/**
 * `POST /api/sinal` — o sinal de vida.
 *
 * Não faz nada: quem escreve o `visto_em` é o middleware, em qualquer pedido autenticado e só
 * quando a marca anterior está velha. Esta rota existe para o ecrã ter o que pedir quando está
 * parado a mostrar o mesmo painel — sem ela, uma TV sossegada era indistinguível de uma TV
 * desligada, e a revogação não chegava lá.
 */
export const rotaSinal: RotaTv = async () => Response.json({ ok: true });
