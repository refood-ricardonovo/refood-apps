import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { digitosDoNif, excedeTentativas, padraoFrouxo, rotaEntrar } from '../src/entrar';
import { novaBase, type D1Falso } from './d1-falso';

/* --------------------------------------------------------------- as puras */

describe('a normalização do NIF', () => {
	/**
	 * **Normalizar é tirar tudo o que não é dígito e exigir nove.** As 317 fichas activas cujo `vat`
	 * traz espaços pelo meio só casam assim, e — medido em staging, setembro de 2026 — não se cria
	 * uma única colisão nova: os 39 pares que colidem já colidiam com os valores tal como estão
	 * guardados.
	 */
	it('tira tudo o que não é dígito', () => {
		expect(digitosDoNif('123 456 789')).toBe('123456789');
		expect(digitosDoNif('123456789')).toBe('123456789');
		expect(digitosDoNif('123.456.789')).toBe('123456789');
	});

	it('recusa o que não fique com exactamente nove', () => {
		expect(digitosDoNif('12345678')).toBeNull();
		expect(digitosDoNif('1234567890')).toBeNull();
		expect(digitosDoNif('')).toBeNull();
		expect(digitosDoNif(null)).toBeNull();
		expect(digitosDoNif({ nif: '123456789' })).toBeNull();
	});
});

describe('o padrão da segunda passagem', () => {
	it('separa os dígitos por %', () => {
		expect(padraoFrouxo('123456789')).toBe('1%2%3%4%5%6%7%8%9');
	});

	/**
	 * **Sem `%` nas pontas, de propósito.** Um `%` à cabeça faria a pesquisa apanhar qualquer valor
	 * que contivesse estes nove dígitos pelo meio, e obrigava a base a percorrer a tabela toda.
	 */
	it('não põe % nas pontas', () => {
		const padrao = padraoFrouxo('123456789');
		expect(padrao.startsWith('%')).toBe(false);
		expect(padrao.endsWith('%')).toBe(false);
	});
});

describe('o travão por origem', () => {
	it('deixa passar dez num minuto e trava a décima primeira', () => {
		const agora = 1_000_000;
		const origem = `teste-${Math.random()}`;

		for (let i = 0; i < 10; i++) expect(excedeTentativas(origem, agora)).toBe(false);
		expect(excedeTentativas(origem, agora)).toBe(true);
	});

	it('a janela reabre passado um minuto', () => {
		const origem = `teste-${Math.random()}`;
		for (let i = 0; i < 11; i++) excedeTentativas(origem, 2_000_000);

		expect(excedeTentativas(origem, 2_060_001)).toBe(false);
	});

	it('uma origem não trava a outra', () => {
		const a = `teste-a-${Math.random()}`;
		const b = `teste-b-${Math.random()}`;

		for (let i = 0; i < 11; i++) excedeTentativas(a, 3_000_000);
		expect(excedeTentativas(b, 3_000_000)).toBe(false);
	});
});

/* ---------------------------------------------------------------- a rota */

/**
 * Um Odoo de mentira ao nível do JSON-RPC: o cliente a sério corre por cima, portanto o que estes
 * testes exercitam são os domínios, os `fields` e o contexto que ele monta de verdade.
 */
function odooFalso(porModelo: Record<string, unknown[]>) {
	const chamadas: { modelo: string; metodo: string; dominio: unknown; kwargs: Record<string, unknown> }[] = [];

	const stub = vi.fn(async (_url: string, init: RequestInit) => {
		const corpo = JSON.parse(init.body as string) as {
			params: { service: string; method: string; args: unknown[] };
		};

		// `common.authenticate` → o uid. Sem isto o cliente não passa da primeira chamada.
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
		chamadas.push({ modelo, metodo, dominio: args[0], kwargs });

		return Response.json({ jsonrpc: '2.0', id: 1, result: porModelo[`${modelo}.${metodo}`] ?? porModelo[modelo] ?? [] });
	});

	return { stub, chamadas };
}

const FICHA = {
	id: 42,
	name: 'Maria Fernanda da Costa',
	full_name: 'Maria Fernanda da Costa',
	company_id: [75, 'Refood Benfica'],
	barcode: 'PTABF000123_VL',
};

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

const pedir = (nif: unknown, ip = `1.2.3.${Math.floor(Math.random() * 250)}`) =>
	new Request('https://app-staging.myrefood.pt/api/entrar', {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip },
		body: JSON.stringify({ nif }),
	});

