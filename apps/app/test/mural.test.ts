import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rotaMural, rotaReiniciarMural } from '../src/mural';
import { novaBase, type D1Falso } from './d1-falso';

type Mural = { nucleos: { nucleo: string; nomes: string[] }[]; total: number };

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

const NUCLEOS = [
	{ id: 75, name: 'Refood Benfica' },
	{ id: 76, name: 'Refood Almada' },
];

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

		const corpo = (await (await rotaMural(envDe(base))).json()) as { mural: Mural };

		expect(corpo.mural).toEqual({ nucleos: [], total: 0 });
		expect(stub).not.toHaveBeenCalled();
	});

	/**
	 * **O mural obedece ao mesmo interruptor da entrada.** Sem isto continuava a servir a lista de
	 * quem lá esteve depois de a apresentação acabar, num endereço público e sem autenticação.
	 */
	it('com a entrada fechada devolve vazio, mesmo com gente na tabela', async () => {
		await inserir(base, 42, 75, '2026-09-10T18:00:00.000Z');
		const { stub } = odooFalso({ 'hr.employee': [{ id: 42, full_name: 'Maria Costa', company_id: [75, 'x'] }] });
		vi.stubGlobal('fetch', stub);

		const corpo = (await (await rotaMural(envDe(base, ''))).json()) as { mural: Mural };

		expect(corpo.mural.total).toBe(0);
		expect(stub).not.toHaveBeenCalled();
	});

	/**
	 * **Só o primeiro nome, e o D1 nunca guarda nomes.** Isto é um projector numa sala com gente que
	 * não é dali — mais exposto do que o telemóvel de quem escreveu o próprio NIF, e por isso mostra
	 * menos do que ele.
	 */
	it('agrupa por núcleo e mostra só o primeiro nome', async () => {
		await inserir(base, 42, 75, '2026-09-10T18:00:00.000Z');
		await inserir(base, 43, 76, '2026-09-10T18:01:00.000Z');

		const { stub, chamadas } = odooFalso({
			'res.users': [{ id: 7, company_ids: [75, 76] }],
			'res.company': NUCLEOS,
			'hr.employee': [
				{ id: 42, full_name: 'Maria Fernanda da Costa', company_id: [75, 'Refood Benfica'] },
				{ id: 43, full_name: 'João Pedro Silva', company_id: [76, 'Refood Almada'] },
			],
		});
		vi.stubGlobal('fetch', stub);

		const corpo = (await (await rotaMural(envDe(base))).json()) as { mural: Mural };

		expect(corpo.mural.nucleos).toEqual([
			{ nucleo: 'Refood Almada', nomes: ['João'] },
			{ nucleo: 'Refood Benfica', nomes: ['Maria'] },
		]);
		expect(corpo.mural.total).toBe(2);

		// Nem apelidos, nem inicial: o mural mostra menos do que o ecrã de entrada.
		const json = JSON.stringify(corpo);
		expect(json).not.toContain('Costa');
		expect(json).not.toContain('Silva');

		// Os nomes vêm por `read`, sobre ids que já eram nossos — não por uma pesquisa.
		const leitura = chamadas.find((c) => c.modelo === 'hr.employee');
		expect(leitura?.metodo).toBe('read');
		expect(leitura?.args[0]).toEqual([42, 43]);
		expect((leitura?.kwargs.context as Record<string, unknown>).allowed_company_ids).toEqual([75, 76]);
	});

	/** Só os núcleos que já têm alguém: a lista da esquerda cresce à medida que a sala entra. */
	it('não mostra núcleos vazios', async () => {
		await inserir(base, 42, 75, '2026-09-10T18:00:00.000Z');

		const { stub } = odooFalso({
			'res.users': [{ id: 7, company_ids: [75, 76] }],
			'res.company': NUCLEOS,
			'hr.employee': [{ id: 42, full_name: 'Maria Costa', company_id: [75, 'Refood Benfica'] }],
		});
		vi.stubGlobal('fetch', stub);

		const corpo = (await (await rotaMural(envDe(base))).json()) as { mural: Mural };

		expect(corpo.mural.nucleos.map((n) => n.nucleo)).toEqual(['Refood Benfica']);
	});

	/** Nada no D1 identifica ninguém: dois inteiros e uma data. Este teste guarda essa fronteira. */
	it('a tabela não guarda nome nenhum', async () => {
		await inserir(base, 42, 75, '2026-09-10T18:00:00.000Z');

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
		await inserir(base, 42, 75, '2026-09-10T18:00:00.000Z');
		await rotaReiniciarMural(envDe(base));

		const { results } = await base.prepare('SELECT COUNT(*) AS n FROM presencas_demo').all<{ n: number }>();
		expect(results[0]?.n).toBe(0);
	});

	/** Fechada a entrada não há sessão para reiniciar, e uma tabela não se apaga por um endereço. */
	it('com a entrada fechada não apaga nada', async () => {
		await inserir(base, 42, 75, '2026-09-10T18:00:00.000Z');
		const resposta = await rotaReiniciarMural(envDe(base, ''));

		expect(resposta.status).toBe(404);
		const { results } = await base.prepare('SELECT COUNT(*) AS n FROM presencas_demo').all<{ n: number }>();
		expect(results[0]?.n).toBe(1);
	});
});
