import { beforeEach, describe, expect, it } from 'vitest';
import { OdooAuthError, OdooClient, OdooTransportError, OdooValidationError, createOdooClient } from '../src/index';

const base = { url: 'https://odoo.myrefood.pt', db: 'refood', username: 'bot', password: 'segredo' };

/** A língua é obrigatória em todas as leituras; nos testes que não são sobre ela, é só ruído. */
const PT = { lang: 'pt_PT' } as const;

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

	return {
		impl,
		params,
		urls,
		get contagem() {
			return params.length;
		},
	};
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
		await new OdooClient({ ...base, fetch: f.impl }).searchCount('res.partner', [], PT);
		expect(f.params[0]).toEqual({ service: 'common', method: 'authenticate', args: ['refood', 'bot', 'segredo', {}] });
	});

	// O Odoo devolve `false` com HTTP 200 e sem `error` quando as credenciais falham.
	it('converte o authenticate:false em OdooAuthError', async () => {
		const odoo = new OdooClient({ ...base, fetch: fakeFetch([{ result: false }]).impl });
		await expect(odoo.searchCount('res.partner', [], PT)).rejects.toThrow(OdooAuthError);
	});

	it('reutiliza o uid e não autentica em duplicado sob concorrência', async () => {
		const f = fakeFetch([{ result: 7 }, { result: 1 }]);
		const odoo = new OdooClient({ ...base, fetch: f.impl });

		await Promise.all([odoo.searchCount('a', [], PT), odoo.searchCount('b', [], PT), odoo.searchCount('c', [], PT)]);

		expect(f.params.filter((p) => p.method === 'authenticate')).toHaveLength(1);
	});

	it('não deixa uma autenticação falhada em cache', async () => {
		const f = fakeFetch([{ result: false }]);
		const odoo = new OdooClient({ ...base, fetch: f.impl });

		await expect(odoo.searchCount('a', [], PT)).rejects.toThrow(OdooAuthError);
		await expect(odoo.searchCount('b', [], PT)).rejects.toThrow(OdooAuthError);

		expect(f.params.filter((p) => p.method === 'authenticate')).toHaveLength(2);
	});

	it('reautentica e repete a chamada quando o uid em cache deixou de servir', async () => {
		const f = fakeFetch([{ result: 7 }, fault('odoo.exceptions.AccessDenied'), { result: 9 }, { result: 42 }]);
		const odoo = new OdooClient({ ...base, fetch: f.impl });

		await expect(odoo.searchCount('res.partner', [], PT)).resolves.toBe(42);
		expect(f.contagem).toBe(4);
		expect(f.params[3]!.args[1]).toBe(9); // a repetição usa o uid novo
	});

	// Se o uid novo é igual ao antigo o problema é de permissões: repetir só duplicaria o erro.
	it('não repete a chamada se o uid reautenticado for o mesmo', async () => {
		const f = fakeFetch([{ result: 7 }, fault('odoo.exceptions.AccessDenied'), { result: 7 }]);
		const odoo = new OdooClient({ ...base, fetch: f.impl });

		await expect(odoo.searchCount('res.partner', [], PT)).rejects.toThrow(OdooAuthError);
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
		await expect(odoo.create('stock.move', {}, PT)).rejects.toThrow(classe as never);
	});

	it('preserva a mensagem e o traceback do Odoo', async () => {
		const odoo = new OdooClient({
			...base,
			fetch: fakeFetch([{ result: 7 }, fault('odoo.exceptions.UserError', 'Stock insuficiente')]).impl,
		});
		await expect(odoo.create('stock.move', {}, PT)).rejects.toMatchObject({
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
		const odoo = new OdooClient({ ...base, fetch: f.impl });

		await odoo.searchRead('res.partner', [['is_company', '=', true]], { fields: ['name'], limit: 5, order: 'name asc', lang: 'pt_PT' });

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
		const odoo = new OdooClient({ ...base, context: { tz: 'Europe/Lisbon' }, fetch: f.impl });

		await odoo.searchRead('res.partner', [], { lang: 'en_US', context: { active_test: false } });

		expect((f.params[1]!.args[6] as Record<string, unknown>).context).toEqual({
			lang: 'en_US',
			tz: 'Europe/Lisbon',
			active_test: false,
		});
	});
});

/**
 * A língua.
 *
 * Sem `lang` no contexto o Odoo **não** usa a do utilizador: cai no `en_US`. É a falha que não se
 * vê — os valores vêm todos, plausíveis, na língua errada. Estes testes prendem as três decisões:
 * a língua vai em toda a leitura, é de quem pede, e só há uma maneira de a dizer.
 */
