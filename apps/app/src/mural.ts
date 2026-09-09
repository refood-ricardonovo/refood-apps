/**
 * `GET /api/mural` — quem já entrou, agrupado por núcleo, para projectar numa sala.
 *
 * **O D1 nunca guarda nomes.** A tabela tem dois inteiros e uma data; os nomes são lidos ao Odoo a
 * cada pedido, por `id`, e existem só o tempo de montar a resposta. É a mesma fronteira que o resto
 * do projecto tem entre o D1 e o Odoo: o que é ficha lê-se da ficha.
 *
 * **Só o primeiro nome.** Isto é um projector numa sala com gente que não é dali — mais exposto do
 * que o telemóvel de quem escreveu o seu próprio NIF, e por isso mostra menos do que ele.
 *
 * **Obedece ao mesmo interruptor da entrada.** Fechado, devolve vazio: sem isso o mural continuava a
 * servir a lista de quem lá esteve depois de a apresentação acabar, num URL público e sem
 * autenticação nenhuma.
 */

import { many2oneId } from '@refood/odoo';
import { primeiroNome } from './nomes';
import { LINGUA, ligarAoOdoo } from './odoo';

const ABERTA = 'aberta';

/** Tecto da leitura. Uma sala não tem mais gente do que isto, e uma listagem leva sempre limite. */
const LIMITE_PRESENCAS = 500;

type FichaOdoo = { id: number; full_name: string | false; name?: string | false; company_id: [number, string] | false };
type Presenca = { employee_id: number; company_id: number };

export interface NucleoDoMural {
	readonly nucleo: string;
	readonly nomes: readonly string[];
}

export interface Mural {
	readonly nucleos: readonly NucleoDoMural[];
	readonly total: number;
}

const VAZIO: Mural = { nucleos: [], total: 0 };

export async function rotaMural(env: Env): Promise<Response> {
	if (env.ENTRADA_ABERTA !== ABERTA) return Response.json({ ok: true, mural: VAZIO });

	const { results } = await env.DB.prepare('SELECT employee_id, company_id FROM presencas_demo ORDER BY criado_em ASC LIMIT ?')
		.bind(LIMITE_PRESENCAS)
		.all<Presenca>();

	if (results.length === 0) return Response.json({ ok: true, mural: VAZIO });

	const { cliente, empresas, nucleos } = await ligarAoOdoo(env);

	/*
	 * `read` e não `search_read`: os ids são nossos, saíram da pesquisa que os gravou, e o que falta
	 * é o nome de cada um. O `allowed_company_ids` vai na mesma — é o que a regra espera, e o que
	 * protege de uma mudança do lado do Odoo.
	 */
	const fichas = await cliente.read<FichaOdoo>(
		'hr.employee',
		results.map((p) => p.employee_id),
		['full_name', 'name', 'company_id'],
		{ lang: LINGUA, context: { allowed_company_ids: [...empresas] } },
	);

	/*
	 * **Agrupa-se pelo `company_id` que a ficha tem agora**, e não pela cópia no D1.
	 *
	 * A cópia está lá para o índice e para o filtro por núcleo; a verdade sobre a ficha está no
	 * Odoo. Divergirem exige que alguém mude uma pessoa de núcleo a meio da apresentação — não vai
	 * acontecer, e se acontecer o ecrã mostra o núcleo certo.
	 */
	const porNucleo = new Map<number, string[]>();
	for (const ficha of fichas) {
		const empresa = many2oneId(ficha.company_id);
		const nome = primeiroNome(ficha.full_name, ficha.name);
		if (empresa === null || nome === null) continue;

		const lista = porNucleo.get(empresa);
		if (lista) lista.push(nome);
		else porNucleo.set(empresa, [nome]);
	}

	/*
	 * **Só os núcleos que já têm alguém** — a lista da esquerda cresce à medida que a sala entra, e
	 * um núcleo vazio no ecrã só diz que ninguém de lá apareceu.
	 *
	 * Ordenado pelo nome do núcleo, e os nomes por ordem alfabética dentro de cada um: é a única
	 * ordem que não muda de posição entre sondas de cinco segundos.
	 */
	const lista: NucleoDoMural[] = [...porNucleo]
		.map(([empresa, nomes]) => ({
			nucleo: nucleos.get(empresa) ?? `Núcleo ${empresa}`,
			nomes: nomes.sort((a, b) => a.localeCompare(b, 'pt')),
		}))
		.sort((a, b) => a.nucleo.localeCompare(b.nucleo, 'pt'));

	return Response.json({
		ok: true,
		mural: { nucleos: lista, total: lista.reduce((s, n) => s + n.nomes.length, 0) },
	});
}

/**
 * `POST /api/mural/reiniciar` — esvazia a tabela.
 *
 * **O `/mural` simples nunca limpa.** Se limpasse ao abrir, um recarregamento a meio da sessão — ou
 * um segundo portátil a abrir o mesmo endereço — apagava o que já lá estava, com a sala toda a ver.
 * O reinício é deliberado: a página só o chama quando o endereço traz `?reiniciar`.
 *
 * Obedece ao interruptor pela mesma razão que a leitura: fechada a entrada, não há sessão para
 * reiniciar.
 */
export async function rotaReiniciarMural(env: Env): Promise<Response> {
	if (env.ENTRADA_ABERTA !== ABERTA) return Response.json({ ok: false, erro: 'entrada_fechada' }, { status: 404 });

	await env.DB.prepare('DELETE FROM presencas_demo').run();
	return Response.json({ ok: true });
}
