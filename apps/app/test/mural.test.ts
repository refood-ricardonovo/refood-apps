import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rotaMural, rotaReiniciarMural } from '../src/mural';
import { novaBase, type D1Falso } from './d1-falso';

type Mural = { nucleos: { nucleo: string; total: number }[]; total: number; novos: string[]; agora: string };

/** O mesmo Odoo de mentira do `entrar.test.ts`: JSON-RPC, com o cliente a sério por cima. */
function odooFalso(porModelo: Record<string, unknown[]>) {
	const chamadas: { modelo: string; metodo: string; args: unknown[]; kwargs: Record<string, unknown> }[] = [];

	const stub = vi.fn(async (_url: string, init: RequestInit) => {
		const corpo = JSON.parse(init.body as string) as { params: { service: string; args: unknown[] } };
		if (corpo.params.service === 'common') return Response.json({ jsonrpc: '2.0', id: 1, result: 7 });

		const [, , , modelo, metodo, args, kwargs] = corpo.params.args as [
			string,
			number,
			string,
			string,
			string,
			unknown[],
			Record<string, unknown>,
		];
		chamadas.push({ modelo, metodo, args, kwargs });

		return Response.json({ jsonrpc: '2.0', id: 1, result: porModelo[`${modelo}.${metodo}`] ?? porModelo[modelo] ?? [] });
	});

	return { stub, chamadas };
}

function envDe(base: D1Falso, aberta = 'aberta'): Env {
	return {
		DB: base as unknown as D1Database,
		ODOO_URL: 'https://odoo.invalido',
		ODOO_DB: 'teste',
		ODOO_USERNAME: 'integracao',
		ODOO_PASSWORD: 'x',
		ENTRADA_ABERTA: aberta,
	} as unknown as Env;
}

async function inserir(base: D1Falso, employeeId: number, companyId: number, quando: string) {
	await base
		.prepare('INSERT INTO presencas_demo (employee_id, company_id, criado_em) VALUES (?, ?, ?)')
		.bind(employeeId, companyId, quando)
		.run();
}

const pedir = (desde?: string) =>
	new Request(desde ? `https://app.invalido/api/mural?desde=${encodeURIComponent(desde)}` : 'https://app.invalido/api/mural');

const RESPOSTAS_BASE = {
	'res.users': [{ id: 7, company_ids: [75, 76] }],
	'res.company': [
		{ id: 75, name: 'Refood Benfica' },
		{ id: 76, name: 'Refood Almada' },
	],
};

/** Datas claramente no passado: a janela é `(desde, agora]`, e um registo no futuro fica de fora. */
const T = (segundos: number) => `2026-01-15T18:0${segundos}:00.000Z`;

