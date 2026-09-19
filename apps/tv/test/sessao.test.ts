import { OdooClient } from '@refood/odoo';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '../src/auth';
import { rotaNucleo, rotaSinal } from '../src/nucleo';
import {
	autenticarDispositivo,
	clausulaDeAmbito,
	criarLeitor,
	LIMIAR_SINAL_MS,
	LINGUA_DA_TV,
	registarSinalDeVida,
	servirRotaTv,
	type EnvTv,
	type RotaTv,
} from '../src/sessao';
import { novaBase, type D1Falso } from './d1-falso';

const AGORA = new Date('2026-09-06T10:00:00.000Z');
const TOKEN = 'tv_um-token-de-teste-que-nao-sai-daqui';
const EMPRESA = 7;

let db: D1Falso;
let env: EnvTv;

beforeEach(async () => {
	db = novaBase();
	env = { DB: db, ODOO_URL: 'https://odoo.test', ODOO_DB: 'teste', ODOO_USERNAME: 'u', ODOO_PASSWORD: 'p' };

	await db
		.prepare('INSERT INTO dispositivos (id, token_hash, company_id, criado_em) VALUES (?, ?, ?, ?)')
		.bind('d1', await sha256Hex(TOKEN), EMPRESA, '2026-01-01T00:00:00.000Z')
		.run();

	vi.spyOn(OdooClient.prototype, 'searchRead').mockResolvedValue([{ id: EMPRESA, name: 'PT Núcleo Ávila' }] as never);
});

afterEach(() => {
	vi.restoreAllMocks();
});

function pedido(caminho = '/api/nucleo', token: string | null = TOKEN): Request {
	return new Request(`https://tv.refood.test${caminho}`, {
		headers: token === null ? {} : { authorization: `Bearer ${token}` },
	});
}

describe('autenticarDispositivo', () => {
	it('resolve o token no dispositivo e no seu núcleo', async () => {
		const resultado = await autenticarDispositivo(db, pedido());

		expect(resultado).toMatchObject({ estado: 'ok', sessao: { dispositivo: 'd1', empresa: EMPRESA, painelInicial: null } });
	});

	it('recusa um token que não existe, sem dizer que não existe', async () => {
		expect(await autenticarDispositivo(db, pedido('/api/nucleo', 'tv_outro'))).toEqual({ estado: 'desconhecido' });
	});

	it('recusa sem cabeçalho, com cabeçalho vazio, e sem o Bearer', async () => {
		expect(await autenticarDispositivo(db, pedido('/api/nucleo', null))).toEqual({ estado: 'sem_token' });
		expect(await autenticarDispositivo(db, pedido('/api/nucleo', ''))).toEqual({ estado: 'sem_token' });

		const cru = new Request('https://tv.refood.test/api/nucleo', { headers: { authorization: TOKEN } });
		expect(await autenticarDispositivo(db, cru)).toEqual({ estado: 'sem_token' });
	});

	it('distingue um revogado de um desconhecido — para o registo, não para a resposta', async () => {
		await db.prepare("UPDATE dispositivos SET revogado = 1, revogado_em = ? WHERE id = 'd1'").bind(AGORA.toISOString()).run();

		expect(await autenticarDispositivo(db, pedido())).toEqual({ estado: 'revogado', dispositivo: 'd1' });
	});

	it('guarda o hash do token e não o token', async () => {
		const [linha] = db.sql('SELECT * FROM dispositivos');
		expect(JSON.stringify(linha)).not.toContain(TOKEN);
		expect(linha!.token_hash).toBe(await sha256Hex(TOKEN));
	});
});