describe('a língua', () => {
	it('vai no contexto de toda a leitura, mesmo sem context nenhum', async () => {
		const f = fakeFetch([{ result: 7 }, { result: [] }]);
		await new OdooClient({ ...base, fetch: f.impl }).searchRead('res.partner', [], { fields: ['name'], limit: 1, lang: 'pt_PT' });

		expect((f.params[1]!.args[6] as Record<string, unknown>).context).toEqual({ lang: 'pt_PT' });
	});

	it.each([
		['searchCount', (o: OdooClient) => o.searchCount('m', [], { lang: 'pt_PT' })],
		['read', (o: OdooClient) => o.read('m', [1], ['name'], { lang: 'pt_PT' })],
		['search', (o: OdooClient) => o.search('m', [], { lang: 'pt_PT' })],
		['create', (o: OdooClient) => o.create('m', {}, { lang: 'pt_PT' })],
		['write', (o: OdooClient) => o.write('m', [1], {}, { lang: 'pt_PT' })],
		['readGroup', (o: OdooClient) => o.readGroup('m', [], ['id:count'], ['a'], { lang: 'pt_PT' })],
		['fieldsGet', (o: OdooClient) => o.fieldsGet('m', { lang: 'pt_PT' })],
	])('%s leva-a também', async (_nome, chamar) => {
		const f = fakeFetch([{ result: 7 }, { result: [] }]);
		await chamar(new OdooClient({ ...base, fetch: f.impl }));

		expect((f.params[1]!.args[6] as Record<string, unknown>).context).toMatchObject({ lang: 'pt_PT' });
	});

	/**
	 * **A língua é de quem pede, não do processo.** O cliente é partilhado pelo isolate do Worker
	 * para não reautenticar em cada pedido; uma língua fixada na construção passava a valer para
	 * todos os pedidos que aquele isolate servir. Indiferente na TV, que é sempre `pt_PT`, e errado
	 * na PWA, com dois voluntários de línguas diferentes ao mesmo tempo.
	 */
	it('é recusada na configuração do cliente', () => {
		expect(() => new OdooClient({ ...base, context: { lang: 'pt_PT' } })).toThrow(/não vai na configuração/);
	});

	/**
	 * Duas maneiras de dizer a mesma coisa é como se perde uma: recusa-se em vez de substituir em
	 * silêncio. E rebenta **sincronamente**, antes de haver promessa e antes de tocar na rede — a
	 * chamada nem chega a autenticar.
	 */
	it('é recusada dentro do context da chamada', () => {
		const f = fakeFetch([{ result: 7 }]);
		const odoo = new OdooClient({ ...base, fetch: f.impl });

		expect(() => odoo.searchRead('m', [], { fields: ['a'], limit: 1, lang: 'pt_PT', context: { lang: 'en_US' } })).toThrow(
			/não vai dentro do `context`/,
		);
		expect(f.contagem).toBe(0);
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
			lang: 'pt_PT',
		});

		expect(f.params[1]!.args.slice(3)).toEqual([
			'refood.entrega',
			'read_group',
			[[['state', '=', 'done']], ['id:count', 'quantidade:sum'], ['local_id']],
			{ limit: 10, offset: 5, orderby: 'quantidade desc', lazy: false, context: { lang: 'pt_PT' } },
		]);
	});

	// `lazy: false` é falsy: um teste por truthiness omitia-o e o Odoo voltava ao lazy:true dele.
	it('preserva lazy:false', async () => {
		const f = fakeFetch([{ result: 7 }, { result: [] }]);
		await new OdooClient({ ...base, fetch: f.impl }).readGroup('m', [], ['id:count'], ['a', 'b'], { lazy: false, ...PT });

		expect((f.params[1]!.args[6] as Record<string, unknown>).lazy).toBe(false);
	});

	it('não inventa kwargs para além do contexto com a língua', async () => {
		const f = fakeFetch([{ result: 7 }, { result: [] }]);
		await new OdooClient({ ...base, fetch: f.impl }).readGroup('m', [], ['id:count'], ['local_id'], PT);

		expect(f.params[1]!.args[6]).toEqual({ context: { lang: 'pt_PT' } });
	});
});

describe('superfície da API', () => {
	// As apps não apagam registos no Odoo. A ausência é deliberada: um método público seria
	// fácil de ligar a uma rota por acidente.
	it('não expõe unlink', () => {
		expect('unlink' in OdooClient.prototype).toBe(false);
	});
});
