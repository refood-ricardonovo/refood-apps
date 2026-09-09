import { describe, expect, it } from 'vitest';
import {
	arredondarPeso,
	CATEGORIA_DE_OBSERVACOES,
	CODIGOS_TRATADO,
	ehEstorno,
	formatarPeso,
	lerEncomendasComFalta,
	lerIdsTratados,
	pesoDoCartao,
	resumoPorParceiro,
	TECTO_ENTREGAS_KG,
	TECTO_RECOLHAS_KG,
	totalDoPainel,
	turnoDoExtra,
	type EncomendaComParceiro,
	type EncomendaPos,
	type PesoDoCartao,
} from '../src/pos';
import { LINGUA_DA_TV, type LeitorDoNucleo, type OpcoesLeitura } from '../src/sessao';

const EMPRESA = 75;

interface Chamada {
	modelo: string;
	dominio: unknown;
	opcoes: OpcoesLeitura;
}

function leitorFalso(respostas: Record<string, unknown[]>): { leitor: LeitorDoNucleo; chamadas: Chamada[] } {
	const chamadas: Chamada[] = [];

	return {
		chamadas,
		leitor: {
			empresa: EMPRESA,
			lingua: LINGUA_DA_TV,
			async searchRead(modelo, dominio, opcoes) {
				chamadas.push({ modelo, dominio, opcoes });
				return (respostas[modelo] ?? []) as never;
			},
		},
	};
}

/** Uma encomenda com o mínimo que o POS dá. */
const enc = (id: number, kg: number, name = `R${id}`): EncomendaPos => ({ id, name, total_in_kg: kg });

/* --------------------------------------------------- as strings de negócio */

describe('as strings de negócio', () => {
	/**
	 * A única string traduzida de que os painéis dependem. Funciona porque tem **o mesmo valor nas
	 * duas línguas** — verificado contra a base. Se alguém a mudar no Odoo, é aqui que se vê.
	 */
	it('a categoria das observações é a que o Odoo tem', () => {
		expect(CATEGORIA_DE_OBSERVACOES).toBe('Observações');
	});

	/**
	 * **A chave é a Referência Interna, nunca o nome nem o id.** O produto que significa ✓ chama-se
	 * "Falta Justificada (cópia)" em `en_US`: uma regra por nome classificava-o como falta em
	 * silêncio. E o id não é portável entre staging e produção.
	 */
	it('os códigos de "tratado" são referências internas, e não nomes nem ids', () => {
		expect(CODIGOS_TRATADO).toEqual(['OBS-SEM-EXC']);
		for (const codigo of CODIGOS_TRATADO) {
			expect(codigo).toMatch(/^OBS-/);
			expect(Number.isNaN(Number(codigo))).toBe(true);
		}
	});

	it('reconhece um estorno pelo sufixo, e não confunde uma encomenda normal', () => {
		expect(ehEstorno({ name: 'EABF 26/00001 REEMBOLSAR' })).toBe(true);
		expect(ehEstorno({ name: 'EABF 26/00001' })).toBe(false);
		expect(ehEstorno({ name: false })).toBe(false);
	});
});

/* --------------------------------------------------------- as observações */

describe('lerIdsTratados', () => {
	it('lê o catálogo pela referência interna e guarda com prazo longo', async () => {
		const { leitor, chamadas } = leitorFalso({ 'product.product': [{ id: 37, default_code: 'OBS-SEM-EXC' }] });

		const tratados = await lerIdsTratados(leitor);

		expect([...tratados]).toEqual([37]);
		expect(chamadas[0]?.modelo).toBe('product.product');
		expect(chamadas[0]?.dominio).toEqual([['default_code', 'in', ['OBS-SEM-EXC']]]);
		expect(chamadas[0]?.opcoes.cache).toBeGreaterThan(600);
	});

	/**
	 * Um código que não exista na base **não é erro** — o conjunto vem vazio e a observação
	 * correspondente passa a contar como falta. Visível no ecrã, que é a direcção certa de falha.
	 */
	it('um código inexistente devolve conjunto vazio, sem rebentar', async () => {
		const { leitor } = leitorFalso({});
		expect((await lerIdsTratados(leitor)).size).toBe(0);
	});
});

