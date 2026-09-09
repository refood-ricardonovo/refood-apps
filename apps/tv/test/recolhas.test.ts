import { describe, expect, it } from 'vitest';
import { etiquetaDaFonte, horaRecomendada, montarPainel, ordemDaFonte, texto } from '../src/recolhas';
import { LINGUA_DA_TV, type ContextoTv, type LeitorDoNucleo, type OpcoesLeitura, type VistaPedida } from '../src/sessao';

const EMPRESA = 75;
/** Uma quinta-feira. `week_day` do Odoo: '3'. */
const QUINTA = '2026-01-15';
const AGORA = new Date('2026-01-15T10:00:00Z');

/** O nome mais comprido da base, 55 caracteres. Não é caso de laboratório. */
const NOME_MAIS_COMPRIDO = 'Supermercado Continente - Bom Dia - Gândara dos Olivais';

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

function contextoFalso(leitor: LeitorDoNucleo, vista: Partial<VistaPedida> = {}): ContextoTv {
	return {
		sessao: { dispositivo: 'dis_teste', empresa: EMPRESA },
		leitor,
		vista: { dia: null, turno: null, ...vista },
		lingua: LINGUA_DA_TV,
		agora: AGORA,
	};
}

function rota(id: number, fonte: number, calendario: number, extra: Record<string, unknown> = {}) {
	return {
		id,
		resource_calendar_id: [calendario, 'turno'] as [number, string],
		// **A etiqueta é o nome, não o código** — ao contrário do `partner_id` das encomendas.
		source_food_id: [fonte, 'Ribapão'] as [number, string],
		source_food_name: 'Ribapão',
		related_notes: 'Ligar para verificar se há excedentes.',
		hour: 9.5,
		start_hour: 9,
		...extra,
	};
}

/* ------------------------------------------------------------- conversões */

describe('a etiqueta da fonte', () => {
	it('tira o prefixo e os zeros à cabeça', () => {
		expect(etiquetaDaFonte('PTVNF_FA000017')).toBe('F17');
		expect(etiquetaDaFonte('PTVNF_FA000056')).toBe('F56');
		expect(ordemDaFonte('PTVNF_FA000017')).toBe(17);
	});

	it('aguenta espaço nas pontas e devolve null quando não há número', () => {
		expect(etiquetaDaFonte(' PTVNF_FA000017 ')).toBe('F17');
		expect(etiquetaDaFonte(false)).toBeNull();
		expect(etiquetaDaFonte('PTVNF_BF000017')).toBeNull();
		expect(etiquetaDaFonte(undefined)).toBeNull();
	});
});

describe('a hora recomendada', () => {
	it('é o hour, e não o start_hour', () => {
		expect(horaRecomendada(9.5, 9)).toBe('09:30');
		expect(horaRecomendada(18.25, 17)).toBe('18:15');
	});

	/**
	 * Zero é uma hora legítima — pode haver recolhas à meia-noite. O que marca "horário por
	 * preencher" é o par: `hour` e `start_hour` os dois a zero.
	 */
	it('aceita a meia-noite quando o intervalo diz que é a sério', () => {
		expect(horaRecomendada(0, 0.5)).toBe('00:00');
	});

	/**
	 * As 19 rotas da base com `hour = 0` têm todas `start_hour = 0` e intervalos como `00:00–20:50`.
	 * O `end_hour` nunca está a zero em lado nenhum, portanto não entra no critério.
	 */
	it('devolve null quando o hour e o start_hour estão os dois a zero', () => {
		expect(horaRecomendada(0, 0)).toBeNull();
		expect(horaRecomendada(false, false)).toBeNull();
	});
});

describe('os textos da ficha', () => {
	it('limpa e devolve null quando não há nada', () => {
		expect(texto('  Ribapão  ')).toBe('Ribapão');
		expect(texto('   ')).toBeNull();
		expect(texto(false)).toBeNull();
	});
});

/* -------------------------------------------------------------- o painel */

