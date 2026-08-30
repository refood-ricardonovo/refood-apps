import { beforeEach, describe, expect, it } from 'vitest';
import { OdooAuthError, OdooClient, OdooTransportError, OdooValidationError, createOdooClient } from '../src/index';

const base = { url: 'https://odoo.myrefood.pt', db: 'refood', username: 'bot', password: 'segredo' };

type Params = { service: string; method: string; args: unknown[] };
type Resposta = unknown | { status: number; body?: unknown };

/** Regista os params JSON-RPC de cada pedido e devolve as respostas pela ordem dada (repetindo a última). */
function fakeFetch(respostas: Resposta[]) {
	const params: Params[] = [];
	const urls: string[] = [];
	let i = 0;

	const impl = (async (url: string, init: RequestInit) => {
		urls.push(url);
		params.push(JSON.parse(init.body as string).params);

		const r = respostas[Math.min(i++, respostas.length - 1)] as { status?: number; body?: unknown };
		const temStatus = typeof r === 'object' && r !== null && 'status' in r;
		const corpo = temStatus ? r.body : r;
		return new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), { status: temStatus ? r.status : 200 });
	}) as unknown as typeof fetch;

	return { impl, params, urls, get contagem() {
		return params.length;
	} };
}

/** Fault JSON-RPC tal como o Odoo o devolve: HTTP 200, com a excepção real em `data.name`. */
function fault(name: string, message = 'rebentou') {
	return { error: { code: 200, message: 'Odoo Server Error', data: { name, message, debug: 'Traceback...' } } };
}

describe('construção e configuração', () => {
	it('nomeia as chaves em falta em vez de falhar mais à frente', () => {
		expect(() => new OdooClient({ url: 'x', db: '', username: '', password: 'p' })).toThrow(/falta db, username/);
	});

	it('createOdooClient nomeia as variáveis de ambiente em falta', () => {
		expect(() => createOdooClient({ ODOO_URL: 'x', ODOO_DB: 'y' })).toThrow(/ODOO_USERNAME, ODOO_PASSWORD/);
	});

	it('normaliza o URL para o endpoint /jsonrpc', async () => {
		const f = fakeFetch([{ result: {} }]);
		await new OdooClient({ ...base, url: 'https://odoo.myrefood.pt///', fetch: f.impl }).version();
		expect(f.urls[0]).toBe('https://odoo.myrefood.pt/jsonrpc');
	});
});

describe('autenticação', () => {
	it('envia db, login e password ao common.authenticate', async () => {
		const f = fakeFetch([{ result: 7 }, { result: 0 }]);
		await new OdooClient({ ...base, fetch: f.impl }).searchCount('res.partner');
		expect(f.params[0]).toEqual({ service: 'common', method: 'authenticate', args: ['refood', 'bot', 'segredo', {}] });
	});

	// O Odoo devolve `false` com HTTP 200 e sem `error` quando as credenciais falham.
	it('converte o authenticate:false em OdooAuthError', async () => {
		const odoo = new OdooClient({ ...base, fetch: fakeFetch([{ result: false }]).impl });
		await expect(odoo.searchCount('res.partner')).rejects.toThrow(OdooAuthError);
	});

	it('reutiliza o uid e não autentica em duplicado sob concorrência', async () => {
		const f = fakeFetch([{ result: 7 }, { result: 1 }]);
		const odoo = new OdooClient({ ...base, fetch: f.impl });

		await Promise.all([odoo.searchCount('a'), odoo.searchCount('b'), odoo.searchCount('c')]);

		expect(f.params.filter((p) => p.method === 'authenticate')).toHaveLength(1);
	});

	it('não deixa uma autenticação falhada em cache', async () => {
		const f = fakeFetch([{ result: false }]);
		const odoo = new OdooClient({ ...base, fetch: f.impl });

		await expect(odoo.searchCount('a')).rejects.toThrow(OdooAuthError);
		await expect(odoo.searchCount('b')).rejects.toThrow(OdooAuthError);

		expect(f.params.filter((p) => p.method === 'authenticate')).toHaveLength(2);
	});

	it('reautentica e repete a chamada quando o uid em cache deixou de servir', async () => {
		const f = fakeFetch([{ result: 7 }, fault('odoo.exceptions.AccessDenied'), { result: 9 }, { result: 42 }]);
		const odoo = new OdooClient({ ...base, fetch: f.impl });

		await expect(odoo.searchCount('res.partner')).resolves.toBe(42);
		expect(f.contagem).toBe(4);
		expect(f.params[3]!.args[1]).toBe(9); // a repetição usa o uid novo
	});

	// Se o uid novo é igual ao antigo o problema é de permissões: repetir só duplicaria o erro.
	it('não repete a chamada se o uid reautenticado for o mesmo', async () => {
		const f = fakeFetch([{ result: 7 }, fault('odoo.exceptions.AccessDenied'), { result: 7 }]);
		const odoo = new OdooClient({ ...base, fetch: f.impl });

		await expect(odoo.searchCount('res.partner')).rejects.toThrow(OdooAuthError);
		expect(f.contagem).toBe(3);
	});
});