describe('lerEncomendasComFalta', () => {
	const TRATADOS = new Set([37]);

	it('prende as linhas ao order_id e à categoria, e pede só dois campos', async () => {
		const { leitor, chamadas } = leitorFalso({});

		await lerEncomendasComFalta(leitor, [7, 8], TRATADOS);

		expect(chamadas[0]?.dominio).toEqual([
			['order_id', 'in', [7, 8]],
			['product_id.pos_categ_id.name', '=', 'Observações'],
		]);
		expect(chamadas[0]?.opcoes.fields).toEqual(['order_id', 'product_id']);
	});

	it('não vai ao Odoo quando não há encomendas', async () => {
		const { leitor, chamadas } = leitorFalso({});
		expect((await lerEncomendasComFalta(leitor, [], TRATADOS)).size).toBe(0);
		expect(chamadas).toHaveLength(0);
	});

	/** O caso que a tradução escondia: o "sem excedente" está na mesma categoria e **não** é falta. */
	it('o "sem excedente" não conta como falta', async () => {
		const { leitor } = leitorFalso({
			'pos.order.line': [{ order_id: [7, 'R7'], product_id: [37, 'Sem excedente'] }],
		});

		expect((await lerEncomendasComFalta(leitor, [7], TRATADOS)).size).toBe(0);
	});

	it('uma falta conta, e a falta ao lado de um "sem excedente" também', async () => {
		const { leitor } = leitorFalso({
			'pos.order.line': [
				{ order_id: [7, 'R7'], product_id: [27, 'Falta Injustificada'] },
				{ order_id: [8, 'R8'], product_id: [37, 'Sem excedente'] },
				{ order_id: [8, 'R8'], product_id: [28, 'Falta Justificada'] },
			],
		});

		const comFalta = await lerEncomendasComFalta(leitor, [7, 8], TRATADOS);
		expect([...comFalta].sort()).toEqual([7, 8]);
	});

	/**
	 * **O desconhecido vale falta.** Um produto novo na categoria — ou um \`product_id\` malformado —
	 * aparece com ✕ até alguém lhe acrescentar o código. Errado, mas visível. O contrário esconderia
	 * faltas, e uma falta escondida num televisor é o pior erro que estes painéis podem dar.
	 */
	it('um produto que não está na lista de tratados é falta', async () => {
		const { leitor } = leitorFalso({
			'pos.order.line': [
				{ order_id: [7, 'R7'], product_id: [99, 'Observação Nova'] },
				{ order_id: [8, 'R8'], product_id: false },
			],
		});

		const comFalta = await lerEncomendasComFalta(leitor, [7, 8], TRATADOS);
		expect([...comFalta].sort()).toEqual([7, 8]);
	});
});

/* -------------------------------------------------------------- os quilos */