describe('servirRotaTv', () => {
	/** Uma rota que só diz o que recebeu, para se ver o que o middleware entrega. */
	const espia: RotaTv = async ({ sessao, leitor }) => Response.json({ sessao, empresaDoLeitor: leitor.empresa });

	it('deixa passar e entrega a sessão do token', async () => {
		const resposta = await servirRotaTv(pedido(), env, espia, { agora: AGORA });

		expect(resposta.status).toBe(200);
		expect(await resposta.json()).toEqual({
			sessao: { dispositivo: 'd1', empresa: EMPRESA, painelInicial: null },
			empresaDoLeitor: EMPRESA,
		});
	});

	it('dá 401 a um revogado, e regista-o', async () => {
		await db.prepare("UPDATE dispositivos SET revogado = 1 WHERE id = 'd1'").run();
		const registo = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const resposta = await servirRotaTv(pedido(), env, espia, { agora: AGORA });

		expect(resposta.status).toBe(401);
		expect(await resposta.json()).toEqual({ ok: false, erro: 'nao_autorizado' });
		expect(registo).toHaveBeenCalledWith({ evento: 'tv.dispositivo_revogado', dispositivo: 'd1' });
	});

	it('a revogação vale já no pedido seguinte, sem esperar por cache nenhuma', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		expect((await servirRotaTv(pedido(), env, espia, { agora: AGORA })).status).toBe(200);
		await db.prepare("UPDATE dispositivos SET revogado = 1 WHERE id = 'd1'").run();
		expect((await servirRotaTv(pedido(), env, espia, { agora: AGORA })).status).toBe(401);
	});

	it('a resposta a um token desconhecido é indistinguível da de um revogado', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		await db.prepare("UPDATE dispositivos SET revogado = 1 WHERE id = 'd1'").run();

		const revogado = await servirRotaTv(pedido(), env, espia, { agora: AGORA });
		const desconhecido = await servirRotaTv(pedido('/api/nucleo', 'tv_nada'), env, espia, { agora: AGORA });

		expect(revogado.status).toBe(desconhecido.status);
		expect(await revogado.json()).toEqual(await desconhecido.json());
	});

	it('não corre a rota quando o token não passa', async () => {
		const rota = vi.fn<RotaTv>(async () => Response.json({ ok: true }));

		await servirRotaTv(pedido('/api/nucleo', null), env, rota, { agora: AGORA });

		expect(rota).not.toHaveBeenCalled();
	});
});

describe('sinal de vida', () => {
	it('escreve o visto_em na primeira passagem', async () => {
		await servirRotaTv(pedido(), env, rotaSinal, { agora: AGORA });

		expect(db.sql("SELECT visto_em FROM dispositivos WHERE id = 'd1'")[0]!.visto_em).toBe(AGORA.toISOString());
	});

	it('não reescreve enquanto a marca estiver fresca — o tráfego não manda nas escritas', async () => {
		await servirRotaTv(pedido(), env, rotaSinal, { agora: AGORA });

		const poucoDepois = new Date(AGORA.getTime() + 30_000);
		for (let i = 0; i < 20; i++) await servirRotaTv(pedido(), env, rotaSinal, { agora: poucoDepois });

		expect(db.sql("SELECT visto_em FROM dispositivos WHERE id = 'd1'")[0]!.visto_em).toBe(AGORA.toISOString());
	});

	it('volta a escrever passado o limiar', async () => {
		await servirRotaTv(pedido(), env, rotaSinal, { agora: AGORA });

		const depois = new Date(AGORA.getTime() + LIMIAR_SINAL_MS + 1000);
		await servirRotaTv(pedido(), env, rotaSinal, { agora: depois });

		expect(db.sql("SELECT visto_em FROM dispositivos WHERE id = 'd1'")[0]!.visto_em).toBe(depois.toISOString());
	});

	it('uma marca ilegível conta como velha e é reescrita', async () => {
		await db.prepare("UPDATE dispositivos SET visto_em = 'não é uma data' WHERE id = 'd1'").run();

		expect(await registarSinalDeVida(db, { dispositivo: 'd1', empresa: EMPRESA, painelInicial: null }, 'não é uma data', AGORA)).toBe(true);
		expect(db.sql("SELECT visto_em FROM dispositivos WHERE id = 'd1'")[0]!.visto_em).toBe(AGORA.toISOString());
	});

	it('não marca sinal de vida num dispositivo revogado', async () => {
		await db.prepare("UPDATE dispositivos SET revogado = 1 WHERE id = 'd1'").run();

		await registarSinalDeVida(db, { dispositivo: 'd1', empresa: EMPRESA, painelInicial: null }, null, AGORA);

		expect(db.sql("SELECT visto_em FROM dispositivos WHERE id = 'd1'")[0]!.visto_em).toBeNull();
	});

	it('a escrita segue para o waitUntil, fora do caminho da resposta', async () => {
		const adiadas: Promise<unknown>[] = [];

		const resposta = await servirRotaTv(pedido(), env, rotaSinal, { agora: AGORA, aguardar: (p) => adiadas.push(p) });

		expect(resposta.status).toBe(200);
		expect(adiadas).toHaveLength(1);
		await Promise.all(adiadas);
		expect(db.sql("SELECT visto_em FROM dispositivos WHERE id = 'd1'")[0]!.visto_em).toBe(AGORA.toISOString());
	});
});

