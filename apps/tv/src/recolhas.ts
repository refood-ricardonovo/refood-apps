/**
 * O painel de recolhas às fontes de alimento — o segundo conteúdo da TV.
 *
 * Gémeo do `entregas.ts` na forma: mesma grelha estável ordenada por número, mesma densidade
 * adaptativa, mesmo filtro de dia. O que muda é o que a operação precisa de ver, e as diferenças
 * não são de detalhe.
 *
 * ## O que muda em relação às entregas
 *
 * - **Há faltas, e havia-as antes de alguém dar por isso.** Este ficheiro dizia "não há faltas —
 *   dois estados", e a base contradiz isso desde **2024-10-31**: são 25 encomendas de recolha com
 *   uma linha de falta, em 4 núcleos e 33 fontes, que o painel mostrava com o visto verde. A causa
 *   é estrutural — o `limit_categories` é `false` nas 166 caixas, portanto os produtos de falta
 *   sempre estiveram ao alcance de quem opera a caixa de Recolhas. **Passam a ler-se as
 *   `pos.order.line`**, e é isso que custa a ida ao Odoo a mais por refresh: são as faltas que a
 *   compram, não os quilos.
 * - **A terceira observação é positiva.** O "sem excedente" quer dizer que a recolha foi feita e a
 *   fonte não tinha nada — 47 encomendas na base, mais do dobro das faltas. Fica **✓ tratado**, e
 *   como não traz quilos cai na mesma apresentação de uma recolha sem peso registado.
 * - **A hora é o `hour`, não o `start_hour`.** A rota de recolha tem três horas: `start_hour` e
 *   `end_hour` são o intervalo em que a recolha pode ser feita, e o `hour` é a hora recomendada lá
 *   dentro. É a recomendada que se mostra.
 * - **O nome aparece, e não é legenda do número.** Nas fontes os números são baixos e há quem
 *   conheça a fonte só pelo nome — os dois são o identificador, na mesma linha e do mesmo tamanho.
 * - **As notas da rota não aparecem.** O `related_notes` existe, é texto livre escrito por quem
 *   gere as fontes, e um televisor por onde qualquer um passa não é sítio para ele. Não sendo
 *   mostrado, também não se lê: fora dos `fields`, não sai do Odoo.
 * - **Um extra é sempre a uma fonte de alimento.** Nas entregas há duas espécies do outro lado —
 *   beneficiários e parceiros de apoio —, e aqui há uma só: os 116 parceiros que aparecem nas
 *   encomendas de Recolhas têm todos `food_source_id`, sem excepção. Uma fonte nunca recebe
 *   alimentos, e um parceiro de apoio nunca os dá.
 *
 * ## De onde vem cada coisa, e a assimetria que engana
 *
 * Quase tudo sai da rota, que traz uma cópia da ficha — o `source_food_name`. **A
 * `res.food.source` é lida para três: o `number`, que a rota não traz, o `partner_id`, que é por
 * onde o POS chama a fonte, e o `name`, que é o que um cartão de extra tem para mostrar por não
 * ter rota nenhuma de onde copiar.** É a diferença em relação às entregas, onde a rota traz o
 * `related_beneficiary_number`.
 *
 * E a etiqueta do `source_food_id` **é o nome, não o código** — ao contrário do `partner_id` das
 * encomendas, onde é o código. Quem assumir simetria engana-se, e o engano é do género que passa
 * despercebido porque o valor parece plausível.
 *
 * A leitura da ficha é por `id`, a partir das rotas, e por `partner_id`, a partir das encomendas.
 * Os 125 contactos do modelo não têm rotas nenhumas nem aparecem no POS — mas como o segundo
 * caminho já não passa pelas rotas, o cartão de um extra exige `number`, que é o critério que os
 * separa das fontes a sério nos dois sentidos.
 */

import { many2oneId } from '@refood/odoo';
import {
	diaDaSemanaOdoo,
	diaRefood,
	diaValido,
	DIAS_PARA_A_FRENTE,
	diferencaEmDias,
	horaDecimal,
	janelaDoDia,
	nomeDoDiaDaSemana,
	relacaoComHoje,
} from './dia';
import { horaDoTurno } from './entregas';
import {
	lerEncomendasComFalta,
	lerIdsTratados,
	resumoPorParceiro,
	TECTO_RECOLHAS_KG,
	totalDoPainel,
	turnoDoExtra,
	type EncomendaComParceiro,
	type PesoDoCartao,
} from './pos';
import type { ContextoTv, LeitorDoNucleo, RotaTv, TurnoDoDia } from './sessao';