describe('pesoDoCartao', () => {
	const SEM_FALTA = new Set<number>();

	it('soma as encomendas do cartão', () => {
		expect(pesoDoCartao([enc(1, 12), enc(2, 8)], SEM_FALTA, TECTO_ENTREGAS_KG)).toEqual({
			estado: 'com_peso',
			kg: 20,
			texto: '20 kg',
		});
	});

	/**
	 * **O estorno abate.** É a razão de a marca `REEMBOLSAR`, que decide o estado, não poder decidir
	 * a soma: excluir o estorno e contar o original era contar quilos que foram anulados.
	 */
	it('o estorno entra na soma com o seu sinal', () => {
		expect(pesoDoCartao([enc(1, 20), enc(2, -20, 'R1 REEMBOLSAR')], SEM_FALTA, TECTO_ENTREGAS_KG)).toEqual({ estado: 'sem_peso' });
	});

	/** Uma observação sobrepõe-se aos pesos: a encomenda com falta não entra na soma, com ou sem quilos. */
	it('a encomenda com falta não soma, mesmo com quilos', () => {
		expect(pesoDoCartao([enc(1, 17), enc(2, 10)], new Set([1]), TECTO_ENTREGAS_KG)).toEqual({
			estado: 'com_peso',
			kg: 10,
			texto: '10 kg',
		});
	});

	it('zero e negativo não mostram número', () => {
		expect(pesoDoCartao([enc(1, 0)], SEM_FALTA, TECTO_ENTREGAS_KG)).toEqual({ estado: 'sem_peso' });
		expect(pesoDoCartao([enc(1, -5)], SEM_FALTA, TECTO_ENTREGAS_KG)).toEqual({ estado: 'sem_peso' });
		expect(pesoDoCartao([], SEM_FALTA, TECTO_ENTREGAS_KG)).toEqual({ estado: 'sem_peso' });
	});

	/** 40 gramas arredondam a zero: mostrar "0 kg" a quem entregou algo é mentir com precisão. */
	it('um peso que arredonda a zero não mostra número', () => {
		expect(pesoDoCartao([enc(1, 0.04)], SEM_FALTA, TECTO_ENTREGAS_KG)).toEqual({ estado: 'sem_peso' });
	});

	/**
	 * **O tecto é simétrico em `|kg|`, e não é detalhe:** os estornos não abatem no mesmo cartão —
	 * o `+71 150 kg` de 2025-08-12 é anulado por um `-71 150` do dia seguinte —, o que produz
	 * cartões enormes e negativos.
	 */
	it('fora de escala nas duas direcções', () => {
		expect(pesoDoCartao([enc(1, 20_000_124)], SEM_FALTA, TECTO_ENTREGAS_KG)).toEqual({ estado: 'fora_de_escala' });
		expect(pesoDoCartao([enc(1, -71_079)], SEM_FALTA, TECTO_ENTREGAS_KG)).toEqual({ estado: 'fora_de_escala' });
	});

	/** Os tectos são diferentes por painel, e os números saem da base. Uma tonelada é recolha plausível. */
	it('os tectos dos dois painéis são os medidos, e o das recolhas é mais alto', () => {
		expect(TECTO_ENTREGAS_KG).toBe(300);
		expect(TECTO_RECOLHAS_KG).toBe(1500);

		// 1 105 kg é o maior valor plausível de uma recolha na base; 64 508 é o primeiro absurdo.
		expect(pesoDoCartao([enc(1, 1105)], SEM_FALTA, TECTO_RECOLHAS_KG).estado).toBe('com_peso');
		expect(pesoDoCartao([enc(1, 1105)], SEM_FALTA, TECTO_ENTREGAS_KG).estado).toBe('fora_de_escala');
		expect(pesoDoCartao([enc(1, 64_508)], SEM_FALTA, TECTO_RECOLHAS_KG).estado).toBe('fora_de_escala');
	});

	it('ignora um total_in_kg que não é número', () => {
		expect(pesoDoCartao([{ id: 1, name: 'a', total_in_kg: NaN }, enc(2, 5)], SEM_FALTA, TECTO_ENTREGAS_KG)).toEqual({
			estado: 'com_peso',
			kg: 5,
			texto: '5 kg',
		});
	});
});

describe('arredondarPeso e formatarPeso', () => {
	/**
	 * Uma décima abaixo de 10 kg, inteiro acima. 22% dos cartões de entregas e 36% dos de recolhas
	 * estão abaixo dos 10 kg, e ali a décima é informação; acima é ruído a quatro metros. Sem ela,
	 * os cartões de recolha com menos de meio quilo — o mínimo real da base é 0,24 kg —
	 * apareceriam como "0 kg".
	 */
	it.each([
		[0.24, 0.2, '0,2 kg'],
		[7.34, 7.3, '7,3 kg'],
		[9.96, 10, '10 kg'],
		[15.4, 15, '15 kg'],
		[113, 113, '113 kg'],
		[999.4, 999, '999 kg'],
	])('%s kg → %s → "%s"', (bruto, arredondado, texto) => {
		expect(arredondarPeso(bruto)).toBe(arredondado);
		expect(formatarPeso(arredondado)).toBe(texto);
	});

	/** Toneladas a partir de 1 000 kg: `1 240 kg` não se lê de relance num televisor, `1,2 T` lê-se. */
	it.each([
		[1000, '1,0 T'],
		[1240, '1,2 T'],
		[2293, '2,3 T'],
		// A fronteira: 9,95 T arredonda a 10 T, e os dois ramos do formato têm de concordar nisso.
		[9950, '10 T'],
		[9940, '9,9 T'],
		[26_020, '26 T'],
	])('%s kg em toneladas → "%s"', (kg, texto) => {
		expect(formatarPeso(kg)).toBe(texto);
	});

	/** Vírgula decimal, que é o que se escreve em português. */
	it('usa vírgula e nunca ponto', () => {
		expect(formatarPeso(7.3)).not.toContain('.');
		expect(formatarPeso(1200)).not.toContain('.');
	});
});

