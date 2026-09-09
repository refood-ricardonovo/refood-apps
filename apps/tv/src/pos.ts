/**
 * O POS visto pelos dois painéis: as observações e os quilos.
 *
 * Estava espalhado por `entregas.ts` e `recolhas.ts` porque cada painel lia o POS à sua maneira.
 * Deixou de poder ser: as observações passaram a valer nas duas caixas, os quilos também, e as
 * regras são as mesmas. O que muda entre painéis é o tecto e o significado do cartão, e isso fica
 * do lado de quem chama.
 *
 * ## As observações — três produtos, e um deles não é uma falta
 *
 * A categoria *Observações* tem três produtos, todos em unidades para não influenciarem os quilos:
 * duas faltas e um **"Sem excedente"**, que quer dizer o contrário — a recolha foi feita e a fonte
 * não tinha nada. Ver `docs/modelos/pos.md`.
 *
 * **A chave é a Referência Interna (`default_code`), nunca o id nem o nome.**
 *
 * - **O nome não serve porque é traduzido, e a tradução engana.** O produto que significa ✓ chama-se
 *   *Sem excedente* em `pt_PT` e **"Falta Justificada (cópia)"** em `en_US`. Uma regra por nome — ou
 *   por substring `/falta/i` — classificava-o como falta **em silêncio**, e o valor parecia
 *   plausível. Não é hipótese: é o que está na base.
 * - **O id não serve porque não é portável entre bases.** O 37 é o "Sem excedente" em staging; em
 *   produção pode ser outro número, e uma lista de ids por ambiente é uma configuração que alguém
 *   tem de preencher — e que, preenchida ao contrário, faz tudo virar falta sem dar sinal.
 *
 * ## Lê-se a categoria toda, e o desconhecido vale falta
 *
 * O domínio filtra pela **categoria** e não pelos produtos: assim uma falta nova criada amanhã
 * aparece sozinha, sem ninguém mexer em código. A classificação faz-se depois, no Worker: quem não
 * estiver no conjunto dos "tratados" é falta.
 *
 * **A direcção da falha é escolhida.** Um produto positivo novo aparece com ✕ até alguém lhe
 * acrescentar o código — errado, mas **visível**, e alguém pergunta. O contrário — enumerar as
 * faltas e assumir que o resto é tratado — esconderia faltas, e uma falta escondida num televisor é
 * o pior erro que estes painéis podem dar.
 */

import { many2oneId } from '@refood/odoo';
import { horaEmLisboa } from './dia';
import type { LeitorDoNucleo, TurnoDoDia } from './sessao';

/**
 * A categoria de POS das observações.
 *
 * **É a única string de negócio de que os painéis dependem.** O `pos.category` não tem `code` nem
 * boolean, só `name`, e um nome é editável no Odoo por quem lá mexer. Fica isolada aqui, com um
 * teste que a prende, para que o dia em que a sede lhe mudar o nome se veja num sítio só.
 *
 * Sobrevive à correcção do `lang` porque tem **o mesmo valor nas duas línguas** — verificado, 247
 * linhas em `pt_PT` e em `en_US`. É sorte, não desenho: a categoria seguinte é *Diversos* em
 * português e *Outros* em inglês.
 */
export const CATEGORIA_DE_OBSERVACOES = 'Observações';

/**
 * As Referências Internas que significam **tratado** — não falta.
 *
 * Uma lista, e não um valor, porque a operação pode vir a ter outra observação positiva ("fonte
 * fechada", "sem recolha combinada"). Acrescentar uma é acrescentar aqui um código, igual nas duas
 * bases, e não um id por ambiente.
 */
export const CODIGOS_TRATADO = ['OBS-SEM-EXC'] as const;

/** Marca de estorno no `name` da encomenda. Escrita pelo Odoo na língua activa no momento do estorno. */
export const MARCA_DE_ESTORNO = 'REEMBOLSAR';

