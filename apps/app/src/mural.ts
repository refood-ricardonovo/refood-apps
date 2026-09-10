/**
 * `GET /api/mural` — o que a sala vê projectado: os núcleos presentes, e quem acabou de entrar.
 *
 * ## Duas metades, com origens diferentes, e é isso que a torna barata
 *
 * **As contagens e a ordem saem do D1, por SQL.** Um `GROUP BY company_id` com `COUNT(*)` e
 * `MIN(criado_em)` responde a tudo o que a coluna da esquerda mostra, e não passa pelo Odoo. É
 * também o que faz **a contagem incluir toda a gente, sem excepção**: quem entrou e cuja ficha não
 * devolve nome legível conta na mesma — só não aparece na nuvem.
 *
 * **Os nomes saem do Odoo, e só os das chegadas novas.** A versão anterior lia todos os presentes a
 * cada sonda: com 300 pessoas e cinco segundos, eram 3 600 fichas por minuto contra uma base
 * on-premise, para redesenhar um ecrã que quase nunca muda. Agora, numa sonda em que ninguém entrou,
 * são **zero idas ao Odoo**.
 *
 * ## A janela é `(desde, agora]`, e o `agora` fixa-se à entrada
 *
 * O cursor é um instante, não um identificador. O `agora` é lido no primeiro instante do pedido e é
 * o limite superior da janela **e** o cursor devolvido: as janelas de duas sondas seguidas encostam
 * uma na outra sem buraco e sem sobreposição.
 *
 * **A primeira sonda — a que vem sem `desde` — não traz nomes.** Não é um caso por tratar: a nuvem
 * é o que está a acontecer e a coluna é o estado. Quem abrir o mural a meio da sessão vê as
 * contagens certas de toda a gente e não vê passar os nomes de quem já entrou, porque esses já
 * aconteceram. Quem não estava a ver, não viu.
 *
 * ## O que se perde com um cursor por milissegundo, e porque é que se aceita
 *
 * A janela é aberta à esquerda (`criado_em > desde`). Duas entradas no **mesmo milissegundo** na
 * fronteira de uma sonda perdiam uma delas.
 *
 * A consequência não é uma contagem errada: **perde-se um nome na nuvem, e a contagem do núcleo
 * continua certa**, porque vem do `GROUP BY` e não desta janela. Uma pessoa entra, a coluna da
 * esquerda sobe, e o nome dela não chega a passar no ecrã.
 *
 * **É por isso que não vale a pena um id de pessoa no payload.** Desempatar exigia expor o
 * `employee_id` — um identificador estável de uma pessoa real, numa página pública e sem
 * autenticação — para evitar, num caso que exige duas pessoas a carregar no botão no mesmo
 * milissegundo, que um nome não apareça durante seis segundos.
 */

import { many2oneId } from '@refood/odoo';
import { entradaAberta } from './interruptor';
import { primeiroNome } from './nomes';
import { LINGUA, ligarAoOdoo } from './odoo';

/** Tectos das leituras. Há 87 núcleos na base, e uma sala não tem mais gente do que isto. */
const LIMITE_NUCLEOS = 200;
const LIMITE_NOVOS = 100;

type FichaOdoo = { id: number; full_name: string | false; name?: string | false; company_id: [number, string] | false };
type GrupoSql = { company_id: number; total: number; primeiro: string };
type ChegadaSql = { employee_id: number; criado_em: string };

export interface NucleoDoMural {
	readonly nucleo: string;
	readonly total: number;
}

export interface Mural {
	/** Por ordem de chegada do primeiro voluntário de cada núcleo. */
	readonly nucleos: readonly NucleoDoMural[];
	readonly total: number;
	/** Os primeiros nomes de quem entrou desde a sonda anterior, por ordem de chegada. */
	readonly novos: readonly string[];
	/** O cursor da sonda seguinte. */
	readonly agora: string;
}