describe('totalDoPainel', () => {
	const comPeso = (kg: number): PesoDoCartao => ({ estado: 'com_peso', kg, texto: formatarPeso(kg) });

	/**
	 * **O cabeçalho é a soma exacta do que está nos cartões** — arredondado primeiro, somado depois.
	 * Quem somar o ecrã à mão tem de obter o total; se desse outro número, deixava de acreditar nos
	 * dois.
	 */
	it('soma os pesos que os cartões mostram', () => {
		expect(totalDoPainel([comPeso(15), comPeso(20), comPeso(10)])).toEqual({ pesoTotal: '45 kg', foraDeEscala: 0 });
	});

	it('não deixa a soma de décimas escapar em ponto flutuante', () => {
		expect(totalDoPainel([comPeso(0.1), comPeso(0.2)]).pesoTotal).toBe('0,3 kg');
	});

	/**
	 * **O caso que quase passou.** Vinte cartões inteiros e dois com décima dão 357,3 kg, e o total
	 * estava a arredondar para 357 — o ecrã discordava de quem o somasse à mão por 0,3 kg, que é
	 * precisamente a confiança que esta regra existe para não perder. Verificado depois contra o
	 * turno real de 2025-03-24 em Famalicão.
	 */
	it('mantém a décima no total quando algum cartão a tem, mesmo com os outros inteiros', () => {
		expect(totalDoPainel([comPeso(40), comPeso(21), comPeso(7.5), comPeso(9.8)]).pesoTotal).toBe('78,3 kg');
		expect(totalDoPainel([comPeso(40), comPeso(21)]).pesoTotal).toBe('61 kg');
	});

	it('o que não tem peso contribui zero', () => {
		expect(totalDoPainel([comPeso(15), { estado: 'sem_peso' }])).toEqual({ pesoTotal: '15 kg', foraDeEscala: 0 });
		expect(totalDoPainel([{ estado: 'sem_peso' }])).toEqual({ pesoTotal: null, foraDeEscala: 0 });
		expect(totalDoPainel([])).toEqual({ pesoTotal: null, foraDeEscala: 0 });
	});

	/**
	 * **Um valor fora de escala não desaparece em silêncio.** Não entra na soma, mas é contado — um
	 * número absurdo escondido é um erro que ninguém corrige.
	 */
	it('conta os fora de escala à parte, sem os somar', () => {
		expect(totalDoPainel([comPeso(15), { estado: 'fora_de_escala' }, { estado: 'fora_de_escala' }])).toEqual({
			pesoTotal: '15 kg',
			foraDeEscala: 2,
		});
	});

	it('passa a toneladas quando o turno o justifica', () => {
		expect(totalDoPainel([comPeso(900), comPeso(400)]).pesoTotal).toBe('1,3 T');
	});
});

/* ------------------------------------------------ o resumo de um parceiro */

/** Uma encomenda com dono e momento — o que o resumo precisa. */
const encP = (id: number, parceiro: number, quando: string, kg = 0, name = `E${id}`): EncomendaComParceiro => ({
	id,
	name,
	total_in_kg: kg,
	partner_id: [parceiro, 'PTABF_BF000001'],
	date_order: quando,
});

/**
 * Estes casos viviam em `entregas.test.ts`, sobre um `resumoPorBeneficiario` que traduzia o
 * parceiro pelo caminho — e era essa tradução que impedia as encomendas dos parceiros de apoio de
 * casarem com alguma coisa. Agora a função é uma só, partilhada pelos dois painéis, e devolve
 * parceiros: quem os traduz para fichas é cada painel, depois.
 */
