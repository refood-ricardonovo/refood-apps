/**
 * `GET /api/mural` — o que a sala vê projectado: os núcleos presentes, e quem acabou de entrar.
 *
 * ## Duas metades, com origens diferentes, e é isso que a torna barata
 *
 * **A ordem sai do D1, por SQL.** Um `GROUP BY company_id` com `MIN(criado_em)` dá a coluna da
 * esquerda inteira — que núcleos estão presentes, pela ordem em que o primeiro voluntário de cada
 * um chegou — e não passa pelo Odoo.
 *
 * **Não há contagens, e é decisão e não esquecimento.** Havia um total no topo e um número por
 * núcleo; saíram os dois a pedido, e saíram também da resposta e não só do ecrã — um endereço
 * público a publicar quantas pessoas de cada núcleo estão numa sala, que nada mostra, é dado a
 * mais sem ninguém a lê-lo. A coluna diz **quem está presente**, não quantos.
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

import { createOdooClient } from '@refood/odoo';
import { entradaAberta } from './interruptor';
import { nucleoDoMural, primeiroNome } from './nomes';
import { LINGUA, nomesDosNucleos } from './odoo';

/** Tectos das leituras. Há 87 núcleos na base, e uma sala não tem mais gente do que isto. */
const LIMITE_NUCLEOS = 200;
const LIMITE_NOVOS = 100;

type FichaOdoo = { id: number; full_name: string | false; name?: string | false };
type GrupoSql = { company_id: number; primeiro: string };
type ChegadaSql = { employee_id: number; criado_em: string };

export interface Mural {
	/** Os nomes dos núcleos presentes, por ordem de chegada do primeiro voluntário de cada um. */
	readonly nucleos: readonly string[];
	/** Os primeiros nomes de quem entrou desde a sonda anterior, por ordem de chegada. */
	readonly novos: readonly string[];
	/** O cursor da sonda seguinte. */
	readonly agora: string;
}

export async function rotaMural(request: Request, env: Env): Promise<Response> {
	// Fixa-se aqui, antes de qualquer query: é o limite superior da janela e o cursor devolvido.
	const agora = new Date().toISOString();

	if (!entradaAberta(env)) {
		return Response.json({ ok: true, mural: { nucleos: [], novos: [], agora } });
	}

	/*
	 * **A coluna sai daqui, e só daqui.** `MIN(criado_em)` é a ordem — por chegada do primeiro
	 * voluntário de cada núcleo, e não alfabética, porque é a ordem em que a sala se encheu.
	 */
	const grupos = await env.DB.prepare(
		'SELECT company_id, MIN(criado_em) AS primeiro FROM presencas_demo GROUP BY company_id ORDER BY primeiro ASC LIMIT ?',
	)
		.bind(LIMITE_NUCLEOS)
		.all<GrupoSql>();

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
		return Response.json({ ok: true, mural: { nucleos: [], novos: [], agora } });
	}

	const cliente = createOdooClient(env);

	/*
	 * **Os ids dos núcleos vêm do D1, não de uma pesquisa a `res.company`** — foram gravados a
	 * partir do `company_id` da ficha de quem entrou. O `res.company` só lhes põe o nome.
	 */
	const nucleos = await nomesDosNucleos(
		cliente,
		grupos.results.map((g) => g.company_id),
	);

	/*
	 * `read` e não `search_read`: os ids são nossos, saíram da pesquisa que os gravou, e o que falta
	 * é o nome de cada um. **Sem `allowed_company_ids`**, pela mesma razão que a rota de entrada não
	 * o leva: o tecto é o da conta, imposto pelo Odoo, e um contexto só podia estreitá-lo — aqui,
	 * até ao ponto de esconder o nome de quem já está na sala. Ver `odoo.ts`.
	 */
	const fichas =
		chegadas.results.length === 0
			? []
			: await cliente.read<FichaOdoo>(
					'hr.employee',
					chegadas.results.map((c) => c.employee_id),
					['full_name', 'name'],
					{ lang: LINGUA },
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

	/*
	 * O nome curto — sem o `PT` e sem a palavra `Núcleo`, que se repetiria em todas as linhas. O
	 * recurso é o id: uma linha sem nome não se lê, e um núcleo que está na sala tem de aparecer.
	 */
	const lista = grupos.results.map((g) => nucleoDoMural(nucleos.get(g.company_id)) ?? `Núcleo ${g.company_id}`);

	return Response.json({ ok: true, mural: { nucleos: lista, novos, agora: cursor } });
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