describe('montarPainel das recolhas', () => {
	it('pede as rotas do dia certo, com a regra do start_date, sem is_route_ongoing e só de fichas activas', async () => {
		const { leitor, chamadas } = leitorFalso({});
		await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);

		const rotas = chamadas.find((c) => c.modelo === 'res.collection.route');
		expect(rotas?.dominio).toEqual([
			['week_day', '=', '3'],
			['start_date', '<=', '2026-01-15 23:59:59'],
			['source_food_id.active', '=', true],
		]);
		expect((rotas?.dominio as unknown[][]).some((c) => c[0] === 'is_route_ongoing')).toBe(false);
	});

	/**
	 * **A fonte arquivada não faz cartão** — 28 rotas de 801 apontavam para fontes arquivadas, e foi
	 * isso que se viu num televisor: cartões com nome e com `—` no lugar do número, porque o nome vem
	 * da rota e o número da ficha, e a ficha arquivada não voltava da leitura.
	 */
	it('não faz cartão de uma fonte arquivada', async () => {
		const { leitor, chamadas } = leitorFalso({});
		await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);

		expect(chamadas.find((c) => c.modelo === 'res.collection.route')?.dominio).toContainEqual(['source_food_id.active', '=', true]);
	});

	/**
	 * **Lêem-se as linhas do POS, e presas à encomenda.**
	 *
	 * Este teste afirmava o contrário — que as recolhas nunca leriam linhas, porque "aqui não
	 * distinguem nada". Distinguem: a base tem 25 recolhas com falta desde 2024-10-31, que o painel
	 * mostrava com o visto verde. A ida ao Odoo a mais por refresh é o preço disso, e o que o teste
	 * protege agora é a cláusula: **a linha vai sempre presa ao `order_id`**, porque a
	 * `pos.order.line` não tem regra de registo por núcleo e soltá-la contornava o filtro da
	 * encomenda.
	 */
	it('lê pos.order.line presa ao order_id e à categoria das observações', async () => {
		const { leitor, chamadas } = leitorFalso({
			'res.collection.route': [rota(1, 100, 50)],
			'resource.calendar': [{ id: 50, name: 'a', shift_name: 'Quinta-Feira 09:00' }],
			'res.food.source': [{ id: 100, number: 'PTVNF_FA000017', partner_id: [900, 'PTVNF_FA000017'] }],
			'pos.order': [{ id: 7, partner_id: [900, 'x'], date_order: '2026-01-15 09:10:00', name: 'RVNF 26/00001', total_in_kg: 12 }],
		});

		await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);

		const linhas = chamadas.find((c) => c.modelo === 'pos.order.line');
		expect(linhas?.dominio).toEqual([
			['order_id', 'in', [7]],
			['product_id.pos_categ_id.name', '=', 'Observações'],
		]);
		expect(linhas?.opcoes.fields).toEqual(['order_id', 'product_id']);
	});

	/**
	 * **O custo de um refresh, e o que mudou.** Este painel fazia **uma** ida ao Odoo em regime;
	 * passa a fazer **duas**, e o que a compra são as faltas — não os quilos, que vêm no
	 * `total_in_kg` de uma leitura que já corria. A 65 ecrãs de minuto a minuto são até +93 mil
	 * chamadas por dia, medidas antes de se decidir pagá-las.
	 */
	it('custa seis leituras, das quais quatro com cache, e só duas em regime', async () => {
		const { leitor, chamadas } = leitorFalso({
			'res.collection.route': [rota(1, 100, 50)],
			'resource.calendar': [{ id: 50, name: 'a', shift_name: 'Quinta-Feira 09:00' }],
			'res.food.source': [{ id: 100, number: 'PTVNF_FA000017', partner_id: [900, 'PTVNF_FA000017'] }],
			'pos.order': [{ id: 7, partner_id: [900, 'x'], date_order: '2026-01-15 09:10:00', name: 'R1', total_in_kg: 12 }],
			'product.product': [{ id: 37, default_code: 'OBS-SEM-EXC' }],
		});

		await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);

		/*
		 * **Os extras não custaram leitura nenhuma neste painel, e custaram uma nas entregas.**
		 *
		 * A `res.food.source` já era lida, e a mesma leitura passou a responder às duas perguntas —
		 * quem tem rota hoje, e a quem pertencem os parceiros que aparecem no POS. Do lado das
		 * entregas há duas espécies de ficha do outro lado da encomenda, e a segunda é uma leitura
		 * nova.
		 *
		 * **O que mudou foi a ordem, não a conta.** A ficha depende agora das encomendas — é o
		 * `partner_id` delas que diz quem procurar —, e por isso deixou de correr ao lado da
		 * `pos.order` e passou a correr ao lado da `pos.order.line`, que depende da mesma coisa.
		 */
		expect(chamadas.map((c) => c.modelo)).toEqual([
			'res.collection.route',
			'resource.calendar',
			'pos.order',
			'product.product',
			'res.food.source',
			'pos.order.line',
		]);

		const semCache = chamadas.filter((c) => c.opcoes.cache === undefined).map((c) => c.modelo);
		expect(semCache).toEqual(['pos.order', 'pos.order.line']);
	});

	it('lê o POS pela caixa de Recolhas e liga pela ficha da fonte', async () => {
		const { leitor, chamadas } = leitorFalso({
			'res.collection.route': [rota(1, 100, 50)],
			'resource.calendar': [{ id: 50, name: 'a', shift_name: 'a 09:00' }],
			'res.food.source': [{ id: 100, number: 'PTVNF_FA000017', partner_id: [900, 'PTVNF_FA000017'] }],
			'pos.order': [{ id: 7, partner_id: [900, 'x'], name: 'R' }],
		});

		await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);

		expect(chamadas.find((c) => c.modelo === 'pos.order')?.dominio).toEqual([
			['session_id.config_id.pos_type', '=', 'collections'],
			['date_order', '>=', '2026-01-15 03:00:00'],
			['date_order', '<', '2026-01-16 03:00:00'],
		]);
		// **Não há leitura ao `res.partner`.** O `company_id` dele é opcional no Odoo, e o âmbito
		// que o leitor acrescenta a toda a consulta descartava os espelhos que o têm vazio — 47 em
		// 68 no núcleo onde isto foi dado. A ligação faz-se pelo `partner_id` da `res.food.source`,
		// onde o `company_id` é obrigatório.
		expect(chamadas.map((c) => c.modelo)).not.toContain('res.partner');
	});

	it('marca recolhido quando existe encomenda, e uma fonte com duas conta uma vez', async () => {
		const { leitor } = leitorFalso({
			'res.collection.route': [rota(1, 100, 50), rota(2, 200, 50)],
			'resource.calendar': [{ id: 50, name: 'a', shift_name: 'a 09:00' }],
			'res.food.source': [
				{ id: 100, number: 'PTVNF_FA000017', partner_id: [900, 'PTVNF_FA000017'] },
				{ id: 200, number: 'PTVNF_FA000018', partner_id: [901, 'PTVNF_FA000018'] },
			],
			'pos.order': [
				{ id: 7, partner_id: [900, 'x'], name: 'R1' },
				{ id: 8, partner_id: [900, 'x'], name: 'R2' },
			],
		});

		const painel = await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);
		expect(painel.cartoes.map((c) => c.estado)).toEqual(['recolhido', 'por_recolher']);
	});

	it('ignora os estornos', async () => {
		const { leitor } = leitorFalso({
			'res.collection.route': [rota(1, 100, 50)],
			'resource.calendar': [{ id: 50, name: 'a', shift_name: 'a 09:00' }],
			'res.food.source': [{ id: 100, number: 'PTVNF_FA000017', partner_id: [900, 'PTVNF_FA000017'] }],
			'pos.order': [{ id: 7, partner_id: [900, 'x'], name: 'RVNF 26/00001 REEMBOLSAR' }],
		});

		const painel = await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);
		expect(painel.cartoes[0]?.estado).toBe('por_recolher');
	});

	/**
	 * O número não está na rota — ao contrário das entregas, onde a rota traz o do beneficiário — e
	 * o espelho é o que liga a fonte ao POS. São as duas razões de sempre para tocar na
	 * `res.food.source`; a terceira, o `name`, é o que um cartão de extra tem para mostrar, por não
	 * ter rota nenhuma de onde copiar o nome.
	 */
	it('vai buscar o número, o nome e o espelho à ficha, por id e com cache', async () => {
		const { leitor, chamadas } = leitorFalso({
			'res.collection.route': [rota(1, 100, 50), rota(2, 200, 50)],
			'resource.calendar': [{ id: 50, name: 'a', shift_name: 'a 09:00' }],
			'res.food.source': [
				{ id: 100, number: 'PTVNF_FA000017', partner_id: [900, 'PTVNF_FA000017'] },
				{ id: 200, number: 'PTVNF_FA000009', partner_id: [901, 'PTVNF_FA000009'] },
			],
		});

		const painel = await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);

		/*
		 * A ficha lê-se **incluindo arquivadas**, e não é para as mostrar: quem as filtra é a
		 * cláusula na rota. Isto cobre a janela entre as duas caches — rotas 5 minutos, fichas 15 —,
		 * em que a lista de rotas em cache ainda traz uma fonte arquivada há minutos. Sem isto, o
		 * cartão aparecia nesse intervalo com `—` em vez do número.
		 */
		const ficha = chamadas.find((c) => c.modelo === 'res.food.source');
		// **Uma leitura, duas perguntas — daí o `|`.** Pelo `id`, as fontes com rota no dia; pelo
		// `partner_id`, as que aparecem no POS sem terem rota, que são os extras. Aqui não há
		// encomendas nenhumas, e por isso a segunda lista vem vazia.
		expect(ficha?.dominio).toEqual(['|', ['id', 'in', [100, 200]], ['partner_id', 'in', []], ['active', 'in', [true, false]]]);
		expect(ficha?.opcoes.fields).toEqual(['number', 'name', 'active', 'partner_id']);
		expect(ficha?.opcoes.cache).toBeGreaterThan(0);
		// E ordena pelo número, não pela ordem em que o Odoo devolveu as rotas.
		expect(painel.cartoes.map((c) => c.etiqueta)).toEqual(['F9', 'F17']);
	});

	it('mostra o nome que vem da rota, e o cartão sobrevive a uma fonte sem número', async () => {
		const { leitor } = leitorFalso({
			'res.collection.route': [rota(1, 100, 50, { source_food_name: NOME_MAIS_COMPRIDO }), rota(2, 200, 50)],
			'resource.calendar': [{ id: 50, name: 'a', shift_name: 'a 09:00' }],
			'res.food.source': [{ id: 200, number: 'PTVNF_FA000018', partner_id: [901, 'PTVNF_FA000018'] }],
		});

		const painel = await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);

		// Sem número vai para o fim, mas continua no ecrã: uma fonte que desaparece é uma recolha
		// que ninguém faz.
		expect(painel.cartoes.map((c) => c.etiqueta)).toEqual(['F18', null]);
		expect(painel.cartoes[1]?.nome).toBe(NOME_MAIS_COMPRIDO);
	});

	// Texto livre não vai para um televisor: a nota da rota não é pedida ao Odoo e não chega ao
	// cartão. A rota falsa traz uma `related_notes` preenchida de propósito — se algum dia o campo
	// voltar a ser lido, é aqui que se vê.
	it('não pede nem devolve a nota da rota', async () => {
		const { leitor, chamadas } = leitorFalso({
			'res.collection.route': [rota(1, 100, 50)],
			'resource.calendar': [{ id: 50, name: 'a', shift_name: 'a 09:00' }],
			'res.food.source': [{ id: 100, number: 'PTVNF_FA000017', partner_id: [900, 'PTVNF_FA000017'] }],
		});

		const painel = await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);

		const daRota = chamadas.find((c) => c.modelo === 'res.collection.route');
		expect(daRota?.opcoes.fields).not.toContain('related_notes');
		expect(JSON.stringify(painel.cartoes)).not.toContain('excedentes');
	});

	/**
	 * **A ficha lê-se uma vez só, e para quatro campos.**
	 *
	 * Este teste dizia que o `name` nunca seria pedido — e valia enquanto o nome vinha sempre da
	 * rota. Um extra não tem rota, e ou o nome sai da ficha ou o cartão fica com o número sozinho
	 * numa área onde o nome é metade do identificador. Continua a não sair nada mais: a ficha tem
	 * morada, contactos, geolocalização e imagens, e nenhum deles atravessa esta leitura.
	 */
	it('lê a res.food.source uma vez só, e não lhe pede mais do que o cartão mostra', async () => {
		const { leitor, chamadas } = leitorFalso({
			'res.collection.route': [rota(1, 100, 50)],
			'resource.calendar': [{ id: 50, name: 'a', shift_name: 'a 09:00' }],
			'res.food.source': [{ id: 100, number: 'PTVNF_FA000017', partner_id: [900, 'PTVNF_FA000017'] }],
			'pos.order': [{ id: 7, partner_id: [900, 'x'], date_order: '2026-01-15 09:10:00', name: 'R', total_in_kg: 5 }],
		});

		await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);

		const daFicha = chamadas.filter((c) => c.modelo === 'res.food.source');
		expect(daFicha).toHaveLength(1);
		expect(daFicha[0]?.opcoes.fields).toEqual(['number', 'name', 'active', 'partner_id']);
	});

	it('leva fields e limit em todas as leituras', async () => {
		const { leitor, chamadas } = leitorFalso({
			'res.collection.route': [rota(1, 100, 50)],
			'resource.calendar': [{ id: 50, name: 'a', shift_name: 'a 09:00' }],
			'res.food.source': [{ id: 100, number: 'PTVNF_FA000017', partner_id: [900, 'PTVNF_FA000017'] }],
			'pos.order': [{ id: 7, partner_id: [900, 'x'], name: 'R' }],
			'res.partner': [{ id: 900, food_source_id: [100, 'x'] }],
		});

		await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);

		expect(chamadas.length).toBeGreaterThan(0);
		for (const chamada of chamadas) {
			expect(chamada.opcoes.fields.length).toBeGreaterThan(0);
			expect(chamada.opcoes.limit).toBeGreaterThan(0);
		}
	});

	/* --------------------------------------------------------------- extras */

	describe('os extras', () => {
		function fonte(id: number, numero: string, parceiro: number, extra: Record<string, unknown> = {}) {
			return { id, number: numero, name: 'Ribapão', active: true, partner_id: [parceiro, numero] as [number, string], ...extra };
		}

		function encomenda(id: number, parceiro: number, quando: string, kg = 0) {
			return { id, partner_id: [parceiro, 'x'] as [number, string], date_order: quando, name: `R${id}`, total_in_kg: kg };
		}

		/**
		 * Uma recolha a uma fonte que não estava na escala do dia. **Ganha cartão, no fim e sem
		 * hora** — a hora dos cartões previstos é a hora *recomendada* da recolha, e um extra não
		 * tem nenhuma.
		 */
		it('dá cartão a uma recolha a quem não estava na escala do dia', async () => {
			const { leitor } = leitorFalso({
				'res.collection.route': [rota(1, 100, 50)],
				'resource.calendar': [{ id: 50, name: 'a', shift_name: 'a 09:00' }],
				'res.food.source': [fonte(100, 'PTVNF_FA000017', 900), fonte(200, 'PTVNF_FA000056', 901, { name: 'Pingo Doce Cova' })],
				'pos.order': [encomenda(7, 900, '2026-01-15 09:20:00', 12), encomenda(8, 901, '2026-01-15 10:30:00', 8)],
			});

			const painel = await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);

			expect(painel.cartoes.map((c) => c.etiqueta)).toEqual(['F17', 'F56']);
			expect(painel.cartoes.map((c) => c.extra)).toEqual([false, true]);
			expect(painel.cartoes[1]?.hora).toBeNull();
			// O nome de um extra vem da ficha, porque não há rota de onde o copiar.
			expect(painel.cartoes[1]?.nome).toBe('Pingo Doce Cova');
			expect(painel.cartoes[1]?.estado).toBe('recolhido');
			expect(painel.pesoTotal).toBe('20 kg');
		});

		/** A mesma regra das entregas: a comparação é contra as rotas do dia todo. */
		it('não trata como extra uma fonte com rota noutro turno do mesmo dia', async () => {
			const { leitor } = leitorFalso({
				'res.collection.route': [rota(1, 100, 50), rota(2, 200, 51)],
				'resource.calendar': [
					{ id: 50, name: 'a', shift_name: 'a 09:00' },
					{ id: 51, name: 'b', shift_name: 'b 17:00' },
				],
				'res.food.source': [fonte(100, 'PTVNF_FA000017', 900), fonte(200, 'PTVNF_FA000056', 901)],
				'pos.order': [encomenda(7, 901, '2026-01-15 17:40:00', 9)],
			});

			const primeiro = await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);
			expect(primeiro.cartoes.map((c) => c.extra)).toEqual([false]);
			expect(primeiro.pesoTotal).toBeNull();

			const segundo = await montarPainel(contextoFalso(leitor, { dia: QUINTA, turno: 51 }), AGORA);
			expect(segundo.cartoes.map((c) => c.extra)).toEqual([false]);
			expect(segundo.cartoes[0]?.estado).toBe('recolhido');
		});

		/**
		 * **Um extra exige ficha activa e com número.**
		 *
		 * O `active` porque um televisor nunca mostra um registo arquivado; o `number` porque é o
		 * que separa uma fonte de um contacto da fonte — 125 em 999, e nada no modelo os marca de
		 * outra maneira. Os dois casos contam por identificar, para os quilos não sumirem calados.
		 */
		it('recusa um extra a uma ficha arquivada ou sem número, e conta-o por identificar', async () => {
			const { leitor } = leitorFalso({
				'res.collection.route': [rota(1, 100, 50)],
				'resource.calendar': [{ id: 50, name: 'a', shift_name: 'a 09:00' }],
				'res.food.source': [
					fonte(100, 'PTVNF_FA000017', 900),
					fonte(200, 'PTVNF_FA000056', 901, { active: false }),
					{ id: 300, number: false, name: 'Um contacto da fonte', active: true, partner_id: [902, 'x'] as [number, string] },
				],
				'pos.order': [encomenda(8, 901, '2026-01-15 10:00:00', 40), encomenda(9, 902, '2026-01-15 10:05:00', 15)],
			});

			const painel = await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);

			expect(painel.cartoes).toHaveLength(1);
			expect(painel.pesoTotal).toBeNull();
			expect(painel.porIdentificar).toBe(2);
		});

		/** Os extras vão para o fim, e entre si pela hora do registo. */
		it('põe os extras depois dos previstos, mesmo com a grelha ordenada pela hora', async () => {
			const { leitor } = leitorFalso({
				'res.collection.route': [rota(1, 100, 50, { hour: 18 })],
				'resource.calendar': [{ id: 50, name: 'a', shift_name: 'a 09:00' }],
				'res.food.source': [fonte(100, 'PTVNF_FA000017', 900), fonte(200, 'PTVNF_FA000056', 901)],
				// Registada às 09:20 — antes da hora recomendada do cartão previsto, que é 18:00.
				'pos.order': [encomenda(8, 901, '2026-01-15 09:20:00', 8)],
			});

			const painel = await montarPainel(contextoFalso(leitor, { dia: QUINTA }), AGORA);

			// A hora do previsto é a **recomendada**; a do extra é a do registo. São grandezas
			// diferentes com o mesmo aspecto, e não se misturam numa sequência só.
			expect(painel.cartoes.map((c) => c.etiqueta)).toEqual(['F17', 'F56']);
			expect(painel.cartoes.map((c) => c.extra)).toEqual([false, true]);
		});
	});

	it('a navegação por dia é a mesma das entregas', async () => {
		const { leitor } = leitorFalso({});

		const hoje = await montarPainel(contextoFalso(leitor), AGORA);
		expect(hoje.dia).toBe(QUINTA);
		expect(hoje.podeRecuar).toBe(false);

		const fora = await montarPainel(contextoFalso(leitor, { dia: '2026-02-01' }), AGORA);
		expect(fora.dia).toBe(QUINTA);
	});
});