/**
 * Prazo de cache do catálogo. Longo porque o catálogo **não muda**: 24 produtos, criados em 2023 e
 * 2025. Na prática é uma leitura na primeira volta de cada isolate e nenhuma depois.
 */
const CACHE_CATALOGO_S = 3600;

/** Tectos das leituras do POS. */
const LIMITE_CATALOGO = 50;
const LIMITE_LINHAS = 2000;

/**
 * O tecto de plausibilidade de um cartão, em quilos, **por painel**.
 *
 * Não é higiene, é confiança: um número obviamente falso num televisor estraga a leitura de todos
 * os outros. E não é um tecto de segurança — nada valida o peso do lado do Odoo, que aceita o que
 * lhe escreverem à mão.
 *
 * **Os números saem da base, não de uma intuição.** Nas entregas o p99 de um cartão é 113 kg e a
 * mediana 15 — 300 kg é vinte vezes a mediana e nenhum cabaz de família chega lá; descer a 200
 * apanha mais 24 cartões e **não melhora o cabeçalho**, cujo máximo fica em 1 136 kg de qualquer
 * maneira. Nas recolhas o p99 é 267 kg e há um intervalo limpo entre **1 105 kg**, o maior valor
 * plausível da base, e **64 508 kg**, o primeiro absurdo: 1 500 apanha os três absurdos e mais
 * nada. A regra é para o absurdo, não para o incomum — esconder uma recolha real custa mais
 * confiança do que mostrar uma suspeita, e um erro escondido é um erro que ninguém corrige.
 *
 * **Simétrico em `|kg|`, e isso não é detalhe.** Os estornos não abatem no mesmo cartão: o
 * `+71 150 kg` de 2025-08-12 é anulado por um `-71 150` de **2025-08-13**, e somar com sinal dá um
 * cartão de `-71 079` no dia seguinte. O tecto tem de apanhar as duas metades.
 */
export const TECTO_ENTREGAS_KG = 300;
export const TECTO_RECOLHAS_KG = 1500;

/**
 * Uma encomenda, no mínimo que os painéis precisam de saber dela para os quilos e o estado.
 *
 * `type` e não `interface`: o `searchRead` exige um `OdooRecord`, e uma interface não satisfaz um
 * `Record<string, unknown>` — o mesmo motivo que está escrito no `nucleo.ts`.
 */
export type EncomendaPos = {
	id: number;
	name: string | false;
	total_in_kg: number;
};

/* ------------------------------------------------------- as observações */

type ProdutoOdoo = { id: number; default_code: string | false };
type LinhaOdoo = { order_id: [number, string] | false; product_id: [number, string] | false };

/**
 * Os ids dos produtos que significam "tratado", resolvidos a partir da Referência Interna.
 *
 * **É a única leitura ao catálogo, e é a razão de `product.product` ter âmbito `nullable`**: o
 * catálogo de POS é global e a cláusula estrita devolve zero de 24. Ver `clausulaDeAmbito`.
 *
 * Um código que não exista na base **não é erro** — devolve um conjunto mais pequeno, e o efeito é
 * a observação correspondente passar a contar como falta: visível no ecrã, que é a direcção certa.
 */
export async function lerIdsTratados(leitor: LeitorDoNucleo): Promise<ReadonlySet<number>> {
	const produtos = await leitor.searchRead<ProdutoOdoo>('product.product', [['default_code', 'in', [...CODIGOS_TRATADO]]], {
		fields: ['default_code'],
		limit: LIMITE_CATALOGO,
		cache: CACHE_CATALOGO_S,
	});

	return new Set(produtos.map((produto) => produto.id));
}

/**
 * Que encomendas, das que lhe passam, têm uma **falta** registada.
 *
 * As linhas vão sempre presas às encomendas que já foram filtradas por núcleo: a `pos.order.line`
 * não tem regra de registo própria, e soltá-la contornava o filtro da encomenda.
 *
 * Uma encomenda com uma falta **e** um "sem excedente" conta como falta — a marca mais grave ganha,
 * pela mesma razão que uma observação se sobrepõe aos pesos. São 2 casos em staging.
 */
