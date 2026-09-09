import { describe, expect, it } from 'vitest';
import {
	contagem,
	etiquetaDoNumero,
	etiquetaDoParceiro,
	horaDoTurno,
	montarPainel,
	nomeCurtoDoParceiro,
	nomeDoTurno,
	ordemDoNumero,
	ordemDoParceiro,
} from '../src/entregas';
import { LINGUA_DA_TV, type ContextoTv, type LeitorDoNucleo, type OpcoesLeitura, type VistaPedida } from '../src/sessao';

const EMPRESA = 75;
/** Uma quinta-feira. `week_day` do Odoo: '3'. */
const QUINTA = '2026-01-15';
/** 10:00 em Lisboa, no inverno — bem dentro do dia Refood de quinta. */
const AGORA = new Date('2026-01-15T10:00:00Z');

interface Chamada {
	modelo: string;
	dominio: unknown;
	opcoes: OpcoesLeitura;
}

/**
 * Um leitor falso que regista o que lhe pedem.
 *
 * Guarda os domínios tal como chegam, porque metade do que estes testes protegem são as cláusulas:
 * o `pos_type` das Entregas, o `order_id` das linhas, o `active in [true, false]` dos parceiros. Um
 * domínio que se perca não dá erro — dá menos linhas, ou linhas de mais.
 */
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

function contextoFalso(leitor: LeitorDoNucleo, vista: Partial<VistaPedida> = {}): ContextoTv {
	return {
		sessao: { dispositivo: 'dis_teste', empresa: EMPRESA },
		leitor,
		vista: { dia: null, turno: null, ...vista },
		lingua: LINGUA_DA_TV,
		agora: AGORA,
	};
}

function rota(id: number, numero: string | false, calendario: number, extra: Record<string, unknown> = {}) {
	return {
		id,
		resource_calendar_id: [calendario, 'turno'] as [number, string],
		// O rótulo traz o **nome da pessoa**. Está aqui de propósito: é o que o Odoo devolve, e é
		// o que nunca pode sair do Worker.
		beneficiary_id: [id * 10, 'Maria Fernanda Costa'] as [number, string],
		related_beneficiary_number: numero,
		start_hour: 18.5,
		adult_count: 2,
		child_count: 1,
		beneficiary_count: 3,
		...extra,
	};
}

/* ------------------------------------------------------------- conversões */

describe('a etiqueta do cartão', () => {
	it('tira o prefixo e os zeros à cabeça', () => {
		expect(etiquetaDoNumero('PTABF_BF000028')).toBe('B28');
		expect(etiquetaDoNumero('PTVNF_BF000788')).toBe('B788');
		expect(etiquetaDoNumero('PTABF_BF000001')).toBe('B1');
	});

	/**
	 * Cinco fichas da base têm um `\t` colado à cabeça do prefixo. Sem o `trim` a etiqueta saía com
	 * um espaço invisível à frente e a ordenação ia com ele.
	 */
	it('aguenta a tabulação que há à cabeça de algumas fichas', () => {
		expect(etiquetaDoNumero('\tPTVNF_BF000788')).toBe('B788');
		expect(ordemDoNumero('\tPTVNF_BF000788')).toBe(788);
	});

	it('devolve null quando não há número, em vez de inventar um', () => {
		expect(etiquetaDoNumero(false)).toBeNull();
		expect(etiquetaDoNumero('')).toBeNull();
		expect(etiquetaDoNumero('PTABF_XX000028')).toBeNull();
		expect(etiquetaDoNumero(null)).toBeNull();
	});
});

describe('as contagens da rota', () => {
	/** Cerca de metade das rotas da base tem as contagens a zero: é "ninguém preencheu". */
	it('trata o zero como "sem contagem", não como zero pessoas', () => {
		expect(contagem(0)).toBeNull();
		expect(contagem(false)).toBeNull();
		expect(contagem(3)).toBe(3);
	});
});

describe('a etiqueta de um parceiro de apoio', () => {
	it('é a mesma numeração das outras fichas, com o sufixo _PA', () => {
		expect(etiquetaDoParceiro('PTABF_PA000012')).toBe('P12');
		expect(ordemDoParceiro('PTABF_PA000012')).toBe(12);
		expect(etiquetaDoParceiro(' PTVNF_PA000003 ')).toBe('P3');
	});

	/** 220 dos 1 014 parceiros de apoio não têm número. O cartão fica sem etiqueta, não sem cartão. */
	it('devolve null quando não há número, e não confunde com um beneficiário', () => {
		expect(etiquetaDoParceiro(false)).toBeNull();
		expect(etiquetaDoParceiro('PTABF_BF000012')).toBeNull();
		expect(ordemDoParceiro('PTABF_BF000012')).toBeNull();
	});
});