describe('erros', () => {
	it.each([
		['odoo.exceptions.UserError', OdooValidationError],
		['odoo.exceptions.ValidationError', OdooValidationError],
		['odoo.exceptions.AccessError', OdooAuthError],
	])('mapeia %s para a subclasse certa', async (name, classe) => {
		const odoo = new OdooClient({ ...base, fetch: fakeFetch([{ result: 7 }, fault(name, 'Stock insuficiente')]).impl });
		await expect(odoo.create('stock.move', {})).rejects.toThrow(classe as never);
	});

	it('preserva a mensagem e o traceback do Odoo', async () => {
		const odoo = new OdooClient({ ...base, fetch: fakeFetch([{ result: 7 }, fault('odoo.exceptions.UserError', 'Stock insuficiente')]).impl });
		await expect(odoo.create('stock.move', {})).rejects.toMatchObject({
			message: 'Stock insuficiente',
			odooName: 'odoo.exceptions.UserError',
			debug: 'Traceback...',
		});
	});

	it('trata uma página HTML de proxy como erro de transporte', async () => {
		const odoo = new OdooClient({ ...base, fetch: fakeFetch(['<html>502 Bad Gateway</html>']).impl });
		await expect(odoo.version()).rejects.toThrow(OdooTransportError);
	});

	it('trata um HTTP não-2xx como erro de transporte', async () => {
		const odoo = new OdooClient({ ...base, fetch: fakeFetch([{ status: 503, body: {} }]).impl });
		await expect(odoo.version()).rejects.toThrow(/HTTP 503/);
	});

	it('aborta e reporta o timeout', async () => {
		const nuncaResponde = ((_url: string, init: RequestInit) =>
			new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(init.signal?.reason)))) as unknown as typeof fetch;
		const odoo = new OdooClient({ ...base, timeoutMs: 30, fetch: nuncaResponde });

		await expect(odoo.version()).rejects.toThrow(/excedeu 30ms/);
	});
});

describe('execute_kw', () => {
	it('monta os args posicionais e os kwargs do search_read', async () => {
		const f = fakeFetch([{ result: 7 }, { result: [{ id: 1, name: 'ReFood' }] }]);
		const odoo = new OdooClient({ ...base, context: { lang: 'pt_PT' }, fetch: f.impl });

		await odoo.searchRead('res.partner', [['is_company', '=', true]], { fields: ['name'], limit: 5, order: 'name asc' });

		expect(f.params[1]).toEqual({
			service: 'object',
			method: 'execute_kw',
			args: [
				'refood',
				7,
				'segredo',
				'res.partner',
				'search_read',
				[[['is_company', '=', true]]],
				{ fields: ['name'], limit: 5, order: 'name asc', context: { lang: 'pt_PT' } },
			],
		});
	});

	it('deixa o context da chamada sobrepor-se ao do cliente sem apagar o resto', async () => {
		const f = fakeFetch([{ result: 7 }, { result: [] }]);
		const odoo = new OdooClient({ ...base, context: { lang: 'pt_PT', tz: 'Europe/Lisbon' }, fetch: f.impl });

		await odoo.searchRead('res.partner', [], { context: { lang: 'en_US' } });

		expect((f.params[1]!.args[6] as Record<string, unknown>).context).toEqual({ lang: 'en_US', tz: 'Europe/Lisbon' });
	});
});

describe('readGroup', () => {
	it('passa [domain, fields, groupby] posicionais e o resto em kwargs', async () => {
		const f = fakeFetch([{ result: 7 }, { result: [] }]);
		const odoo = new OdooClient({ ...base, fetch: f.impl });

		await odoo.readGroup('refood.entrega', [['state', '=', 'done']], ['id:count', 'quantidade:sum'], ['local_id'], {
			orderby: 'quantidade desc',
			limit: 10,
			offset: 5,
			lazy: false,
		});

		expect(f.params[1]!.args.slice(3)).toEqual([
			'refood.entrega',
			'read_group',
			[[['state', '=', 'done']], ['id:count', 'quantidade:sum'], ['local_id']],
			{ limit: 10, offset: 5, orderby: 'quantidade desc', lazy: false, context: {} },
		]);
	});

	// `lazy: false` é falsy: um teste por truthiness omitia-o e o Odoo voltava ao lazy:true dele.
	it('preserva lazy:false', async () => {
		const f = fakeFetch([{ result: 7 }, { result: [] }]);
		await new OdooClient({ ...base, fetch: f.impl }).readGroup('m', [], ['id:count'], ['a', 'b'], { lazy: false });

		expect((f.params[1]!.args[6] as Record<string, unknown>).lazy).toBe(false);
	});

	it('não inventa kwargs quando não lhe passam options', async () => {
		const f = fakeFetch([{ result: 7 }, { result: [] }]);
		await new OdooClient({ ...base, fetch: f.impl }).readGroup('m', [], ['id:count'], ['local_id']);

		expect(f.params[1]!.args[6]).toEqual({ context: {} });
	});
});

describe('superfície da API', () => {
	// As apps não apagam registos no Odoo. A ausência é deliberada: um método público seria
	// fácil de ligar a uma rota por acidente.
	it('não expõe unlink', () => {
		expect('unlink' in OdooClient.prototype).toBe(false);
	});
});