export async function lerEncomendasComFalta(
	leitor: LeitorDoNucleo,
	encomendas: readonly number[],
	tratados: ReadonlySet<number>,
): Promise<ReadonlySet<number>> {
	if (encomendas.length === 0) return new Set();

	const linhas = await leitor.searchRead<LinhaOdoo>(
		'pos.order.line',
		[
			['order_id', 'in', [...encomendas]],
			['product_id.pos_categ_id.name', '=', CATEGORIA_DE_OBSERVACOES],
		],
		{ fields: ['order_id', 'product_id'], limit: LIMITE_LINHAS },
	);

	const comFalta = new Set<number>();
	for (const linha of linhas) {
		const encomenda = many2oneId(linha.order_id);
		if (encomenda === null) continue;

		/*
		 * O `product_id` é obrigatório na linha, mas lê-se com uma guarda em vez do `many2oneId`: um
		 * campo ausente ou malformado tem de cair em **falta**, que é a direcção segura, e não
		 * derrubar o painel inteiro com um erro. Numa cozinha, um ecrã em branco é pior do que um ✕
		 * a mais.
		 */
		const produto = Array.isArray(linha.product_id) ? linha.product_id[0] : null;
		// Desconhecido vale falta: ver o cabeçalho deste ficheiro.
		if (produto === null || !tratados.has(produto)) comFalta.add(encomenda);
	}

	return comFalta;
}

/** Um estorno anula um registo. Não é acontecimento — mas é quantidade, e abate na soma. */
export function ehEstorno(encomenda: Pick<EncomendaPos, 'name'>): boolean {
	return typeof encomenda.name === 'string' && encomenda.name.includes(MARCA_DE_ESTORNO);
}

/* ------------------------------------------------------------- os quilos */

/** O peso de um cartão: o número já arredondado como vai ao ecrã, ou a razão para não ter número. */
export type PesoDoCartao =
	| { readonly estado: 'com_peso'; readonly kg: number; readonly texto: string }
	| { readonly estado: 'sem_peso' }
	| { readonly estado: 'fora_de_escala' };

/**
 * A soma dos quilos de um cartão, e o que fazer com ela.
 *
 * ## Soma-se com sinal, e os estornos entram
 *
 * Duas encomendas positivas para a mesma família no mesmo dia são **duas entregas reais** e somam.
 * Um estorno é negativo e **abate** — e é por isso que a marca `REEMBOLSAR`, que decide o *estado*,
 * não pode decidir a *soma*: excluir o estorno e contar o original era contar quilos que foram
 * anulados.
 *
 * ## Uma observação sobrepõe-se aos pesos
 *
 * Uma encomenda com falta não entra na soma, **mesmo que traga quilos** — são 20 encomendas nas
 * recolhas (1 379,2 kg) e 9 nas entregas (298,0 kg), quase todas uma "Falta Injustificada" ao lado
 * de comida pesada a sério. Quem marcou a falta fê-lo por alguma razão, e o ecrã segue-a.
 *
 * ## Sem número quando não há peso
 *
 * `net <= 0` não mostra número nenhum: fica o ✓, "entregue sem peso registado". Cobre o cabaz
 * registado em unidades, as linhas em quilos a somar zero, a encomenda sem linhas e o cartão que um
 * estorno de outro dia pôs a negativo. E cobre também o peso que **arredonda a zero** — mostrar
 * "0 kg" a quem entregou 40 gramas é mentir com precisão.
 */