/** O `pos_type` das caixas de Recolhas. A única coisa na base que as separa das Entregas. */
const CAIXA_DE_RECOLHAS = 'collections';

/**
 * Prazos de cache. Os mesmos critérios das entregas: catálogo guarda-se, o que está a acontecer não.
 *
 * A ficha da fonte tem prazo mais longo do que tudo o resto porque **nada nela muda**: o código, o
 * nome e o espelho são o que a ficha é. Guardá-la quinze minutos é o que faz a leitura extra à
 * `res.food.source` — a que as entregas não precisam de fazer — custar quase nada por refresh.
 */
const CACHE_ROTAS_S = 300;
const CACHE_TURNOS_S = 900;
const CACHE_FICHAS_S = 900;

/** Tectos das leituras. O maior turno da base tem 29 fontes. */
const LIMITE_ROTAS = 300;
const LIMITE_TURNOS = 50;
/** As fichas lêem-se para o dia inteiro, e não para o turno — é o que permite reconhecer um extra. */
const LIMITE_FONTES = 400;
const LIMITE_ENCOMENDAS = 400;

/**
 * Os estados de uma fonte no ecrã.
 *
 * **`recolhido` cobre duas coisas de propósito:** a recolha com peso e o "sem excedente". Para quem
 * olha para o ecrã são a mesma resposta — *aquela fonte está tratada, não é preciso ir lá* —, e o
 * que as separa (ter trazido comida ou não) já se lê no número ao lado, que num caso existe e no
 * outro não.
 *
 * **`extra` não é um destes**, pela mesma razão que nas entregas: um extra está sempre `recolhido`
 * ou `falta`, nunca `por_recolher`. Ver `CartaoEntrega.extra`.
 */
export type EstadoRecolha = 'por_recolher' | 'recolhido' | 'falta';

export interface CartaoRecolha {
	/**
	 * O id da rota. Chave estável na grelha; não tem significado para quem olha.
	 *
	 * **Num extra é o simétrico do parceiro** — não há rota, e um negativo nunca colide com um id de
	 * rota. Ver `CartaoEntrega.rota`.
	 */
	readonly rota: number;
	/** `F17`, do `PTVNF_FA000017`. `null` quando a ficha não tem número. */
	readonly etiqueta: string | null;
	/** Só para ordenar. `null` ordena para o fim. */
	readonly ordem: number | null;
	readonly nome: string | null;
	/**
	 * A hora recomendada da recolha. **`null` nos extras**: não estavam na escala do dia, portanto
	 * não há hora recomendada nenhuma. Quem os marca no ecrã é a barra ponteada da esquerda.
	 */
	readonly hora: string | null;
	readonly estado: EstadoRecolha;
	/** Se este cartão não estava na escala do dia. Ver a secção dos extras em `entregas.ts`. */
	readonly extra: boolean;
	/** O peso recolhido, formatado. `null` quando não há número a mostrar — ver `CartaoEntrega.peso`. */
	readonly peso: string | null;
}

export interface PainelRecolhas {
	readonly dia: string;
	readonly hoje: string;
	readonly nomeDoDia: string;
	readonly relacao: string;
	readonly podeRecuar: boolean;
	readonly podeAvancar: boolean;
	readonly turnos: readonly TurnoDoDia[];
	readonly turno: TurnoDoDia | null;
	/** As previstas primeiro, pela hora; os extras a seguir, pela hora a que aconteceram. */
	readonly cartoes: readonly CartaoRecolha[];
	/** A soma exacta dos pesos que os cartões mostram, extras incluídos. Ver `PainelEntregas.pesoTotal`. */
	readonly pesoTotal: string | null;
	/** Quantos cartões ficaram fora do tecto de plausibilidade. Ver `PainelEntregas.foraDeEscala`. */
	readonly foraDeEscala: number;
	/** Quantas encomendas do dia não se conseguiu atribuir a ninguém. Ver `PainelEntregas.porIdentificar`. */
	readonly porIdentificar: number;
}

/* ------------------------------------------------------------ o que se lê */