describe('resumoPorParceiro', () => {
	it('uma encomenda com linha de Observações é falta; qualquer outra não é', () => {
		const resumo = resumoPorParceiro(
			[encP(1, 101, '2026-01-15 18:40:00'), encP(2, 102, '2026-01-15 18:41:00')],
			new Set([2]),
			TECTO_ENTREGAS_KG,
		);

		expect(resumo.get(101)?.falta).toBe(false);
		expect(resumo.get(102)?.falta).toBe(true);
	});

	/** Um registo errado corrige-se com um estorno, não com um `cancel`. Não é acontecimento. */
	it('ignora os estornos no estado, e abate-os na soma', () => {
		const resumo = resumoPorParceiro(
			[encP(1, 101, '2026-01-15 18:40:00', 20), encP(2, 101, '2026-01-15 19:00:00', -5, 'E1 REEMBOLSAR')],
			new Set(),
			TECTO_ENTREGAS_KG,
		);

		expect(resumo.get(101)?.falta).toBe(false);
		expect(resumo.get(101)?.peso).toEqual({ estado: 'com_peso', kg: 15, texto: '15 kg' });
	});

	it('com duas encomendas no mesmo dia, decide a última', () => {
		const resumo = resumoPorParceiro(
			[encP(1, 101, '2026-01-15 18:40:00'), encP(2, 101, '2026-01-15 19:10:00')],
			new Set([1]),
			TECTO_ENTREGAS_KG,
		);

		// A primeira era falta, a segunda não: fica sem falta.
		expect(resumo.get(101)?.falta).toBe(false);
		expect(resumo.get(101)?.quando).toBe('2026-01-15 19:10:00');
	});

	it('desempata pelo id duas encomendas do mesmo segundo', () => {
		const resumo = resumoPorParceiro(
			[encP(9, 101, '2026-01-15 18:40:00'), encP(4, 101, '2026-01-15 18:40:00')],
			new Set([9]),
			TECTO_ENTREGAS_KG,
		);

		expect(resumo.get(101)?.falta).toBe(true);
	});

	/** Uma observação sobrepõe-se aos pesos, e ao nível do cartão. */
	it('um parceiro com falta por último não mostra peso nenhum', () => {
		const resumo = resumoPorParceiro(
			[encP(1, 101, '2026-01-15 18:40:00', 12), encP(2, 101, '2026-01-15 19:00:00', 0)],
			new Set([2]),
			TECTO_ENTREGAS_KG,
		);

		expect(resumo.get(101)?.falta).toBe(true);
		expect(resumo.get(101)?.peso).toEqual({ estado: 'sem_peso' });
	});

	it('não inventa entrada para uma encomenda sem parceiro', () => {
		const resumo = resumoPorParceiro(
			[{ id: 1, name: 'E1', total_in_kg: 5, partner_id: false, date_order: '2026-01-15 18:40:00' }],
			new Set(),
			TECTO_ENTREGAS_KG,
		);

		expect(resumo.size).toBe(0);
	});
});

/* ------------------------------------------------------ o turno de um extra */

describe('turnoDoExtra', () => {
	const turnos = [
		{ id: 50, nome: 'A', hora: '09:00' },
		{ id: 51, nome: 'B', hora: '18:00' },
		{ id: 52, nome: 'C', hora: '20:00' },
	];

	/**
	 * **A encomenda não tem turno**, e a hora é tudo o que dela se sabe. Cai no turno mais tardio
	 * que já tinha começado — a hora comparada é a de **Lisboa**, e o `date_order` do Odoo é UTC.
	 */
	it('escolhe o turno mais tardio que já tinha começado', () => {
		// 18:40 em Lisboa, no inverno (UTC+0).
		expect(turnoDoExtra('2026-01-15 18:40:00', turnos)).toBe(51);
		expect(turnoDoExtra('2026-01-15 20:30:00', turnos)).toBe(52);
		expect(turnoDoExtra('2026-01-15 09:00:00', turnos)).toBe(50);
	});

	/**
	 * **É a hora de Lisboa, e não a de UTC.** No verão Lisboa está uma hora à frente: um registo às
	 * 17:30 UTC são 18:30 de parede, já dentro do turno das 18:00. Comparar em UTC punha-o no turno
	 * da manhã.
	 */
	it('compara no fuso de Lisboa, e não em UTC', () => {
		expect(turnoDoExtra('2026-07-15 17:30:00', turnos)).toBe(51);
		expect(turnoDoExtra('2026-01-15 17:30:00', turnos)).toBe(50);
	});

	/** Quem regista de manhã o que fez na véspera cai no primeiro turno — nunca em lado nenhum. */
	it('põe no primeiro turno o que foi registado antes de todos eles', () => {
		expect(turnoDoExtra('2026-01-15 04:00:00', turnos)).toBe(50);
	});

	it('aguenta uma data ausente ou malformada, e um dia sem turnos', () => {
		expect(turnoDoExtra('', turnos)).toBe(50);
		expect(turnoDoExtra(false, turnos)).toBe(50);
		expect(turnoDoExtra('2026-01-15 18:40:00', [])).toBeNull();
	});

	/** Um turno sem hora no nome — um calendário standard herdado — nunca ganha a comparação. */
	it('ignora os turnos sem hora', () => {
		const comSemHora = [
			{ id: 60, nome: 'A', hora: '09:00' },
			{ id: 61, nome: 'Standard 40 hours/week', hora: null },
		];
		expect(turnoDoExtra('2026-01-15 23:00:00', comSemHora)).toBe(60);
	});
});