export function pesoDoCartao(encomendas: readonly EncomendaPos[], comFalta: ReadonlySet<number>, tectoKg: number): PesoDoCartao {
	let net = 0;
	for (const encomenda of encomendas) {
		if (comFalta.has(encomenda.id)) continue;
		if (Number.isFinite(encomenda.total_in_kg)) net += encomenda.total_in_kg;
	}

	if (Math.abs(net) > tectoKg) return { estado: 'fora_de_escala' };

	const kg = arredondarPeso(net);
	return kg > 0 ? { estado: 'com_peso', kg, texto: formatarPeso(kg) } : { estado: 'sem_peso' };
}

/**
 * O peso como vai ao ecrã, em número.
 *
 * **Arredonda-se antes de somar, e não depois**, para que o cabeçalho seja a soma exacta do que está
 * nos cartões: quem somar o ecrã à mão tem de obter o total, senão deixa de acreditar nos dois
 * números.
 *
 * Uma décima abaixo de 10 kg, inteiro acima. Não é simetria: 22% dos cartões de entregas e 36% dos
 * de recolhas estão abaixo dos 10 kg, e ali uma décima é informação; acima, é ruído a quatro metros
 * de distância. Sem a décima, os três cartões de recolha com menos de meio quilo — o mínimo real da
 * base é **0,24 kg** — apareceriam como "0 kg".
 */
export function arredondarPeso(kg: number): number {
	if (!Number.isFinite(kg)) return 0;
	return Math.abs(kg) < 10 ? Math.round(kg * 10) / 10 : Math.round(kg);
}

/**
 * O peso em texto, com unidade.
 *
 * Toneladas a partir de 1 000 kg — com uma décima até às 10 T e inteiro acima. Um cabeçalho de
 * recolhas passa os 1 000 kg em 10% dos dias, e `1 240 kg` num televisor é um número que ninguém
 * lê de relance; `1,2 T` é.
 *
 * Recebe um valor **já arredondado** pelo {@link arredondarPeso}: formatar e arredondar são duas
 * coisas, e o cabeçalho precisa de somar a segunda antes de fazer a primeira.
 */
export function formatarPeso(kg: number): string {
	if (!Number.isFinite(kg)) return '';
	if (Math.abs(kg) >= 1000) {
		/*
		 * Arredonda-se à décima **antes** de escolher entre a décima e o inteiro, senão os dois ramos
		 * discordam na fronteira: 9 950 kg são 9,95 T, e o `toFixed(1)` de 9.95 dá `9.9` — o valor
		 * binário é 9,9499… — enquanto o ramo do inteiro daria 10. Arredondando primeiro, os dois
		 * dizem 10 T.
		 */
		const toneladas = Math.round(kg) / 1000;
		const comDecima = Math.round(toneladas * 10) / 10;
		const texto = Math.abs(comDecima) >= 10 ? String(Math.round(toneladas)) : comDecima.toFixed(1).replace('.', ',');
		return `${texto} T`;
	}

	return `${String(kg).replace('.', ',')} kg`;
}

/**
 * O total de um painel: a soma dos pesos que os cartões mostram, e quantos ficaram fora de escala.
 *
 * **Soma o que está no ecrã, e mais nada.** Um cartão com falta, um sem peso e um fora de escala
 * contribuem zero — e o fora de escala é contado à parte, para o cabeçalho poder dizer que existe
 * sem o somar. O que não aparece em nenhum sítio é o que ninguém consegue verificar.
 */
export function totalDoPainel(pesos: readonly PesoDoCartao[]): { readonly pesoTotal: string | null; readonly foraDeEscala: number } {
	let kg = 0;
	let foraDeEscala = 0;

	for (const peso of pesos) {
		if (peso.estado === 'com_peso') kg += peso.kg;
		else if (peso.estado === 'fora_de_escala') foraDeEscala++;
	}

	/*
	 * A soma de décimas em ponto flutuante dá 45.900000000000006: volta a arredondar-se à décima —
	 * e **só à décima**, que é a precisão dos cartões.
	 *
	 * **O total não se volta a arredondar ao quilo.** Vinte cartões inteiros mais dois com décima
	 * dão `357,3 kg`, e é isso que o cabeçalho tem de dizer: arredondar para `357` fazia o ecrã
	 * discordar de quem o somasse à mão por 0,3 kg. O cabeçalho leva décima quando os cartões a
	 * levam, mesmo que nenhum cartão grande a mostre.
	 *
	 * **Em toneladas a exactidão degrada-se, e é inevitável:** `1 357,3 kg` escreve-se `1,4 T`. A
	 * essa escala ninguém soma quarenta cartões à mão, e um total em quilos com quatro dígitos não
	 * se lê a quatro metros. A garantia vale em quilos, que é onde os turnos vivem.
	 */
	const total = Math.round(kg * 10) / 10;
	return { pesoTotal: total > 0 ? formatarPeso(total) : null, foraDeEscala };
}