type RotaOdoo = {
	id: number;
	resource_calendar_id: [number, string] | false;
	source_food_id: [number, string] | false;
	source_food_name: string | false;
	hour: number | false;
	start_hour: number | false;
};

type CalendarioOdoo = { id: number; name: string; shift_name: string | false };
type FonteOdoo = { id: number; number: string | false; name: string | false; active: boolean; partner_id: [number, string] | false };
type EncomendaOdoo = EncomendaComParceiro;

/** O que se sabe de uma fonte para lá da rota: o código, o nome, o espelho e se está arquivada. */
type Fonte = {
	readonly numero: string | null;
	readonly nome: string | null;
	readonly activa: boolean;
	readonly parceiro: number | null;
};

/* ------------------------------------------------------------- conversões */

/**
 * `PTVNF_FA000017` → `F17`.
 *
 * Mesma forma do `B` das entregas: prefixo do núcleo, `_FA`, e o contador com zeros à cabeça que
 * ninguém diz em voz alta.
 */
export function etiquetaDaFonte(valor: unknown): string | null {
	if (typeof valor !== 'string') return null;

	const encontrado = /_FA(\d+)\s*$/.exec(valor.trim());
	return encontrado ? `F${Number(encontrado[1])}` : null;
}

/** O número por trás da etiqueta, para ordenar. `null` vai para o fim da grelha. */
export function ordemDaFonte(valor: unknown): number | null {
	if (typeof valor !== 'string') return null;

	const encontrado = /_FA(\d+)\s*$/.exec(valor.trim());
	return encontrado ? Number(encontrado[1]) : null;
}

/**
 * A hora recomendada da recolha, ou `null` quando o horário está por preencher.
 *
 * **Zero é uma hora legítima**: pode haver recolhas à meia-noite, e escondê-las seria esconder
 * trabalho. Mas há rotas em que o `hour` **e** o `start_hour` estão os dois a zero, e essas são
 * horário por preencher — uma recolha genuína à meia-noite teria um intervalo à volta dela, não um
 * intervalo de vinte e uma horas.
 *
 * Medido em setembro de 2026: são 19 rotas em 801, **todas do mesmo núcleo**, com intervalos como
 * `00:00–20:50`. O `end_hour` nunca está a zero em toda a base, portanto não distingue nada e não
 * entra no critério.
 *
 * **O que isto aceita:** uma recolha genuína à meia-noite com janela `00:00–01:00` seria mostrada
 * como "sem hora". Não há forma de a distinguir — zero é também o valor por omissão de um float por
 * preencher. Ver `docs/modelos/fontes-alimento.md`.
 */
export function horaRecomendada(hora: unknown, inicio: unknown): string | null {
	const semHora = !(typeof hora === 'number' && hora > 0);
	const semInicio = !(typeof inicio === 'number' && inicio > 0);
	if (semHora && semInicio) return null;

	return horaDecimal(typeof hora === 'number' ? hora : 0);
}

/** Um texto da ficha, limpo. `null` quando não há nada de útil lá dentro. */
export function texto(valor: unknown): string | null {
	if (typeof valor !== 'string') return null;

	const limpo = valor.trim();
	return limpo.length > 0 ? limpo : null;
}

/* ------------------------------------------------------------- a montagem */

/** O que o POS diz de uma fonte num dia: o estado, e os quilos. */
export interface ResumoDaFonte {
	readonly estado: EstadoRecolha;
	readonly peso: PesoDoCartao;
}

/** Um extra já montado, à espera de saber se é do turno que está no ecrã. Ver `entregas.ts`. */
interface ExtraDoDia {
	readonly turno: number | null;
	readonly quando: string;
	readonly peso: PesoDoCartao;
	readonly cartao: CartaoRecolha;
}

/** Tudo o que o POS e as fichas dizem sobre um dia. */
interface EstadoDoDia {
	/** O estado de cada fonte **prevista**, pelo id do parceiro — que é por onde o POS lhe chama. */
	readonly porParceiro: ReadonlyMap<number, ResumoDaFonte>;
	readonly extras: readonly ExtraDoDia[];
	readonly porIdentificar: number;
	/** As fichas das fontes com rota no dia, pelo id da ficha. */
	readonly fontes: ReadonlyMap<number, Fonte>;
}