describe('leitor do núcleo', () => {
	it('mete o âmbito no domínio e no contexto, nas duas metades', async () => {
		await criarLeitor(env, EMPRESA, LINGUA_DA_TV).searchRead('res.partner', [['active', '=', true]], { fields: ['name'], limit: 10 });

		expect(OdooClient.prototype.searchRead).toHaveBeenCalledWith(
			'res.partner',
			[
				['company_id', '=', EMPRESA],
				['active', '=', true],
			],
			expect.objectContaining({ fields: ['name'], limit: 10, context: { allowed_company_ids: [EMPRESA] } }),
		);
	});

	it('na res.company o âmbito é o id, porque a empresa não tem company_id', async () => {
		await criarLeitor(env, EMPRESA, LINGUA_DA_TV).searchRead('res.company', [], { fields: ['name'], limit: 1 });

		expect(OdooClient.prototype.searchRead).toHaveBeenCalledWith(
			'res.company',
			[['id', '=', EMPRESA]],
			expect.objectContaining({ context: { allowed_company_ids: [EMPRESA] } }),
		);
	});

	it('o âmbito vem antes do domínio de quem chama, e não há como o substituir', async () => {
		// Mesmo que uma rota tente escrever o seu próprio company_id, o do token continua lá: as
		// duas cláusulas somam-se, e uma consulta com dois núcleos diferentes não devolve nada.
		await criarLeitor(env, EMPRESA, LINGUA_DA_TV).searchRead('res.partner', [['company_id', '=', 999]], { fields: ['name'], limit: 1 });

		const [, dominio] = vi.mocked(OdooClient.prototype.searchRead).mock.calls[0]!;
		expect(dominio?.[0]).toEqual(['company_id', '=', EMPRESA]);
		expect(dominio?.[1]).toEqual(['company_id', '=', 999]);
	});

	/**
	 * **O catálogo de POS é global, e é a única excepção à cláusula estrita.**
	 *
	 * Os 24 produtos de POS não têm `company_id` — são os mesmos para todos os núcleos. Com
	 * `['company_id', '=', empresa]` a leitura devolve **zero de 24**, medido em staging, e sem
	 * catálogo não há como saber qual das observações não é uma falta.
	 *
	 * A forma `in [empresa, false]` é a `ir.rule` que o próprio Odoo usa no `res.partner`, e **é mais
	 * fraca que a estrita**: deixa passar o registo sem empresa. Vale aqui porque não há ali nada
	 * para separar — dois núcleos recebem as mesmas 24 linhas —, e **foi recusada para dados de
	 * pessoas**, onde a solução foi entrar pela ficha.
	 */
	it('o catálogo de POS lê-se com a forma nullable, porque é global', async () => {
		await criarLeitor(env, EMPRESA, LINGUA_DA_TV).searchRead('product.product', [['default_code', 'in', ['OBS-SEM-EXC']]], {
			fields: ['default_code'],
			limit: 50,
		});

		expect(OdooClient.prototype.searchRead).toHaveBeenCalledWith(
			'product.product',
			[
				['company_id', 'in', [EMPRESA, false]],
				['default_code', 'in', ['OBS-SEM-EXC']],
			],
			expect.objectContaining({ context: { allowed_company_ids: [EMPRESA] } }),
		);
	});

	/**
	 * O que prende a excepção a **um** modelo. Se alguém acrescentar outro à lista, este teste fica
	 * vermelho antes de uma leitura mais fraca chegar a dados que tenham núcleo.
	 */
	it('só o catálogo é nullable — todo o resto leva a cláusula estrita', () => {
		const nullable = ['res.partner', 'res.beneficiary', 'res.food.source', 'pos.order', 'pos.order.line', 'res.delivery.route'].filter(
			(modelo) => JSON.stringify(clausulaDeAmbito(modelo, EMPRESA)).includes('"in"'),
		);

		expect(nullable).toEqual([]);
		expect(clausulaDeAmbito('product.product', EMPRESA)).toEqual([['company_id', 'in', [EMPRESA, false]]]);
		expect(clausulaDeAmbito('res.company', EMPRESA)).toEqual([['id', '=', EMPRESA]]);
	});

	/** Global quer dizer o mesmo para todos: dois núcleos têm de produzir a mesma leitura, e não uma vazia. */
	it('a leitura do catálogo é igual para dois núcleos diferentes', () => {
		const [a] = clausulaDeAmbito('product.product', 7) as [string, string, unknown[]][];
		const [b] = clausulaDeAmbito('product.product', 12) as [string, string, unknown[]][];

		expect(a?.[2]).toEqual([7, false]);
		expect(b?.[2]).toEqual([12, false]);
		// O `false` está nas duas: é ele que faz um registo global chegar a qualquer núcleo.
		expect(a?.[2]).toContain(false);
		expect(b?.[2]).toContain(false);
	});

	it('leva a empresa do token, e não tem método que a mude', () => {
		const leitor = criarLeitor(env, EMPRESA, LINGUA_DA_TV);

		expect(leitor.empresa).toBe(EMPRESA);
		expect(leitor.lingua).toBe(LINGUA_DA_TV);
		expect(Object.keys(leitor).filter((chave) => chave !== 'empresa' && chave !== 'lingua')).toEqual(['searchRead']);
	});
});