/* -------------------------------------------------- o resumo de um parceiro */

/**
 * Uma encomenda com o que é preciso para lhe saber o dono e o momento.
 *
 * O `partner_id` é o espelho no `res.partner`, e é a **única** chave que o POS dá: a encomenda não
 * aponta para a ficha do beneficiário, do parceiro de apoio nem da fonte. Quem quiser a ficha entra
 * por ela — ver a nota do `lerFichas`, em `entregas.ts`.
 */
export type EncomendaComParceiro = EncomendaPos & {
	partner_id: [number, string] | false;
	date_order: string | false;
};

/** O que o POS diz de um parceiro num dia: se foi falta, quantos quilos, e quando. */
export interface ResumoDoParceiro {
	/** Se a **última** encomenda do dia trouxe uma observação de falta. */
	readonly falta: boolean;
	readonly peso: PesoDoCartao;
	/**
	 * O `date_order` da encomenda que decidiu o estado — string UTC do Odoo, ou `''`.
	 *
	 * Serve para duas coisas que só os extras precisam: saber a que turno pertence uma encomenda que
	 * não tem turno nenhum, e ordenar os extras entre si pela ordem em que aconteceram.
	 */
	readonly quando: string;
}

/**
 * O estado e os quilos de cada parceiro que registou encomenda no dia.
 *
 * **Está aqui, e não em cada painel, porque é literalmente a mesma coisa nos dois.** Foi escrito
 * duas vezes — `resumoPorBeneficiario` nas entregas, `resumoPorParceiro` nas recolhas — e as duas
 * cópias já divergiam numa: a das entregas traduzia o parceiro para beneficiário pelo caminho, o
 * que a impedia de ver as encomendas dos parceiros de apoio. Com os extras as duas passariam a
 * precisar do mesmo campo novo, e duas cópias que crescem juntas são uma cópia a mais.
 *
 * **Devolve parceiros, não fichas.** A tradução para a ficha faz-se depois, com o mapa que sai da
 * `res.beneficiary` / `res.food.source` — nunca por uma leitura ao `res.partner`, cujo `company_id`
 * é opcional no Odoo e cuja consulta com o âmbito estrito do leitor descarta espelhos legítimos em
 * silêncio. Foi esse o bug que se corrigiu nos dois painéis.
 *
 * ## Duas agregações sobre o mesmo conjunto, e não é incoerência
 *
 * **O estado é o da última encomenda; o peso é a soma de todas.** São perguntas diferentes: o
 * estado é "o que aconteceu por fim", e o peso é "quanto foi ao todo". Duas encomendas positivas
 * para o mesmo destino no mesmo dia são dois acontecimentos reais e somam; a segunda é que diz como
 * ficou.
 *
 * **Os estornos ficam fora do estado e dentro da soma.** Não são acontecimento — a anulação de um
 * registo não é uma entrega —, mas são quantidade e têm de abater.
 *
 * **Um cartão com falta não mostra peso e contribui zero.** É a regra "uma observação sobrepõe-se
 * aos pesos", aplicada ao cartão e não à encomenda: quem tenha uma falta por último e uma entrega
 * antes aparece com ✕ e sem número, e o cabeçalho subestima nesses casos. É escolha — o que se
 * ganha é o cabeçalho ser a soma exacta do que está nos cartões.
 */