const DIA_VAZIO: EstadoDoDia = { porParceiro: new Map(), extras: [], porIdentificar: 0, fontes: new Map() };

/**
 * As fichas das fontes: as que têm rota no dia, e as que aparecem no POS.
 *
 * **É a única leitura à `res.food.source`, e é o âncora do âmbito.** A rota não traz o número — a de
 * entrega traz o do beneficiário, esta não —, e a etiqueta do `source_food_id` é o nome.
 *
 * O `partner_id` vem daqui e **não do lado do `res.partner`**, e a diferença é a correcção de um
 * bug: na `res.food.source` o `company_id` é obrigatório e o âmbito por núcleo assenta nele; no
 * `res.partner` é opcional — a própria `ir.rule` do Odoo deixa passar o vazio
 * (`['|', ('company_id','=',False), ('company_id','in',company_ids)]`) — e a nossa cláusula, mais
 * apertada do que a da base, cortava espelhos legítimos. São 99 espelhos de fontes em 1 028 com o
 * campo vazio, e num núcleo eram 47 em 68. Ver `docs/modelos/fontes-alimento.md`.
 *
 * **Uma leitura, duas perguntas — daí o `|`.** Pelo `id` respondem as fontes com rota no dia; pelo
 * `partner_id`, as que aparecem no POS sem terem rota — os extras. Ver a nota gémea em
 * `entregas.ts`.
 *
 * Cache longa porque nada na ficha muda.
 *
 * **`active in [true, false]`, e não é para mostrar fontes arquivadas.** As previstas já as filtra a
 * cláusula `source_food_id.active` no domínio das rotas, e o que isto cobre é a **janela entre as
 * duas caches** — rotas 5 minutos, fichas 15 —, em que a lista de rotas em cache ainda traz uma
 * fonte arquivada há minutos. Sem a cláusula, o cartão aparecia nesse intervalo com `—` no lugar do
 * número e o nome vindo da rota, que é **exactamente o sintoma que denunciou o problema**: cartões
 * sem número num televisor de Almada. Do lado dos extras o `active` é lido e respeitado — um
 * televisor nunca mostra um registo arquivado.
 */
async function lerFontes(
	leitor: LeitorDoNucleo,
	fontesDoDia: readonly number[],
	parceirosDoPos: readonly number[],
): Promise<Map<number, Fonte>> {
	if (fontesDoDia.length === 0 && parceirosDoPos.length === 0) return new Map();

	const fontes = await leitor.searchRead<FonteOdoo>(
		'res.food.source',
		['|', ['id', 'in', [...fontesDoDia]], ['partner_id', 'in', [...parceirosDoPos]], ['active', 'in', [true, false]]],
		{
			fields: ['number', 'name', 'active', 'partner_id'],
			limit: LIMITE_FONTES,
			cache: CACHE_FICHAS_S,
		},
	);

	const porId = new Map<number, Fonte>();
	for (const fonte of fontes) {
		porId.set(fonte.id, {
			numero: typeof fonte.number === 'string' ? fonte.number : null,
			nome: texto(fonte.name),
			activa: fonte.active !== false,
			parceiro: many2oneId(fonte.partner_id),
		});
	}

	return porId;
}

/** O cartão de um extra: tudo vem da ficha, porque não há rota. Sem hora — não estava na escala. */
function cartaoDeFonteExtra(parceiro: number, fonte: Fonte, resumo: ResumoDaFonte): CartaoRecolha {
	return {
		rota: -parceiro,
		etiqueta: etiquetaDaFonte(fonte.numero),
		ordem: ordemDaFonte(fonte.numero),
		nome: fonte.nome,
		hora: null,
		estado: resumo.estado,
		extra: true,
		peso: resumo.peso.estado === 'com_peso' ? resumo.peso.texto : null,
	};
}

/**
 * O que aconteceu no dia inteiro: o estado das fontes previstas, e os extras.
 *
 * **A comparação que decide o que é extra é contra as rotas do dia todo, e não do turno visível** —
 * a mesma regra das entregas, e pela mesma razão: uma fonte recolhida no turno da manhã aparecia
 * como cartão verde nesse turno e como extra no da tarde, com os mesmos quilos em dois cabeçalhos.
 *
 * ## Já não basta existir uma encomenda
 *
 * Era essa a regra, e estava errada: uma encomenda pode trazer uma **falta**. As linhas de
 * observação lêem-se, e a classificação é a mesma das entregas — só o "sem excedente" conta como
 * tratado, tudo o mais na categoria é falta. Ver `pos.ts`.
 *
 * **Com mais do que uma encomenda no mesmo dia, decide a última.** Antes a pergunta não existia —
 * bastava haver uma —, e agora existe: uma fonte pode ter uma falta e, mais tarde, uma recolha a
 * sério. Os estornos ficam fora do estado e dentro da soma. Tudo isso está no `resumoPorParceiro`.
 */