const RESPOSTAS_BASE = {
	'res.users': [{ id: 7, company_ids: [75, 76] }],
	'res.company': [{ id: 75, name: 'Refood Benfica' }],
};

describe('POST /api/entrar', () => {
	let base: D1Falso;

	beforeEach(() => {
		base = novaBase();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('recusa o que não são nove dígitos sem tocar no Odoo', async () => {
		const { stub } = odooFalso({});
		vi.stubGlobal('fetch', stub);

		const resposta = await rotaEntrar(pedir('12345'), envDe(base));

		expect(resposta.status).toBe(400);
		expect(stub).not.toHaveBeenCalled();
	});

	/**
	 * **Fechada responde exactamente como "não há ficha".** O corpo não diz em que estado é que o
	 * interruptor está — se dissesse, a página confirmava a quem perguntasse que a demonstração está
	 * a decorrer, e o interruptor existe precisamente para ela não confirmar nada.
	 */
	it('com a entrada fechada responde como se não houvesse ficha, e não lê o Odoo', async () => {
		const { stub } = odooFalso({ 'hr.employee': [FICHA], ...RESPOSTAS_BASE });
		vi.stubGlobal('fetch', stub);

		const fechada = await rotaEntrar(pedir('123456789'), envDe(base, ''));
		const corpo = (await fechada.json()) as { erro: string };

		expect(fechada.status).toBe(404);
		expect(corpo.erro).toBe('sem_ficha');
		expect(stub).not.toHaveBeenCalled();
	});

	it('o valor por omissão é fechado: um segredo em falta não abre', async () => {
		const { stub } = odooFalso({ 'hr.employee': [FICHA], ...RESPOSTAS_BASE });
		vi.stubGlobal('fetch', stub);

		const env = { ...envDe(base) } as Record<string, unknown>;
		delete env.ENTRADA_ABERTA;

		expect((await rotaEntrar(pedir('123456789'), env as unknown as Env)).status).toBe(404);
		expect(stub).not.toHaveBeenCalled();
	});

	it('encontra pela primeira passagem, grava, e devolve nome curto e núcleo', async () => {
		const { stub, chamadas } = odooFalso({ 'hr.employee': [FICHA], ...RESPOSTAS_BASE });
		vi.stubGlobal('fetch', stub);

		const resposta = await rotaEntrar(pedir('123 456 789'), envDe(base));
		const corpo = (await resposta.json()) as { ok: boolean; nome: string; nucleo: string };

		expect(corpo).toEqual({ ok: true, nome: 'Maria C.', nucleo: 'Refood Benfica' });

		// A primeira passagem é igualdade sobre o `vat`, já normalizado.
		const pesquisa = chamadas.find((c) => c.modelo === 'hr.employee');
		expect(pesquisa?.dominio).toEqual([
			['vat', '=', '123456789'],
			['active', '=', true],
		]);
		// **Sem âmbito no contexto**: esta rota existe para descobrir o núcleo e não o pode
		// restringir antes de o conhecer. O tecto é o da conta, e é o Odoo que o impõe.
		expect((pesquisa?.kwargs.context as Record<string, unknown>)?.allowed_company_ids).toBeUndefined();
		// E o núcleo sai do `company_id` da própria ficha, sem uma segunda leitura a `res.company`.
		expect(chamadas.some((c) => c.modelo === 'res.users' || c.modelo === 'res.company')).toBe(false);

		const { results } = await base.prepare('SELECT employee_id, company_id FROM presencas_demo').all();
		expect(results).toEqual([{ employee_id: 42, company_id: 75 }]);
	});

	/** Entrar duas vezes é uma linha só. O `ON CONFLICT DO NOTHING` é o que o garante sem corrida. */
	it('não duplica quem já lá está', async () => {
		const { stub } = odooFalso({ 'hr.employee': [FICHA], ...RESPOSTAS_BASE });
		vi.stubGlobal('fetch', stub);

		await rotaEntrar(pedir('123456789'), envDe(base));
		await rotaEntrar(pedir('123456789'), envDe(base));

		const { results } = await base.prepare('SELECT COUNT(*) AS n FROM presencas_demo').all<{ n: number }>();
		expect(results[0]?.n).toBe(1);
	});

	/**
	 * **A segunda passagem existe pelas 317 fichas com espaços pelo meio**, e o `=ilike` traz falsos
	 * positivos que o domínio não sabe filtrar — a confirmação é em JS, sobre o `vat` que veio.
	 */
	it('cai na segunda passagem e descarta o que o =ilike trouxe a mais', async () => {
		const falsoPositivo = { ...FICHA, id: 99, vat: '1234567891', barcode: 'PTABF000999_VL' };
		const verdadeira = { ...FICHA, vat: '123 456 789' };

		let chamada = 0;
		const stub = vi.fn(async (_url: string, init: RequestInit) => {
			const corpo = JSON.parse(init.body as string) as { params: { service: string; args: unknown[] } };
			if (corpo.params.service === 'common') return Response.json({ jsonrpc: '2.0', id: 1, result: 7 });

			const [, , , modelo] = corpo.params.args as [string, number, string, string];
			if (modelo === 'res.users') return Response.json({ jsonrpc: '2.0', id: 1, result: RESPOSTAS_BASE['res.users'] });
			if (modelo === 'res.company') return Response.json({ jsonrpc: '2.0', id: 1, result: RESPOSTAS_BASE['res.company'] });

			// A primeira passagem não encontra nada; a segunda traz a certa e uma a mais.
			chamada++;
			return Response.json({ jsonrpc: '2.0', id: 1, result: chamada === 1 ? [] : [falsoPositivo, verdadeira] });
		});
		vi.stubGlobal('fetch', stub);

		const resposta = await rotaEntrar(pedir('123456789'), envDe(base));
		const corpo = (await resposta.json()) as { ok: boolean; nome: string };

		expect(corpo.ok).toBe(true);
		expect(corpo.nome).toBe('Maria C.');

		// A que ficou é a do `vat` com espaços, não a que o `%` apanhou por acaso.
		const { results } = await base.prepare('SELECT employee_id FROM presencas_demo').all();
		expect(results).toEqual([{ employee_id: 42 }]);
	});

	/**
	 * **Encontrar a ficha activa é a resposta, e o `barcode` não entra na decisão.** A rota exigia
	 * `_VL` no fim do código de barras; um voluntário sem código, ou com outro sufixo, não
	 * conseguia entrar. O núcleo continua a sair do `company_id` da ficha.
	 */
	it('aceita a ficha seja qual for o barcode, e mesmo sem barcode', async () => {
		const { stub } = odooFalso({ 'hr.employee': [{ ...FICHA, barcode: false }], ...RESPOSTAS_BASE });
		vi.stubGlobal('fetch', stub);

		const resposta = await rotaEntrar(pedir('123456789'), envDe(base));
		const corpo = (await resposta.json()) as { ok: boolean; nucleo: string };

		expect(resposta.status).toBe(200);
		expect(corpo).toEqual({ ok: true, nome: 'Maria C.', nucleo: 'Refood Benfica' });

		const { results } = await base.prepare('SELECT employee_id, company_id FROM presencas_demo').all();
		expect(results).toEqual([{ employee_id: 42, company_id: 75 }]);
	});

	/**
	 * **Com mais do que uma ficha, fica com a primeira e não diz que havia mais.** Em staging há 33
	 * NIFs normalizados em mais do que uma ficha activa, 14 deles a atravessar núcleos. Devolver a
	 * lista era entregar o oráculo que o interruptor existe para evitar.
	 */
	it('com várias fichas devolve uma só, sem contagem nem lista', async () => {
		const segunda = { ...FICHA, id: 43, company_id: [76, 'Refood Almada'], full_name: 'Ana Sousa' };
		const { stub } = odooFalso({ 'hr.employee': [FICHA, segunda], ...RESPOSTAS_BASE });
		vi.stubGlobal('fetch', stub);

		const resposta = await rotaEntrar(pedir('123456789'), envDe(base));
		const corpo = (await resposta.json()) as Record<string, unknown>;

		expect(Object.keys(corpo).sort()).toEqual(['nome', 'nucleo', 'ok']);
		expect(corpo.nome).toBe('Maria C.');
		expect(JSON.stringify(corpo)).not.toContain('Ana');
	});

	it('trava à décima primeira tentativa da mesma origem', async () => {
		const { stub } = odooFalso({ 'hr.employee': [], ...RESPOSTAS_BASE });
		vi.stubGlobal('fetch', stub);

		const ip = '9.9.9.9';
		for (let i = 0; i < 10; i++) await rotaEntrar(pedir('123456789', ip), envDe(base));

		const travada = await rotaEntrar(pedir('123456789', ip), envDe(base));
		expect(travada.status).toBe(429);
		expect(travada.headers.get('Retry-After')).toBe('60');
	});
});