export function resumoPorParceiro(
	encomendas: readonly EncomendaComParceiro[],
	comFalta: ReadonlySet<number>,
	tectoKg: number,
): Map<number, ResumoDoParceiro> {
	const porParceiro = new Map<number, EncomendaComParceiro[]>();
	const ultima = new Map<number, { quando: string; ordem: number; falta: boolean }>();

	for (const encomenda of encomendas) {
		const parceiro = many2oneId(encomenda.partner_id);
		if (parceiro === null) continue;

		const lista = porParceiro.get(parceiro);
		if (lista) lista.push(encomenda);
		else porParceiro.set(parceiro, [encomenda]);

		// O estorno entra na lista de cima — para a soma — mas não decide estado nenhum.
		if (ehEstorno(encomenda)) continue;

		const quando = typeof encomenda.date_order === 'string' ? encomenda.date_order : '';
		const anterior = ultima.get(parceiro);

		// O `date_order` é uma string UTC `YYYY-MM-DD HH:MM:SS`, que ordena bem em texto. O `id`
		// desempata duas encomendas do mesmo segundo, que existem.
		if (!anterior || quando > anterior.quando || (quando === anterior.quando && encomenda.id > anterior.ordem)) {
			ultima.set(parceiro, { quando, ordem: encomenda.id, falta: comFalta.has(encomenda.id) });
		}
	}

	const resumo = new Map<number, ResumoDoParceiro>();
	for (const [parceiro, { falta, quando }] of ultima) {
		const suas = porParceiro.get(parceiro) ?? [];
		const peso = falta ? ({ estado: 'sem_peso' } as const) : pesoDoCartao(suas, comFalta, tectoKg);
		resumo.set(parceiro, { falta, peso, quando });
	}

	return resumo;
}

/* ----------------------------------------------------------- os extras */

/**
 * A que turno do dia pertence uma encomenda que **não tem turno nenhum**.
 *
 * ## Porque é que isto é uma heurística, e não uma leitura
 *
 * Um cartão normal nasce de uma rota, e uma rota tem `resource_calendar_id` — o turno vem escrito.
 * Um extra nasce de uma `pos.order`, e a encomenda **não tem turno**: tem um `date_order` e mais
 * nada. Nada na base liga uma encomenda ao turno em que foi feita, e não é um campo que falte —
 * é uma ligação que o modelo não tem.
 *
 * Sobra a hora. O extra cai no **turno mais tardio que já tinha começado** quando foi registado, e
 * num núcleo com um turno de entregas por dia — o caso normal — isto é exacto. Há núcleos com seis
 * turnos no mesmo dia, e aí é uma aproximação: um registo feito à pressa depois de o turno seguinte
 * ter aberto aparece no turno errado.
 *
 * **A alternativa era pior.** Mostrar os extras do dia em todos os turnos punha os mesmos quilos em
 * dois cabeçalhos diferentes, e o total de um painel tem de ser a soma exacta do que está no ecrã.
 *
 * Uma encomenda registada **antes** do primeiro turno do dia cai no primeiro: é o que acontece a
 * quem regista de manhã o que fez na véspera, e mandá-la para lado nenhum era escondê-la.
 *
 * Os turnos chegam **já ordenados pela hora**, como os painéis os montam; os que não têm hora no
 * nome ordenam para o fim e nunca ganham a comparação.
 */
export function turnoDoExtra(quando: unknown, turnos: readonly TurnoDoDia[]): number | null {
	const primeiro = turnos[0];
	if (primeiro === undefined) return null;

	const hora = horaEmLisboa(quando);
	if (hora === null) return primeiro.id;

	let escolhido = primeiro;
	for (const turno of turnos) {
		if (turno.hora !== null && turno.hora <= hora) escolhido = turno;
	}

	return escolhido.id;
}