async function lerEstadoDoDia(
	leitor: LeitorDoNucleo,
	dia: string,
	fontesDoDia: readonly number[],
	turnos: readonly TurnoDoDia[],
): Promise<EstadoDoDia> {
	const { inicio, fim } = janelaDoDia(dia);
	const comoOdoo = (data: Date) => data.toISOString().slice(0, 19).replace('T', ' ');

	const [encomendas, tratados] = await Promise.all([
		leitor.searchRead<EncomendaOdoo>(
			'pos.order',
			[
				['session_id.config_id.pos_type', '=', CAIXA_DE_RECOLHAS],
				['date_order', '>=', comoOdoo(inicio)],
				['date_order', '<', comoOdoo(fim)],
			],
			{ fields: ['partner_id', 'date_order', 'name', 'total_in_kg'], limit: LIMITE_ENCOMENDAS },
		),
		lerIdsTratados(leitor),
	]);

	const parceirosDoPos = [
		...new Set(encomendas.map((encomenda) => many2oneId(encomenda.partner_id)).filter((id): id is number => id !== null)),
	];

	// As fichas e as linhas não dependem umas das outras — as duas só precisam das encomendas.
	const [fontes, comFalta] = await Promise.all([
		lerFontes(leitor, fontesDoDia, parceirosDoPos),
		encomendas.length === 0
			? Promise.resolve(new Set<number>() as ReadonlySet<number>)
			: lerEncomendasComFalta(
					leitor,
					encomendas.map((encomenda) => encomenda.id),
					tratados,
				),
	]);

	const resumos = resumoPorParceiro(encomendas, comFalta, TECTO_RECOLHAS_KG);

	const fonteDoParceiro = new Map<number, Fonte>();
	for (const fonte of fontes.values()) {
		if (fonte.parceiro !== null) fonteDoParceiro.set(fonte.parceiro, fonte);
	}

	// Os parceiros que **estavam na escala do dia**. Tudo o resto que apareça no POS é extra.
	const planeados = new Set<number>();
	for (const id of fontesDoDia) {
		const parceiro = fontes.get(id)?.parceiro;
		if (parceiro !== undefined && parceiro !== null) planeados.add(parceiro);
	}

	const porParceiro = new Map<number, ResumoDaFonte>();
	const extras: ExtraDoDia[] = [];
	let porIdentificar = 0;

	for (const [parceiro, resumo] of resumos) {
		const estado: ResumoDaFonte = { estado: resumo.falta ? 'falta' : 'recolhido', peso: resumo.peso };

		if (planeados.has(parceiro)) {
			porParceiro.set(parceiro, estado);
			continue;
		}

		const fonte = fonteDoParceiro.get(parceiro);

		/*
		 * **Um extra exige ficha activa e com número.**
		 *
		 * O `active` porque um televisor nunca mostra um registo arquivado; o `number` porque é o que
		 * separa uma fonte de um **contacto** da fonte, e nada no modelo os marca de outra maneira —
		 * são 125 contactos em 999, todos sem número e todos com `contact_parent_id`. Pelos dados
		 * nenhum contacto aparece no POS, mas este caminho já não passa pelas rotas, que era o que o
		 * garantia antes.
		 */
		if (fonte !== undefined && fonte.activa && fonte.numero !== null) {
			extras.push({
				turno: turnoDoExtra(resumo.quando, turnos),
				quando: resumo.quando,
				peso: resumo.peso,
				cartao: cartaoDeFonteExtra(parceiro, fonte, estado),
			});
			continue;
		}

		porIdentificar++;
	}

	return { porParceiro, extras, porIdentificar, fontes };
}