export async function rotaMural(request: Request, env: Env): Promise<Response> {
	// Fixa-se aqui, antes de qualquer query: é o limite superior da janela e o cursor devolvido.
	const agora = new Date().toISOString();

	if (!entradaAberta(env)) {
		return Response.json({ ok: true, mural: { nucleos: [], total: 0, novos: [], agora } });
	}

	/*
	 * **A coluna sai daqui, e só daqui.** `COUNT(*)` conta toda a gente que entrou; `MIN(criado_em)`
	 * é a ordem — por chegada do primeiro voluntário de cada núcleo, e não alfabética, porque é a
	 * ordem em que a sala se encheu.
	 */
	const grupos = await env.DB.prepare(
		'SELECT company_id, COUNT(*) AS total, MIN(criado_em) AS primeiro FROM presencas_demo GROUP BY company_id ORDER BY primeiro ASC LIMIT ?',
	)
		.bind(LIMITE_NUCLEOS)
		.all<GrupoSql>();

	const total = grupos.results.reduce((s, g) => s + g.total, 0);

	// Sem `desde` não há nomes a mostrar — ver o cabeçalho. Também não se toca no Odoo por causa
	// disso: só falta traduzir os núcleos, que vem de cache.
	const desde = new URL(request.url).searchParams.get('desde');

	const chegadas = desde
		? await env.DB.prepare(
				'SELECT employee_id, criado_em FROM presencas_demo WHERE criado_em > ? AND criado_em <= ? ORDER BY criado_em ASC LIMIT ?',
			)
				.bind(desde, agora, LIMITE_NOVOS)
				.all<ChegadaSql>()
		: { results: [] as ChegadaSql[] };

	if (grupos.results.length === 0) {
		return Response.json({ ok: true, mural: { nucleos: [], total: 0, novos: [], agora } });
	}

	const { cliente, empresas, nucleos } = await ligarAoOdoo(env);

	/*
	 * `read` e não `search_read`: os ids são nossos, saíram da pesquisa que os gravou, e o que falta
	 * é o nome de cada um. O `allowed_company_ids` vai na mesma — é o que a regra espera, e o que
	 * protege de uma mudança do lado do Odoo.
	 */
	const fichas =
		chegadas.results.length === 0
			? []
			: await cliente.read<FichaOdoo>(
					'hr.employee',
					chegadas.results.map((c) => c.employee_id),
					['full_name', 'name', 'company_id'],
					{ lang: LINGUA, context: { allowed_company_ids: [...empresas] } },
				);

	// O `read` não garante ordem: reordena-se pela chegada, que é a ordem em que a nuvem os mostra.
	const nomePorId = new Map<number, string>();
	for (const ficha of fichas) {
		const nome = primeiroNome(ficha.full_name, ficha.name);
		if (nome !== null) nomePorId.set(ficha.id, nome);
	}

	const novos = chegadas.results.map((c) => nomePorId.get(c.employee_id)).filter((n): n is string => n !== undefined);

	/*
	 * **Se a janela encheu, o cursor recua para a última linha servida** em vez de saltar para o
	 * `agora`. Sem isto, uma sonda que apanhasse mais de `LIMITE_NOVOS` chegadas deitava fora as
	 * restantes: o cursor passava-lhes à frente e aqueles nomes nunca apareciam.
	 */
	const ultima = chegadas.results[chegadas.results.length - 1];
	const cursor = chegadas.results.length === LIMITE_NOVOS && ultima ? ultima.criado_em : agora;

	const lista: NucleoDoMural[] = grupos.results.map((g) => ({
		nucleo: nucleos.get(g.company_id) ?? `Núcleo ${g.company_id}`,
		total: g.total,
	}));

	return Response.json({ ok: true, mural: { nucleos: lista, total, novos, agora: cursor } });
}

/**
 * `POST /api/mural/reiniciar` — esvazia a tabela.
 *
 * **O `/mural` simples nunca limpa.** Se limpasse ao abrir, um recarregamento a meio da sessão — ou
 * um segundo portátil no mesmo endereço — apagava o que já lá estava, com a sala toda a ver. O
 * reinício é deliberado: a página só o chama quando o endereço traz `?reiniciar`.
 *
 * Obedece ao interruptor pela mesma razão que a leitura: fechada a entrada, não há sessão para
 * reiniciar.
 */
export async function rotaReiniciarMural(env: Env): Promise<Response> {
	if (!entradaAberta(env)) return Response.json({ ok: false, erro: 'entrada_fechada' }, { status: 404 });

	await env.DB.prepare('DELETE FROM presencas_demo').run();
	return Response.json({ ok: true });
}