describe('GET /api/nucleo', () => {
	it('devolve o nome do núcleo do token', async () => {
		const resposta = await servirRotaTv(pedido(), env, rotaNucleo, { agora: AGORA });

		expect(resposta.status).toBe(200);
		expect(await resposta.json()).toEqual({ ok: true, nucleo: { nome: 'PT Núcleo Ávila' } });
	});

	it('pede só o nome, e só do núcleo do token', async () => {
		await servirRotaTv(pedido(), env, rotaNucleo, { agora: AGORA });

		expect(OdooClient.prototype.searchRead).toHaveBeenCalledWith(
			'res.company',
			[['id', '=', EMPRESA]],
			expect.objectContaining({ fields: ['name'], limit: 1, context: { allowed_company_ids: [EMPRESA] } }),
		);
	});

	it('lê o núcleo do token, e não o de outro dispositivo', async () => {
		await db
			.prepare('INSERT INTO dispositivos (id, token_hash, company_id, criado_em) VALUES (?, ?, ?, ?)')
			.bind('d2', await sha256Hex('tv_outro-ecra'), 12, '2026-02-01T00:00:00.000Z')
			.run();

		await servirRotaTv(pedido('/api/nucleo', 'tv_outro-ecra'), env, rotaNucleo, { agora: AGORA });

		expect(OdooClient.prototype.searchRead).toHaveBeenCalledWith('res.company', [['id', '=', 12]], expect.anything());
	});

	it('dá 502 quando o Odoo não devolve a empresa do token', async () => {
		vi.mocked(OdooClient.prototype.searchRead).mockResolvedValueOnce([] as never);
		const registo = vi.spyOn(console, 'error').mockImplementation(() => {});

		const resposta = await servirRotaTv(pedido(), env, rotaNucleo, { agora: AGORA });

		expect(resposta.status).toBe(502);
		expect(registo).toHaveBeenCalledWith({ evento: 'tv.nucleo_inexistente', company_id: EMPRESA });
	});

	it('não fala com o Odoo quando o token não passa', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		await db.prepare("UPDATE dispositivos SET revogado = 1 WHERE id = 'd1'").run();

		await servirRotaTv(pedido(), env, rotaNucleo, { agora: AGORA });

		expect(OdooClient.prototype.searchRead).not.toHaveBeenCalled();
	});
});