/** O painel completo de um dia e de um turno. */
export async function montarPainel(contexto: ContextoTv, agora: Date): Promise<PainelRecolhas> {
	const { leitor, vista } = contexto;
	const hoje = diaRefood(agora);

	const pedido = vista.dia !== null && diaValido(vista.dia) ? vista.dia : hoje;
	const distancia = diferencaEmDias(hoje, pedido);
	const dia = distancia < 0 || distancia > DIAS_PARA_A_FRENTE ? hoje : pedido;

	const rotas = await leitor.searchRead<RotaOdoo>(
		'res.collection.route',
		[
			['week_day', '=', diaDaSemanaOdoo(dia)],
			// Mesma regra das entregas: uma rota só conta a partir do dia em que começou, e a
			// comparação é com o dia que se está a ver. Sem `is_route_ongoing`, que está obsoleto
			// nos dois modelos — ver `docs/modelos/fontes-alimento.md`.
			['start_date', '<=', `${dia} 23:59:59`],
			/*
			 * **A ficha arquivada não faz cartão.** Uma rota continua a apontar para a ficha depois de
			 * ela ser arquivada: hoje, arquivar apaga as rotas, mas antes era um processo manual e
			 * ficaram rotas penduradas em fichas que já não são da operação. Medido em staging:
			 * ****28 rotas de 801 — 3,5%** apontam para fontes arquivadas**, e num único turno chegam a ser **4, em Almada**.
			 *
			 * Informação histórica não é para aparecer aqui — o televisor mostra o trabalho de hoje.
			 *
			 * **O filtro é na rota e não na ficha**, para o cartão nunca nascer: filtrar depois deixava
			 * o cartão no ecrã sem a ficha por trás, que é exactamente o sintoma que se viu — um cartão
			 * com nome e sem número, porque o nome vem da rota e o número da ficha.
			 *
			 * As `res.collection.route` e `res.delivery.route` **não têm `active`** — não são
			 * arquiváveis, são apagadas —, portanto a única cláusula possível é a travessia. Verificada
			 * contra a base: as contagens fecham exactamente (801 = 773 + 28).
			 */
			['source_food_id.active', '=', true],
		],
		{
			fields: ['resource_calendar_id', 'source_food_id', 'source_food_name', 'hour', 'start_hour'],
			limit: LIMITE_ROTAS,
			cache: CACHE_ROTAS_S,
		},
	);

	const idsDeTurno = [...new Set(rotas.map((rota) => many2oneId(rota.resource_calendar_id)).filter((id): id is number => id !== null))];

	const calendarios =
		idsDeTurno.length === 0
			? []
			: await leitor.searchRead<CalendarioOdoo>(
					'resource.calendar',
					[
						['id', 'in', idsDeTurno],
						['active', 'in', [true, false]],
					],
					{ fields: ['name', 'shift_name'], limit: LIMITE_TURNOS, cache: CACHE_TURNOS_S },
				);

	const turnos: TurnoDoDia[] = calendarios
		// O `name` e não o `shift_name`: ver a nota em `entregas.ts`. Há núcleos com seis turnos de
		// recolha no mesmo dia e dois deles à mesma hora. A ordem por hora é contrato do
		// `turnoDoExtra`.
		.map((calendario) => ({ id: calendario.id, nome: calendario.name, hora: horaDoTurno(calendario) }))
		.sort((a, b) => (a.hora ?? '99:99').localeCompare(b.hora ?? '99:99') || a.nome.localeCompare(b.nome, 'pt'));

	const turno = turnos.find((candidato) => candidato.id === vista.turno) ?? turnos[0] ?? null;
	const doTurno = turno === null ? [] : rotas.filter((rota) => many2oneId(rota.resource_calendar_id) === turno.id);

	// **Do dia inteiro, e não do turno.** É contra esta lista que se decide o que é extra.
	const fontesDoDia = [...new Set(rotas.map((rota) => many2oneId(rota.source_food_id)).filter((id): id is number => id !== null))];
	const estado = turno === null ? DIA_VAZIO : await lerEstadoDoDia(leitor, dia, fontesDoDia, turnos);

	// À parte da grelha, porque o total é a soma destes e a grelha vai ser ordenada a seguir.
	const pesos: PesoDoCartao[] = [];

	const previstos: CartaoRecolha[] = doTurno
		.map((rota) => {
			const id = many2oneId(rota.source_food_id);
			const fonte = id === null ? undefined : estado.fontes.get(id);
			const resumo = fonte?.parceiro == null ? undefined : estado.porParceiro.get(fonte.parceiro);
			const peso = resumo?.peso ?? { estado: 'sem_peso' as const };
			pesos.push(peso);

			return {
				rota: rota.id,
				etiqueta: etiquetaDaFonte(fonte?.numero),
				ordem: ordemDaFonte(fonte?.numero),
				// O nome vem da rota e não da ficha: é o `source_food_name`, cópia que a rota traz, e
				// evita que um cartão previsto dependa de a ficha ter vindo na mesma leitura.
				nome: texto(rota.source_food_name),
				hora: horaRecomendada(rota.hour, rota.start_hour),
				estado: resumo?.estado ?? ('por_recolher' as const),
				extra: false,
				peso: peso.estado === 'com_peso' ? peso.texto : null,
			};
		})
		/*
		 * **Ordenada pela hora, e o número desempata.**
		 *
		 * Aqui a hora é a ordem do trabalho: as recolhas fazem-se em sequência ao longo do turno, e
		 * uma grelha por hora diz por onde começar sem ninguém ter de a reconstruir de cabeça. Nas
		 * entregas não é assim — as famílias chegam por sua conta e o que se procura é um número.
		 *
		 * **Continua a ser estável**: a hora de uma rota não muda durante o turno, portanto um cartão
		 * não salta de lugar. E o empate é resolvido pelo número, que é único — sem isso, duas fontes
		 * à mesma hora podiam trocar de posição entre refreshes, que é o que a grelha estável existe
		 * para não fazer.
		 *
		 * Ordena-se aqui e não no Odoo porque a grelha já tem de ser ordenada do lado do Worker: o
		 * número não está na rota e o `source_food_name` é calculado e não armazenado.
		 */
		.sort((a, b) => {
			const hora = (c: CartaoRecolha) => c.hora ?? '99:99';
			if (hora(a) !== hora(b)) return hora(a).localeCompare(hora(b));
			if (a.ordem === null && b.ordem === null) return a.rota - b.rota;
			if (a.ordem === null) return 1;
			if (b.ordem === null) return -1;
			return a.ordem - b.ordem;
		});

	/*
	 * **Os extras vão para o fim, e pela ordem em que aconteceram.**
	 *
	 * Aqui a grelha já é ordenada pela hora, e podia parecer que um extra tinha lugar próprio nessa
	 * sequência. Não tem: a hora dos cartões previstos é a hora **recomendada** da recolha, e a de um
	 * extra é a hora a que foi registado. São duas grandezas diferentes com o mesmo aspecto, e
	 * misturá-las dava uma sequência que não é a de nada.
	 */
	const extras: CartaoRecolha[] = estado.extras
		.filter((extra) => turno !== null && extra.turno === turno.id)
		.sort((a, b) => a.quando.localeCompare(b.quando) || a.cartao.rota - b.cartao.rota)
		.map((extra) => {
			pesos.push(extra.peso);
			return extra.cartao;
		});

	return {
		dia,
		hoje,
		nomeDoDia: nomeDoDiaDaSemana(dia),
		relacao: relacaoComHoje(dia, hoje),
		podeRecuar: diferencaEmDias(hoje, dia) > 0,
		podeAvancar: diferencaEmDias(hoje, dia) < DIAS_PARA_A_FRENTE,
		turnos,
		turno,
		cartoes: [...previstos, ...extras],
		...totalDoPainel(pesos),
		porIdentificar: estado.porIdentificar,
	};
}

/**
 * `GET /api/recolhas` — a grelha de um dia e de um turno.
 *
 * **Nada de texto livre vai daqui para o televisor.** O `related_notes` da rota diria como fazer a
 * recolha, mas é escrito à mão e num ecrã por onde qualquer um passa não há decisão escrita que o
 * cubra — quem precisa da nota lê-a no Odoo. Por isso o campo nem sequer entra nos `fields` da
 * leitura das rotas: o que não sai da base não chega ao ecrã por descuido.
 *
 * O que vai é identificação da fonte, hora e estado. O nome vai por `textContent` e nunca por
 * `innerHTML`.
 */
export const rotaRecolhas: RotaTv = async (contexto) => {
	const painel = await montarPainel(contexto, contexto.agora);
	return Response.json({ ok: true, painel });
};