describe('o nome curto de um parceiro de apoio', () => {
	/**
	 * **É a única coisa deste painel que sai de um campo `name`**, e o corte é o que garante que
	 * continua a ser uma identificação e não uma ficha. Ver o cabeçalho de `entregas.ts`.
	 */
	it('são as duas primeiras palavras, e mais nada', () => {
		expect(nomeCurtoDoParceiro('Centro Social Paroquial de Benfica')).toBe('Centro Social');
		expect(nomeCurtoDoParceiro('Cáritas')).toBe('Cáritas');
	});

	/**
	 * **A excepção do traço.** Há nomes na forma `SIGLA - Nome por extenso`, e o corte a duas
	 * palavras dava *"ARPILF -"* — um traço pendurado onde devia estar a informação. Visto num
	 * televisor.
	 */
	it('leva a terceira palavra quando a segunda é um traço', () => {
		expect(nomeCurtoDoParceiro('ARPILF - Associação de Reformados')).toBe('ARPILF - Associação');
	});

	/** Os três traços que aparecem em texto dão o mesmo cartão partido, e recebem o mesmo remédio. */
	it('conta o traço curto, o meio-risco e o travessão', () => {
		expect(nomeCurtoDoParceiro('ARPILF – Associação de Reformados')).toBe('ARPILF – Associação');
		expect(nomeCurtoDoParceiro('ARPILF — Associação de Reformados')).toBe('ARPILF — Associação');
	});

	/** Sem terceira palavra o traço ficava a sugerir que faltava ali qualquer coisa. */
	it('corta o traço que fique no fim', () => {
		expect(nomeCurtoDoParceiro('ARPILF -')).toBe('ARPILF');
		expect(nomeCurtoDoParceiro('-')).toBeNull();
	});

	/** Um traço no meio de um nome de duas palavras não é separador de sigla: fica como está. */
	it('não mexe num traço que não esteja em segundo lugar', () => {
		expect(nomeCurtoDoParceiro('Centro Social - Benfica')).toBe('Centro Social');
	});

	/** Há nomes com espaço duplo e com espaço nas pontas: sem colapsar, a segunda palavra saía vazia. */
	it('colapsa o espaço antes de cortar', () => {
		expect(nomeCurtoDoParceiro('  Centro   Social  de X ')).toBe('Centro Social');
	});

	it('devolve null quando não há nome nenhum', () => {
		expect(nomeCurtoDoParceiro(false)).toBeNull();
		expect(nomeCurtoDoParceiro('   ')).toBeNull();
	});
});

describe('o nome do turno', () => {
	it('prefere o shift_name, que é o legível', () => {
		expect(nomeDoTurno({ id: 1, name: '5f t1', shift_name: 'Quinta-Feira 18:00' })).toBe('Quinta-Feira 18:00');
	});

	it('cai no name quando o shift_name vem vazio, como nos calendários herdados', () => {
		expect(nomeDoTurno({ id: 1, name: 'Standard 40 hours/week', shift_name: false })).toBe('Standard 40 hours/week');
		expect(nomeDoTurno({ id: 1, name: '5f t1', shift_name: '   ' })).toBe('5f t1');
	});

	/**
	 * O separador mostra só a hora. O nome inteiro do Odoo repetia o dia da semana num cabeçalho
	 * que já o tem em grande, e punha todos os separadores de um dia a começar pela mesma palavra.
	 */
	it('extrai a hora de início do nome do turno', () => {
		expect(horaDoTurno({ id: 1, name: '5f t1', shift_name: 'Quinta-Feira 18:00' })).toBe('18:00');
		expect(horaDoTurno({ id: 1, name: '5f t2', shift_name: 'Quinta-Feira 9:30' })).toBe('09:30');
	});

	it('devolve null quando não há hora nenhuma no nome', () => {
		expect(horaDoTurno({ id: 1, name: 'Standard 40 hours/week', shift_name: false })).toBeNull();
		expect(horaDoTurno({ id: 1, name: '5f t1', shift_name: 'Quinta-Feira' })).toBeNull();
	});
});

describe('como se identifica um turno', () => {
	/**
	 * **A hora não chega para identificar um turno, e há prova disso na base.**
	 *
	 * Medido em setembro de 2026: um núcleo tem **seis turnos de recolha no mesmo dia**, e dois deles
	 * começam ambos às 18:00 — `Turno 2.18` e `Turno 2.18 Hiper`. O separador mostra a hora, que é
	 * o que se navega; quem identifica é o `name`, que foi escrito por alguém precisamente para os
	 * distinguir. Por isso o `nome` do painel é o `name` do calendário e não o `shift_name`.
	 */
	it('o nome do turno é o name do calendário, não a hora derivada', async () => {
		const { leitor } = leitorFalso({
			'res.delivery.route': [rota(1, 'PTABF_BF000001', 50), rota(2, 'PTABF_BF000002', 51)],
			'resource.calendar': [
				{ id: 50, name: 'Turno 2.18', shift_name: 'Segunda-Feira 18:00' },
				{ id: 51, name: 'Turno 2.18 Hiper', shift_name: 'Segunda-Feira 18:00' },
			],
		});

		const painel = await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);

		// A mesma hora nos dois — é o caso real — mas nomes diferentes, que é o que os separa.
		expect(painel.turnos.map((t) => t.hora)).toEqual(['18:00', '18:00']);
		expect(painel.turnos.map((t) => t.nome)).toEqual(['Turno 2.18', 'Turno 2.18 Hiper']);
	});
});