describe('GET /api/mural', () => {
	let base: D1Falso;

	beforeEach(() => {
		base = novaBase();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('sem ninguém, devolve vazio e não incomoda o Odoo', async () => {
		const { stub } = odooFalso({});
		vi.stubGlobal('fetch', stub);

		const corpo = (await (await rotaMural(pedir(), envDe(base))).json()) as { mural: Mural };

		expect(corpo.mural.nucleos).toEqual([]);
		expect(corpo.mural.total).toBe(0);
		expect(stub).not.toHaveBeenCalled();
	});

	/**
	 * **O mural obedece ao mesmo interruptor da entrada.** Sem isto continuava a servir a lista de
	 * quem lá esteve depois de a apresentação acabar, num endereço público e sem autenticação.
	 */
	it('com a entrada fechada devolve vazio, mesmo com gente na tabela', async () => {
		await inserir(base, 42, 75, T(0));
		const { stub } = odooFalso({ 'hr.employee': [{ id: 42, full_name: 'Maria Costa', company_id: [75, 'x'] }] });
		vi.stubGlobal('fetch', stub);

		const corpo = (await (await rotaMural(pedir(), envDe(base, ''))).json()) as { mural: Mural };

		expect(corpo.mural.total).toBe(0);
		expect(stub).not.toHaveBeenCalled();
	});

	/**
	 * **O corpo fechado tem de trazer as quatro chaves que a página lê.**
	 *
	 * Fechado é o estado normal a partir do dia seguinte à apresentação, e o `/mural` fica público em
	 * produção — portanto a resposta fechada é a que aquela página vê quase sempre. Com as quatro
	 * chaves presentes ela desenha uma coluna vazia e o "À espera…", e não parte; se alguém
	 * "simplificar" isto para `{}` daqui a seis meses, é aqui que rebenta e não no projector.
	 */
	it('o corpo fechado traz as quatro chaves que a página lê', async () => {
		await inserir(base, 42, 75, T(0));
		const { stub } = odooFalso({});
		vi.stubGlobal('fetch', stub);

		const corpo = (await (await rotaMural(pedir(), envDe(base, ''))).json()) as { mural: Mural };

		expect(Object.keys(corpo.mural).sort()).toEqual(['agora', 'novos', 'nucleos', 'total']);
		expect(corpo.mural.nucleos).toEqual([]);
		expect(corpo.mural.novos).toEqual([]);
		expect(Date.parse(corpo.mural.agora)).not.toBeNaN();
	});

	/**
	 * **A primeira sonda não traz nomes, e não é um caso por tratar.** A nuvem é o que está a
	 * acontecer; a coluna é o estado. Quem abre o mural a meio vê as contagens certas de toda a
	 * gente e não vê passar quem já entrou — porque isso já aconteceu.
	 */
	it('a primeira sonda traz contagens e cursor, e nenhum nome', async () => {
		await inserir(base, 42, 75, T(0));
		await inserir(base, 43, 75, T(1));

		const { stub, chamadas } = odooFalso({ ...RESPOSTAS_BASE, 'hr.employee': [] });
		vi.stubGlobal('fetch', stub);

		const corpo = (await (await rotaMural(pedir(), envDe(base))).json()) as { mural: Mural };

		expect(corpo.mural.total).toBe(2);
		expect(corpo.mural.novos).toEqual([]);
		expect(Date.parse(corpo.mural.agora)).not.toBeNaN();

		// Nem sequer se lê `hr.employee`: não há nomes a traduzir.
		expect(chamadas.some((c) => c.modelo === 'hr.employee')).toBe(false);
	});

	it('com cursor, traz só quem entrou depois dele, por ordem de chegada', async () => {
		await inserir(base, 42, 75, T(0));
		await inserir(base, 43, 76, T(2));
		await inserir(base, 44, 75, T(3));

		const { stub, chamadas } = odooFalso({
			...RESPOSTAS_BASE,
			// O `read` não garante ordem: vem ao contrário de propósito.
			'hr.employee': [
				{ id: 44, full_name: 'Rita Nunes', company_id: [75, 'x'] },
				{ id: 43, full_name: 'João Pedro Silva', company_id: [76, 'x'] },
			],
		});
		vi.stubGlobal('fetch', stub);

		const corpo = (await (await rotaMural(pedir(T(1)), envDe(base))).json()) as { mural: Mural };

		expect(corpo.mural.novos).toEqual(['João', 'Rita']);

		// Só os novos vão ao Odoo — o que entrou antes do cursor não é relido a cada sonda.
		const leitura = chamadas.find((c) => c.modelo === 'hr.employee');
		expect(leitura?.metodo).toBe('read');
		expect(leitura?.args[0]).toEqual([43, 44]);
		// **Sem âmbito no contexto**, como na rota de entrada: o tecto é o da conta e é o Odoo que o
		// impõe; um contexto só o podia estreitar, aqui até esconder o nome de quem está na sala.
		expect((leitura?.kwargs.context as Record<string, unknown>)?.allowed_company_ids).toBeUndefined();
	});

	/** Só o primeiro nome: é um projector numa sala com gente que não é dali. */
	it('mostra só o primeiro nome, nunca o apelido', async () => {
		await inserir(base, 42, 75, T(2));
		const { stub } = odooFalso({
			...RESPOSTAS_BASE,
			'hr.employee': [{ id: 42, full_name: 'Maria Fernanda da Costa', company_id: [75, 'x'] }],
		});
		vi.stubGlobal('fetch', stub);

		const corpo = (await (await rotaMural(pedir(T(1)), envDe(base))).json()) as { mural: Mural };

		expect(corpo.mural.novos).toEqual(['Maria']);
		expect(JSON.stringify(corpo)).not.toContain('Costa');
	});

	/**
	 * **A ordem dos núcleos é a da chegada do primeiro voluntário de cada um**, e não a alfabética:
	 * é a ordem em que a sala se encheu. Benfica entra depois de Almada e aparece depois.
	 */
	it('ordena os núcleos pela chegada do primeiro de cada um', async () => {
		await inserir(base, 50, 76, T(1)); // Almada primeiro
		await inserir(base, 51, 75, T(2)); // Benfica a seguir
		await inserir(base, 52, 76, T(3));

		const { stub } = odooFalso({ ...RESPOSTAS_BASE, 'hr.employee': [] });
		vi.stubGlobal('fetch', stub);

		const corpo = (await (await rotaMural(pedir(), envDe(base))).json()) as { mural: Mural };

		expect(corpo.mural.nucleos).toEqual([
			{ nucleo: 'Refood Almada', total: 2 },
			{ nucleo: 'Refood Benfica', total: 1 },
		]);
	});

	/**
	 * **A contagem conta todos os que entraram, sem excepção.**
	 *
	 * Sai do `GROUP BY` e não da leitura ao Odoo: quem entrou e cuja ficha não devolve nome legível
	 * conta na mesma — só não aparece na nuvem. A versão anterior deitava essa pessoa fora das duas
	 * coisas, e ninguém dava por ela.
	 */
	it('conta quem entrou mesmo que a ficha não devolva nome', async () => {
		await inserir(base, 42, 75, T(2));
		await inserir(base, 43, 75, T(3));

		// O Odoo só devolve uma das duas fichas, e sem nome nenhum.
		const { stub } = odooFalso({ ...RESPOSTAS_BASE, 'hr.employee': [{ id: 42, full_name: false, name: false, company_id: [75, 'x'] }] });
		vi.stubGlobal('fetch', stub);

		const corpo = (await (await rotaMural(pedir(T(1)), envDe(base))).json()) as { mural: Mural };

		expect(corpo.mural.total).toBe(2);
		expect(corpo.mural.nucleos[0]?.total).toBe(2);
		expect(corpo.mural.novos).toEqual([]);
	});

	/**
	 * **A janela é `(desde, agora]`**, e o `agora` é o cursor devolvido: duas sondas seguidas
	 * encostam uma na outra sem buraco. Quem entrou depois do `agora` fica para a sonda seguinte.
	 */
	it('não traz quem entrou depois do instante do pedido', async () => {
		await inserir(base, 42, 75, T(1));
		await inserir(base, 43, 75, '2099-01-01T00:00:00.000Z');

		const { stub } = odooFalso({
			...RESPOSTAS_BASE,
			'hr.employee': [
				{ id: 42, full_name: 'Maria Costa', company_id: [75, 'x'] },
				{ id: 43, full_name: 'Futuro Improvável', company_id: [75, 'x'] },
			],
		});
		vi.stubGlobal('fetch', stub);

		const corpo = (await (await rotaMural(pedir(T(0)), envDe(base))).json()) as { mural: Mural };

		expect(corpo.mural.novos).toEqual(['Maria']);
		// Mas conta, porque a contagem é de toda a tabela.
		expect(corpo.mural.total).toBe(2);
	});

	/** Nada no D1 identifica ninguém: dois inteiros e uma data. Este teste guarda essa fronteira. */
	it('a tabela não guarda nome nenhum', async () => {
		await inserir(base, 42, 75, T(0));

		const { results } = await base.prepare('SELECT * FROM presencas_demo').all();
		expect(Object.keys(results[0] as object).sort()).toEqual(['company_id', 'criado_em', 'employee_id']);
	});
});

describe('POST /api/mural/reiniciar', () => {
	let base: D1Falso;

	beforeEach(() => {
		base = novaBase();
	});

	it('esvazia a tabela', async () => {
		await inserir(base, 42, 75, T(0));
		await rotaReiniciarMural(envDe(base));

		const { results } = await base.prepare('SELECT COUNT(*) AS n FROM presencas_demo').all<{ n: number }>();
		expect(results[0]?.n).toBe(0);
	});

	/** Fechada a entrada não há sessão para reiniciar, e uma tabela não se apaga por um endereço. */
	it('com a entrada fechada não apaga nada', async () => {
		await inserir(base, 42, 75, T(0));
		const resposta = await rotaReiniciarMural(envDe(base, ''));

		expect(resposta.status).toBe(404);
		const { results } = await base.prepare('SELECT COUNT(*) AS n FROM presencas_demo').all<{ n: number }>();
		expect(results[0]?.n).toBe(1);
	});
});