describe('a ordem dos turnos', () => {
	it('é a da hora, e não a alfabética do nome', async () => {
		const { leitor } = leitorFalso({
			'res.delivery.route': [rota(1, 'PTABF_BF000001', 50), rota(2, 'PTABF_BF000002', 51)],
			'resource.calendar': [
				{ id: 50, name: 'z', shift_name: 'Quinta-Feira 20:00' },
				{ id: 51, name: 'a', shift_name: 'Quinta-Feira 18:00' },
			],
		});

		const painel = await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);
		expect(painel.turnos.map((t) => t.hora)).toEqual(['18:00', '20:00']);
		// E o primeiro turno do dia é o que abre, não o que vier primeiro do Odoo.
		expect(painel.turno?.hora).toBe('18:00');
	});
});

describe('montarPainel', () => {
	it('pede as rotas do dia da semana certo, as que já arrancaram, e só de fichas activas', async () => {
		const { leitor, chamadas } = leitorFalso({});
		await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);

		const rotas = chamadas.find((c) => c.modelo === 'res.delivery.route');
		expect(rotas?.dominio).toEqual([
			['week_day', '=', '3'],
			['start_date', '<=', '2026-01-15 23:59:59'],
			['beneficiary_id.active', '=', true],
		]);
		// String e não número: um `selection` do Odoo comparado com `3` devolve lista vazia.
		expect((rotas?.dominio as unknown[][])[0]?.[2]).toBe('3');
	});

	/**
	 * **Uma ficha arquivada não faz cartão, e o filtro tem de estar na rota.**
	 *
	 * Arquivar hoje apaga as rotas, mas antes era manual: ficaram **544 rotas de 3 252 — 16,7%** a
	 * apontar para beneficiários arquivados, e num turno de Benfica são **37 cartões**. Como o número
	 * do cartão vem da *rota* (`related_beneficiary_number`), esses cartões apareciam completos e
	 * indistinguíveis de uma família real — ao contrário das recolhas, onde a falta do número
	 * denunciou o problema.
	 *
	 * Filtrar depois de ler não servia: o cartão já existia. A `res.delivery.route` não tem `active`
	 * — não é arquivável, é apagada —, portanto a única cláusula possível é a travessia.
	 */
	it('não faz cartão de um beneficiário arquivado', async () => {
		const { leitor, chamadas } = leitorFalso({});
		await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);

		const rotas = chamadas.find((c) => c.modelo === 'res.delivery.route');
		expect(rotas?.dominio).toContainEqual(['beneficiary_id.active', '=', true]);
		// E nunca o contrário: um domínio que peça arquivados é histórico num televisor.
		expect(JSON.stringify(rotas?.dominio)).not.toContain('false');
	});

	/**
	 * **O `is_route_ongoing` não entra no domínio, e este teste existe para o manter fora.**
	 *
	 * É o filtro que qualquer pessoa acrescentaria a olhar para o nome do campo. Medido em setembro
	 * de 2026: das 391 rotas marcadas a `false`, **390 já tinham arrancado** — a marca é posta na
	 * criação quando a data de início é futura e nunca mais é corrigida. Filtrar por ela escondia
	 * 390 famílias servidas, e um cartão que falta não deixa buraco no ecrã.
	 */
	it('não filtra pelo is_route_ongoing — a marca fica obsoleta e escondia famílias', async () => {
		const { leitor, chamadas } = leitorFalso({});
		await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);

		const clausulas = chamadas.find((c) => c.modelo === 'res.delivery.route')?.dominio as unknown[][];
		expect(clausulas.some((c) => c[0] === 'is_route_ongoing')).toBe(false);
	});

	/**
	 * O caso que este filtro existe para apanhar: uma rota semanal combinada para começar num dia
	 * futuro não deve aparecer antes disso — mas **deve** aparecer a partir do dia em que começa.
	 *
	 * Por isso a comparação é com **o dia que se está a ver**, e não com hoje: comparar com hoje
	 * escondia-a de quem está a preparar a semana, que é exactamente para isso que a navegação vai
	 * sete dias para a frente.
	 */
	it('compara o start_date com o dia que se está a ver, e não com hoje', async () => {
		const limite = (chamadas: Chamada[]) =>
			(chamadas.find((c) => c.modelo === 'res.delivery.route')?.dominio as unknown[][]).find((c) => c[0] === 'start_date')?.[2];

		const hoje = leitorFalso({});
		await montarPainel(contextoFalso(hoje.leitor), AGORA);
		expect(limite(hoje.chamadas)).toBe('2026-01-15 23:59:59');

		const daquiA4 = leitorFalso({});
		await montarPainel(contextoFalso(daquiA4.leitor, { dia: '2026-01-19' }), AGORA);
		expect(limite(daquiA4.chamadas)).toBe('2026-01-19 23:59:59');
	});

	/** Sem data de fim: uma rota que termina é apagada, portanto não há limite superior nenhum. */
	it('não põe limite superior ao start_date', async () => {
		const { leitor, chamadas } = leitorFalso({});
		await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);

		const clausulas = chamadas.find((c) => c.modelo === 'res.delivery.route')?.dominio as unknown[][];
		expect(clausulas.filter((c) => c[0] === 'start_date')).toHaveLength(1);
		expect(clausulas.every((c) => c[1] !== '>=' && c[1] !== '>')).toBe(true);
	});

	it('ordena por número, e não alfabeticamente — o B9 vem antes do B10', async () => {
		const { leitor } = leitorFalso({
			'res.delivery.route': [rota(1, 'PTABF_BF000010', 50), rota(2, 'PTABF_BF000009', 50), rota(3, 'PTABF_BF000002', 50)],
			'resource.calendar': [{ id: 50, name: '5f t1', shift_name: 'Quinta-Feira 18:00' }],
		});

		const painel = await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);
		expect(painel.cartoes.map((c) => c.etiqueta)).toEqual(['B2', 'B9', 'B10']);
	});

	it('põe no fim, e não fora, as famílias sem número', async () => {
		const { leitor } = leitorFalso({
			'res.delivery.route': [rota(1, false, 50), rota(2, 'PTABF_BF000009', 50)],
			'resource.calendar': [{ id: 50, name: '5f t1', shift_name: false }],
		});

		const painel = await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);
		expect(painel.cartoes.map((c) => c.etiqueta)).toEqual(['B9', null]);
	});

	/**
	 * A regra que este teste guarda é a mais importante do painel: **nenhum nome de pessoa entra
	 * neste ecrã, em sítio nenhum.** O `beneficiary_id` das rotas traz o nome no rótulo do many2one,
	 * e é por isso que o teste procura o nome no JSON inteiro, e não campo a campo.
	 */
	it('não deixa sair nome nenhum de pessoa', async () => {
		const { leitor, chamadas } = leitorFalso({
			'res.delivery.route': [rota(1, 'PTABF_BF000009', 50)],
			'resource.calendar': [{ id: 50, name: '5f t1', shift_name: 'Quinta-Feira 18:00' }],
			'pos.order': [
				{ id: 7, partner_id: [101, 'PTABF_BF000009'], date_order: '2026-01-15 18:40:00', name: 'EABF 26/00001', total_in_kg: 0 },
			],
			'res.beneficiary': [{ id: 10, partner_id: [101, 'PTABF_BF000009'] }],
		});

		const painel = await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);
		expect(JSON.stringify(painel)).not.toContain('Maria');

		// E o `client_name` nunca é sequer pedido ao Odoo.
		const campos = chamadas.flatMap((c) => c.opcoes.fields);
		expect(campos).not.toContain('client_name');

		// A `res.beneficiary` **é** lida, e o que se lhe pede está fechado a esta lista. Nada de
		// `name`, de `full_name`, de morada nem de imagens — a ficha inteira é dados pessoais, e o
		// que aqui está é exactamente o que um cartão mostra: o espelho, o número, se está
		// arquivada, e as três contagens que a rota já copiava.
		expect(chamadas.find((c) => c.modelo === 'res.beneficiary')?.opcoes.fields).toEqual([
			'partner_id',
			'number',
			'active',
			'adult_count',
			'child_count',
			'beneficiary_count',
		]);

		// E do parceiro de apoio lê-se o nome — é uma instituição, não uma pessoa —, mas nem
		// morada, nem contactos, nem tipo.
		expect(chamadas.find((c) => c.modelo === 'res.support.partner')?.opcoes.fields).toEqual(['partner_id', 'number', 'name']);
	});

	it('lê o POS pelo pos_type e prende as linhas às encomendas', async () => {
		const { leitor, chamadas } = leitorFalso({
			'res.delivery.route': [rota(1, 'PTABF_BF000009', 50)],
			'resource.calendar': [{ id: 50, name: '5f t1', shift_name: 'x' }],
			'pos.order': [{ id: 7, partner_id: [101, 'x'], date_order: '2026-01-15 18:40:00', name: 'E', total_in_kg: 0 }],
			'res.beneficiary': [{ id: 10, partner_id: [101, 'PTABF_BF000009'] }],
		});

		await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);

		const encomendas = chamadas.find((c) => c.modelo === 'pos.order');
		expect(encomendas?.dominio).toEqual([
			['session_id.config_id.pos_type', '=', 'deliveries'],
			['date_order', '>=', '2026-01-15 03:00:00'],
			['date_order', '<', '2026-01-16 03:00:00'],
		]);

		// A linha do POS não tem regra por núcleo: sem o `order_id` a leitura contornava o filtro
		// que a encomenda tem.
		const linhas = chamadas.find((c) => c.modelo === 'pos.order.line');
		expect(linhas?.dominio).toEqual([
			['order_id', 'in', [7]],
			['product_id.pos_categ_id.name', '=', 'Observações'],
		]);

		// **O espelho vem da `res.beneficiary`, não do `res.partner`.** O `company_id` do
		// `res.partner` é opcional no Odoo, e o âmbito que o leitor acrescenta a toda a consulta
		// descartava em silêncio os 50 espelhos que o têm vazio. Na ficha o campo é obrigatório.
		expect(chamadas.map((c) => c.modelo)).not.toContain('res.partner');

		/*
		 * **Uma leitura, duas perguntas — daí o `|`.** Pelo `id` respondem as famílias com rota no
		 * dia; pelo `partner_id`, os parceiros que aparecem no POS sem terem rota, que são os
		 * extras.
		 *
		 * O `active in [true, false]` continua lá pela razão de sempre: uma rota continua a apontar
		 * para a ficha depois de ela ser arquivada, e sem isto perdia-se o estado dessa família no
		 * intervalo entre as duas caches. Quem separa os arquivados dos outros é o campo `active`,
		 * lido e verificado do lado dos extras.
		 */
		const fichas = chamadas.find((c) => c.modelo === 'res.beneficiary');
		expect(fichas?.dominio).toEqual(['|', ['id', 'in', [10]], ['partner_id', 'in', [101]], ['active', 'in', [true, false]]]);
	});

	it('junta o estado do POS ao cartão da rota', async () => {
		const { leitor } = leitorFalso({
			'res.delivery.route': [rota(1, 'PTABF_BF000001', 50), rota(2, 'PTABF_BF000002', 50), rota(3, 'PTABF_BF000003', 50)],
			'resource.calendar': [{ id: 50, name: 't', shift_name: 't' }],
			'pos.order': [
				{ id: 7, partner_id: [101, 'x'], date_order: '2026-01-15 18:40:00', name: 'E1', total_in_kg: 0 },
				{ id: 8, partner_id: [102, 'x'], date_order: '2026-01-15 18:41:00', name: 'E2', total_in_kg: 0 },
			],
			// A linha traz o produto: é por ele que se distingue uma falta de um "sem excedente".
			'pos.order.line': [{ id: 1, order_id: [8, 'E2'], product_id: [27, 'Falta Injustificada'] }],
			'res.beneficiary': [
				{ id: 10, partner_id: [101, 'PTABF_BF000001'] },
				{ id: 20, partner_id: [102, 'PTABF_BF000002'] },
			],
		});

		const painel = await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);
		expect(painel.cartoes.map((c) => c.estado)).toEqual(['entregue', 'falta', 'por_entregar']);
	});

	/**
	 * **Quantas idas ao Odoo custa um refresh** — a propriedade que a arquitetura deste Worker mais
	 * protege. São 65 televisores de minuto a minuto contra uma base on-premise: uma leitura a mais
	 * aqui são dezenas de milhares de chamadas por dia.
	 *
	 * Sete leituras, e **cinco delas com cache**. Em regime, com as rotas, os turnos, as duas
	 * espécies de ficha e o catálogo quentes, sobram **duas** idas: a `pos.order` e a
	 * `pos.order.line`.
	 *
	 * **A sexta é a `res.support.partner`, e foi ela que os extras custaram.** Sem ela as entregas
	 * a parceiros de apoio não têm como aparecer — 1 220 encomendas na base, 12% das Entregas, que
	 * até aqui desapareciam sem deixar rasto. Tem cache longa, portanto em regime não custa ida
	 * nenhuma.
	 *
	 * **A latência são quatro round-trips.** As fichas passaram a depender das encomendas — é o
	 * `partner_id` delas que diz quem procurar —, e por isso já não correm ao lado da `pos.order`;
	 * correm ao lado da `pos.order.line`, que depende da mesma coisa.
	 */
	it('custa sete leituras, das quais cinco com cache, e só duas em regime', async () => {
		const { leitor, chamadas } = leitorFalso({
			'res.delivery.route': [rota(1, 'PTABF_BF000001', 50)],
			'resource.calendar': [{ id: 50, name: 't', shift_name: 't 18:00' }],
			'pos.order': [{ id: 7, partner_id: [101, 'x'], date_order: '2026-01-15 18:40:00', name: 'E1', total_in_kg: 12 }],
			'res.beneficiary': [{ id: 10, partner_id: [101, 'PTABF_BF000001'], active: true }],
			'product.product': [{ id: 37, default_code: 'OBS-SEM-EXC' }],
		});

		await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);

		expect(chamadas.map((c) => c.modelo)).toEqual([
			'res.delivery.route',
			'resource.calendar',
			'pos.order',
			'product.product',
			'res.beneficiary',
			'res.support.partner',
			'pos.order.line',
		]);

		const semCache = chamadas.filter((c) => c.opcoes.cache === undefined).map((c) => c.modelo);
		expect(semCache).toEqual(['pos.order', 'pos.order.line']);
	});

	it('mostra um turno de cada vez e não mistura as rotas dos outros', async () => {
		const { leitor } = leitorFalso({
			'res.delivery.route': [rota(1, 'PTABF_BF000001', 50), rota(2, 'PTABF_BF000002', 51)],
			'resource.calendar': [
				{ id: 50, name: 'A', shift_name: 'A 18:00' },
				{ id: 51, name: 'B', shift_name: 'B 20:00' },
			],
		});

		const primeiro = await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);
		expect(primeiro.turnos).toHaveLength(2);
		expect(primeiro.cartoes.map((c) => c.etiqueta)).toEqual(['B1']);

		const segundo = await montarPainel(contextoFalso(leitor, { dia: QUINTA, turno: 51 }), AGORA);
		expect(segundo.turno?.id).toBe(51);
		expect(segundo.cartoes.map((c) => c.etiqueta)).toEqual(['B2']);
	});

	it('cai no primeiro turno quando o turno pedido não existe nesse dia', async () => {
		const { leitor } = leitorFalso({
			'res.delivery.route': [rota(1, 'PTABF_BF000001', 50)],
			'resource.calendar': [{ id: 50, name: 'A', shift_name: 'A 18:00' }],
		});

		const painel = await montarPainel(contextoFalso(leitor, { dia: QUINTA, turno: 999 }), AGORA);
		expect(painel.turno?.id).toBe(50);
	});

	it('sem dia pedido, mostra o dia Refood de agora', async () => {
		const { leitor } = leitorFalso({});
		const painel = await montarPainel(contextoFalso(leitor), AGORA);

		expect(painel.dia).toBe(QUINTA);
		expect(painel.relacao).toBe('hoje');
		expect(painel.nomeDoDia).toBe('quinta-feira');
	});

	it('a navegação alcança sete dias para a frente e nenhum para trás', async () => {
		const { leitor } = leitorFalso({});

		const hoje = await montarPainel(contextoFalso(leitor), AGORA);
		expect(hoje.podeRecuar).toBe(false);
		expect(hoje.podeAvancar).toBe(true);

		const limite = await montarPainel(contextoFalso(leitor, { dia: '2026-01-22' }), AGORA);
		expect(limite.podeAvancar).toBe(false);
		expect(limite.relacao).toBe('daqui a 7 dias');

		// Fora da janela volta a hoje, em silêncio: um televisor não tem quem corrija um endereço.
		const fora = await montarPainel(contextoFalso(leitor, { dia: '2026-02-01' }), AGORA);
		expect(fora.dia).toBe(QUINTA);
	});

	it('não pede o POS quando o turno não tem rotas nenhumas', async () => {
		const { leitor, chamadas } = leitorFalso({});
		const painel = await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);

		expect(painel.cartoes).toEqual([]);
		expect(painel.turno).toBeNull();
		expect(chamadas.map((c) => c.modelo)).not.toContain('pos.order');
	});

	it('leva `fields` e `limit` em todas as leituras', async () => {
		const { leitor, chamadas } = leitorFalso({
			'res.delivery.route': [rota(1, 'PTABF_BF000001', 50)],
			'resource.calendar': [{ id: 50, name: 'A', shift_name: 'A' }],
			'pos.order': [{ id: 7, partner_id: [101, 'x'], date_order: '2026-01-15 18:40:00', name: 'E', total_in_kg: 0 }],
			'res.beneficiary': [{ id: 10, partner_id: [101, 'PTABF_BF000009'] }],
		});

		await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);

		expect(chamadas.length).toBeGreaterThan(0);
		for (const chamada of chamadas) {
			expect(chamada.opcoes.fields.length).toBeGreaterThan(0);
			expect(chamada.opcoes.limit).toBeGreaterThan(0);
		}
	});

	it('não devolve nome nenhum num cartão previsto — o campo existe e vem sempre vazio', async () => {
		const { leitor } = leitorFalso({
			'res.delivery.route': [rota(1, 'PTABF_BF000001', 50)],
			'resource.calendar': [{ id: 50, name: 'A', shift_name: 'A 18:00' }],
		});

		const painel = await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);
		expect(painel.cartoes[0]?.nome).toBeNull();
		expect(painel.cartoes[0]?.extra).toBe(false);
	});

	/* --------------------------------------------------------------- extras */

	/** Uma encomenda de Entregas a quem tem rota hoje, e a quem não tem. */
	function encomenda(id: number, parceiro: number, quando: string, kg = 0) {
		return { id, partner_id: [parceiro, 'PTABF_BF000001'] as [number, string], date_order: quando, name: `E${id}`, total_in_kg: kg };
	}

	describe('os extras', () => {
		/**
		 * O caso base: uma família sem rota nenhuma hoje que aparece no POS. **Ganha cartão, no fim
		 * da grelha, sem hora** — não estava na escala do dia, portanto não há hora combinada.
		 */
		it('dá cartão a uma entrega a quem não estava na escala do dia', async () => {
			const { leitor } = leitorFalso({
				'res.delivery.route': [rota(1, 'PTABF_BF000001', 50)],
				'resource.calendar': [{ id: 50, name: 'A', shift_name: 'A 18:00' }],
				'pos.order': [encomenda(7, 101, '2026-01-15 18:40:00', 12), encomenda(8, 202, '2026-01-15 19:10:00', 5)],
				'res.beneficiary': [
					{ id: 10, partner_id: [101, 'x'], number: 'PTABF_BF000001', active: true, adult_count: 2, child_count: 1, beneficiary_count: 3 },
					{ id: 88, partner_id: [202, 'x'], number: 'PTABF_BF000047', active: true, adult_count: 4, child_count: 0, beneficiary_count: 4 },
				],
			});

			const painel = await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);

			expect(painel.cartoes.map((c) => c.etiqueta)).toEqual(['B1', 'B47']);
			expect(painel.cartoes.map((c) => c.extra)).toEqual([false, true]);
			expect(painel.cartoes[1]?.hora).toBeNull();
			expect(painel.cartoes[1]?.estado).toBe('entregue');
			// As contagens vêm da ficha, porque não há rota de onde as copiar.
			expect(painel.cartoes[1]?.adultos).toBe(4);
			// E os quilos dos extras contam no total do turno: estão no ecrã.
			expect(painel.pesoTotal).toBe('17 kg');
		});

		/**
		 * **A comparação é contra as rotas do dia inteiro, não do turno visível.**
		 *
		 * Sem isto, uma família servida no turno das 18:00 aparecia lá com o cartão verde **e** no
		 * turno das 20:00 como extra — os mesmos quilos em dois cabeçalhos do mesmo dia.
		 */
		it('não trata como extra quem tem rota noutro turno do mesmo dia', async () => {
			const { leitor } = leitorFalso({
				'res.delivery.route': [rota(1, 'PTABF_BF000001', 50), rota(2, 'PTABF_BF000002', 51)],
				'resource.calendar': [
					{ id: 50, name: 'A', shift_name: 'A 18:00' },
					{ id: 51, name: 'B', shift_name: 'B 20:00' },
				],
				// A encomenda é do beneficiário da rota 2, que pertence ao turno 51.
				'pos.order': [encomenda(7, 202, '2026-01-15 20:30:00', 9)],
				'res.beneficiary': [
					{ id: 10, partner_id: [101, 'x'], number: 'PTABF_BF000001', active: true },
					{ id: 20, partner_id: [202, 'x'], number: 'PTABF_BF000002', active: true },
				],
			});

			// No turno das 18:00 não aparece nada de novo…
			const primeiro = await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);
			expect(primeiro.cartoes.map((c) => c.extra)).toEqual([false]);
			expect(primeiro.pesoTotal).toBeNull();

			// …e no das 20:00 é o cartão previsto que fica verde, não um extra ao lado dele.
			const segundo = await montarPainel(contextoFalso(leitor, { dia: QUINTA, turno: 51 }), AGORA);
			expect(segundo.cartoes.map((c) => c.extra)).toEqual([false]);
			expect(segundo.cartoes[0]?.estado).toBe('entregue');
			expect(segundo.pesoTotal).toBe('9 kg');
		});

		/**
		 * **Uma encomenda não tem turno**, e a atribuição é pela hora a que foi registada — o turno
		 * mais tardio que já tinha começado. Ver `turnoDoExtra`, em `pos.ts`.
		 */
		it('põe o extra no turno que já tinha começado quando foi registado', async () => {
			const respostas = {
				'res.delivery.route': [rota(1, 'PTABF_BF000001', 50), rota(2, 'PTABF_BF000002', 51)],
				'resource.calendar': [
					{ id: 50, name: 'A', shift_name: 'A 18:00' },
					{ id: 51, name: 'B', shift_name: 'B 20:00' },
				],
				// 20:30 em Lisboa, no inverno: depois de o turno das 20:00 ter aberto.
				'pos.order': [encomenda(7, 999, '2026-01-15 20:30:00', 4)],
				'res.beneficiary': [
					{ id: 10, partner_id: [101, 'x'], number: 'PTABF_BF000001', active: true },
					{ id: 20, partner_id: [202, 'x'], number: 'PTABF_BF000002', active: true },
					{ id: 99, partner_id: [999, 'x'], number: 'PTABF_BF000099', active: true },
				],
			};

			const primeiro = await montarPainel(contextoFalso(leitorFalso(respostas).leitor, { dia: QUINTA }), AGORA);
			expect(primeiro.cartoes.map((c) => c.extra)).toEqual([false]);

			const segundo = await montarPainel(contextoFalso(leitorFalso(respostas).leitor, { dia: QUINTA, turno: 51 }), AGORA);
			expect(segundo.cartoes.map((c) => c.etiqueta)).toEqual(['B2', 'B99']);
			expect(segundo.cartoes[1]?.extra).toBe(true);
		});

		/**
		 * **As entregas a parceiros de apoio deixam de desaparecer.** São 1 220 encomendas na base —
		 * 12% das Entregas —, e até aqui não casavam com nada: os parceiros de apoio não têm rotas.
		 *
		 * O cartão leva o número com a mesma forma dos outros (`P12`) e, onde uma família tem a hora
		 * e o agregado, **as duas primeiras palavras do nome** — um parceiro não tem nem uma coisa
		 * nem outra.
		 */
		it('dá cartão a uma entrega a um parceiro de apoio, com o número e o nome curto', async () => {
			const { leitor } = leitorFalso({
				'res.delivery.route': [rota(1, 'PTABF_BF000001', 50)],
				'resource.calendar': [{ id: 50, name: 'A', shift_name: 'A 18:00' }],
				'pos.order': [encomenda(7, 555, '2026-01-15 18:50:00', 30)],
				'res.beneficiary': [{ id: 10, partner_id: [101, 'x'], number: 'PTABF_BF000001', active: true }],
				'res.support.partner': [
					{ id: 4, partner_id: [555, 'PTABF_PA000012'], number: 'PTABF_PA000012', name: 'Centro Social Paroquial de Benfica' },
				],
			});

			const painel = await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);

			expect(painel.cartoes).toHaveLength(2);
			expect(painel.cartoes[1]?.etiqueta).toBe('P12');
			expect(painel.cartoes[1]?.nome).toBe('Centro Social');
			expect(painel.cartoes[1]?.extra).toBe(true);
			// Um parceiro não tem agregado: o espaço é do nome.
			expect(painel.cartoes[1]?.adultos).toBeNull();
			expect(painel.cartoes[1]?.pessoas).toBeNull();
			expect(painel.pesoTotal).toBe('30 kg');
		});

		/** Um televisor nunca mostra um registo arquivado — nem sequer o de um extra. */
		it('não faz cartão de um extra a uma ficha arquivada, e conta-o por identificar', async () => {
			const { leitor } = leitorFalso({
				'res.delivery.route': [rota(1, 'PTABF_BF000001', 50)],
				'resource.calendar': [{ id: 50, name: 'A', shift_name: 'A 18:00' }],
				'pos.order': [encomenda(7, 202, '2026-01-15 18:40:00', 25)],
				'res.beneficiary': [
					{ id: 10, partner_id: [101, 'x'], number: 'PTABF_BF000001', active: true },
					{ id: 88, partner_id: [202, 'x'], number: 'PTABF_BF000047', active: false },
				],
			});

			const painel = await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);

			expect(painel.cartoes).toHaveLength(1);
			// Os quilos não entram no total, porque não estão no ecrã…
			expect(painel.pesoTotal).toBeNull();
			// …e não desaparecem em silêncio: o cabeçalho di-lo.
			expect(painel.porIdentificar).toBe(1);
		});

		/** Um extra com falta é um extra à mesma — o que muda é o estado, não a natureza do cartão. */
		it('um extra com observação de falta fica com o estado falta e sem peso', async () => {
			const { leitor } = leitorFalso({
				'res.delivery.route': [rota(1, 'PTABF_BF000001', 50)],
				'resource.calendar': [{ id: 50, name: 'A', shift_name: 'A 18:00' }],
				'pos.order': [encomenda(7, 202, '2026-01-15 18:40:00', 12)],
				'pos.order.line': [{ id: 1, order_id: [7, 'E7'], product_id: [27, 'Falta Injustificada'] }],
				'res.beneficiary': [
					{ id: 10, partner_id: [101, 'x'], number: 'PTABF_BF000001', active: true },
					{ id: 88, partner_id: [202, 'x'], number: 'PTABF_BF000047', active: true },
				],
			});

			const painel = await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);

			expect(painel.cartoes[1]?.estado).toBe('falta');
			expect(painel.cartoes[1]?.extra).toBe(true);
			expect(painel.cartoes[1]?.peso).toBeNull();
			expect(painel.pesoTotal).toBeNull();
		});

		/** Os extras vão para o fim, e entre si pela ordem em que aconteceram. */
		it('ordena os extras pela hora do registo, e sempre depois dos previstos', async () => {
			const { leitor } = leitorFalso({
				'res.delivery.route': [rota(1, 'PTABF_BF000009', 50)],
				'resource.calendar': [{ id: 50, name: 'A', shift_name: 'A 18:00' }],
				'pos.order': [encomenda(7, 303, '2026-01-15 19:30:00'), encomenda(8, 202, '2026-01-15 18:20:00')],
				'res.beneficiary': [
					{ id: 10, partner_id: [101, 'x'], number: 'PTABF_BF000009', active: true },
					{ id: 88, partner_id: [202, 'x'], number: 'PTABF_BF000200', active: true },
					{ id: 99, partner_id: [303, 'x'], number: 'PTABF_BF000003', active: true },
				],
			});

			const painel = await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);

			// O B3 tem o número mais baixo dos três e mesmo assim vai a último: entre extras a
			// ordem é a do relógio, não a do número.
			expect(painel.cartoes.map((c) => c.etiqueta)).toEqual(['B9', 'B200', 'B3']);
		});

		/** Sem rotas não há turnos, e sem turnos não há onde pendurar um extra — nem se lê o POS. */
		it('num dia sem rotas nenhumas não lê o POS e não mostra extras', async () => {
			const { leitor, chamadas } = leitorFalso({});
			const painel = await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);

			expect(painel.cartoes).toEqual([]);
			expect(chamadas.map((c) => c.modelo)).not.toContain('pos.order');
		});
	});

	/**
	 * `start_hour` é um float no fuso do calendário, não um datetime. Passá-lo pelo `new Date` dava
	 * 1970 e o fuso da runtime por cima; o `9.5` tem de sair como `09:30` e mais nada.
	 */
	it('a hora do cartão sai do float do Odoo', async () => {
		const { leitor } = leitorFalso({
			'res.delivery.route': [rota(1, 'PTABF_BF000001', 50, { start_hour: 9.5 }), rota(2, 'PTABF_BF000002', 50, { start_hour: false })],
			'resource.calendar': [{ id: 50, name: 'A', shift_name: 'A' }],
		});

		const painel = await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);
		expect(painel.cartoes.map((c) => c.hora)).toEqual(['09:30', null]);
	});
});
