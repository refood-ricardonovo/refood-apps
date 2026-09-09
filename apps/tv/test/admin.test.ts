import { OdooClient } from '@refood/odoo';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	autenticarAdmin,
	BLOQUEIO_MS,
	estaBloqueado,
	JANELA_FALHAS_MS,
	listarDispositivos,
	listarPendentes,
	MAX_FALHAS_ADMIN,
	revogarDispositivo,
	rotaAdmin,
	segundosAteDesbloquear,
	type EnvAdmin,
	type Nucleo,
} from '../src/admin';
import { sha256Hex } from '../src/auth';
import { LINGUA_DA_TV } from '../src/sessao';
import { novaBase, type D1Falso } from './d1-falso';

const AGORA = new Date('2026-09-05T10:00:00.000Z');
const SEGREDO_ADMIN = 'um-segredo-de-teste-que-nao-sai-daqui';

/** Os núcleos que o Odoo devolveria. A chamada em si é substituída — aqui não se fala com o Odoo. */
const NUCLEOS: Nucleo[] = [
	{ id: 7, name: 'Refood Porto Centro', center_prefix: 'PTC' },
	{ id: 12, name: 'Refood Aveiro', center_prefix: 'AVR' },
];

/**
 * As empresas do utilizador de integração.
 *
 * **Deliberadamente mais curta do que a base.** Em staging o Odoo tem 87 empresas e o utilizador
 * 84, e é dessa diferença que nasce a falha que estes testes guardam: uma empresa real, com nome de
 * núcleo, que a app não consegue ler. O `999` faz aqui o papel dessas três.
 */
const EMPRESAS_PERMITIDAS = NUCLEOS.map((nucleo) => nucleo.id);

let db: D1Falso;
let env: EnvAdmin;

beforeEach(() => {
	db = novaBase();
	env = { DB: db, ADMIN_SECRET: SEGREDO_ADMIN, ODOO_URL: 'https://odoo.test', ODOO_DB: 'teste', ODOO_USERNAME: 'u', ODOO_PASSWORD: 'p' };

	// O `searchRead` do cliente é o único ponto de contacto com o Odoo nestas rotas, e responde a
	// dois modelos: o utilizador, que diz quais são as empresas permitidas, e as empresas.
	vi.spyOn(OdooClient.prototype, 'searchRead').mockImplementation(async (modelo) => {
		if (modelo === 'res.users') return [{ id: 36, company_ids: EMPRESAS_PERMITIDAS }] as never;
		return NUCLEOS as never;
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

function pedido(caminho: string, opcoes: { metodo?: string; corpo?: unknown; segredo?: string | null } = {}): Request {
	const cabecalhos: Record<string, string> = { 'content-type': 'application/json' };
	const segredo = opcoes.segredo === undefined ? SEGREDO_ADMIN : opcoes.segredo;
	if (segredo !== null) cabecalhos.authorization = `Bearer ${segredo}`;

	return new Request(`https://tv.refood.test${caminho}`, {
		method: opcoes.metodo ?? 'GET',
		headers: cabecalhos,
		body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
	});
}

async function semearPendente(codigo: string, expira_em = '2026-09-05T10:15:00.000Z', criado_em = '2026-09-05T10:00:00.000Z') {
	await db
		.prepare(`INSERT INTO emparelhamentos (id, codigo, segredo_hash, estado, criado_em, expira_em) VALUES (?, ?, ?, 'pendente', ?, ?)`)
		.bind(`emp-${codigo}`, codigo, await sha256Hex(`seg_${codigo}`), criado_em, expira_em)
		.run();
}

async function semearDispositivo(id: string, empresa: number, criado_em: string) {
	await db
		.prepare('INSERT INTO dispositivos (id, token_hash, company_id, criado_em) VALUES (?, ?, ?, ?)')
		.bind(id, await sha256Hex(`tv_${id}`), empresa, criado_em)
		.run();
}

describe('trava de tentativas', () => {
	/** Um pedido com IP, para se poderem separar baldes. */
	function dePara(ip: string, segredo: string | null = SEGREDO_ADMIN): Request {
		const request = pedido('/api/admin/emparelhamentos', { segredo });
		const cabecalhos = new Headers(request.headers);
		cabecalhos.set('cf-connecting-ip', ip);
		return new Request(request, { headers: cabecalhos });
	}

	async function falharVezes(quantas: number, ip = '203.0.113.1', instante = AGORA) {
		let ultima: Response | undefined;
		for (let i = 0; i < quantas; i++) ultima = await rotaAdmin(dePara(ip, 'errado'), env, instante);
		return ultima!;
	}

	beforeEach(() => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	it('conta as falhas e só bloqueia ao chegar ao tecto', async () => {
		for (let i = 1; i < MAX_FALHAS_ADMIN; i++) {
			expect((await falharVezes(1)).status, `falha ${i}`).toBe(401);
		}

		// A que fecha a conta ainda responde 401 — é a seguinte que já nem chega a comparar.
		expect((await falharVezes(1)).status).toBe(401);
		expect((await falharVezes(1)).status).toBe(429);
	});

	it('bloqueado, nem o segredo certo passa — senão a trava seria um oráculo', async () => {
		await falharVezes(MAX_FALHAS_ADMIN);

		const resposta = await rotaAdmin(dePara('203.0.113.1'), env, AGORA);

		expect(resposta.status).toBe(429);
		expect(await resposta.json()).toEqual({ ok: false, erro: 'demasiadas_tentativas' });
	});

	it('diz quanto falta no Retry-After', async () => {
		await falharVezes(MAX_FALHAS_ADMIN);

		const resposta = await rotaAdmin(dePara('203.0.113.1'), env, new Date(AGORA.getTime() + 60_000));
		const faltam = Number(resposta.headers.get('retry-after'));

		expect(faltam).toBeGreaterThan(0);
		expect(faltam).toBeLessThanOrEqual(BLOQUEIO_MS / 1000);
	});

	it('desbloqueia passado o tempo do bloqueio', async () => {
		await falharVezes(MAX_FALHAS_ADMIN);

		const depois = new Date(AGORA.getTime() + BLOQUEIO_MS + 1000);
		expect((await rotaAdmin(dePara('203.0.113.1'), env, depois)).status).toBe(200);
	});

	it('não castiga quem se engana espaçadamente: a janela reinicia', async () => {
		await falharVezes(MAX_FALHAS_ADMIN - 1);

		// Passada a janela, a contagem recomeça — estas falhas não somam às antigas.
		const maisTarde = new Date(AGORA.getTime() + JANELA_FALHAS_MS + 1000);
		expect((await falharVezes(1, '203.0.113.1', maisTarde)).status).toBe(401);
		expect((await rotaAdmin(dePara('203.0.113.1'), env, maisTarde)).status).toBe(200);
	});

	it('uma entrada certa limpa a conta', async () => {
		await falharVezes(MAX_FALHAS_ADMIN - 1);
		expect((await rotaAdmin(dePara('203.0.113.1'), env, AGORA)).status).toBe(200);

		expect(db.sql('SELECT COUNT(*) AS n FROM tentativas_admin')[0]!.n).toBe(0);
		expect((await falharVezes(1)).status).toBe(401); // recomeça do princípio
	});

	it('bloqueia por origem, não a sede inteira', async () => {
		await falharVezes(MAX_FALHAS_ADMIN, '203.0.113.1');

		expect((await rotaAdmin(dePara('203.0.113.1'), env, AGORA)).status).toBe(429);
		expect((await rotaAdmin(dePara('198.51.100.9'), env, AGORA)).status).toBe(200);
	});

	it('não guarda o IP — a chave é um hash com o segredo pelo meio', async () => {
		await falharVezes(1, '203.0.113.1');

		const [linha] = db.sql('SELECT * FROM tentativas_admin');
		expect(JSON.stringify(linha)).not.toContain('203.0.113.1');
		expect(linha!.chave).toBe(await sha256Hex(`203.0.113.1|${SEGREDO_ADMIN}`));
		expect(linha!.chave).not.toBe(await sha256Hex('203.0.113.1'));
	});

	it('sem cabeçalho de IP, tudo cai no mesmo balde — aperta, não abre', async () => {
		for (let i = 0; i < MAX_FALHAS_ADMIN; i++) {
			await rotaAdmin(pedido('/api/admin/emparelhamentos', { segredo: 'errado' }), env, AGORA);
		}

		expect((await rotaAdmin(pedido('/api/admin/emparelhamentos'), env, AGORA)).status).toBe(429);
	});

	it('arruma os baldes esquecidos quando passa pelo caminho da falha', async () => {
		await db
			.prepare('INSERT INTO tentativas_admin (chave, falhas, primeira_em, ultima_em) VALUES (?, 3, ?, ?)')
			.bind('balde-velho', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
			.run();

		await falharVezes(1);

		expect(db.sql("SELECT COUNT(*) AS n FROM tentativas_admin WHERE chave = 'balde-velho'")[0]!.n).toBe(0);
	});

	it('um bloqueio com data ilegível conta como bloqueado — falha fechado', () => {
		const balde = { falhas: 99, primeira_em: '', ultima_em: '', bloqueado_ate: 'nao-e-data' };

		expect(estaBloqueado(balde, AGORA)).toBe(true);
		expect(segundosAteDesbloquear(balde, AGORA)).toBe(BLOQUEIO_MS / 1000);
	});
});

describe('autenticação do admin', () => {
	it('aceita o segredo certo', async () => {
		expect(await autenticarAdmin(pedido('/api/admin/nucleos'), env)).toBe(true);
	});

	it('recusa o errado, o vazio e o ausente', async () => {
		expect(await autenticarAdmin(pedido('/api/admin/nucleos', { segredo: 'outro' }), env)).toBe(false);
		expect(await autenticarAdmin(pedido('/api/admin/nucleos', { segredo: '' }), env)).toBe(false);
		expect(await autenticarAdmin(pedido('/api/admin/nucleos', { segredo: null }), env)).toBe(false);
	});

	it('recusa um segredo que só acerta no prefixo', async () => {
		expect(await autenticarAdmin(pedido('/api/admin/nucleos', { segredo: SEGREDO_ADMIN.slice(0, -1) }), env)).toBe(false);
		expect(await autenticarAdmin(pedido('/api/admin/nucleos', { segredo: SEGREDO_ADMIN + 'a' }), env)).toBe(false);
	});

	it('sem segredo configurado não entra ninguém — a falta de configuração não abre a porta', async () => {
		const registo = vi.spyOn(console, 'error').mockImplementation(() => {});
		const semSegredo: EnvAdmin = { ...env, ADMIN_SECRET: undefined };

		expect(await autenticarAdmin(pedido('/api/admin/nucleos'), semSegredo)).toBe(false);
		expect(await autenticarAdmin(pedido('/api/admin/nucleos', { segredo: '' }), semSegredo)).toBe(false);
		expect(registo).toHaveBeenCalledWith({ evento: 'admin.sem_segredo_configurado' });
	});

	it('fecha todas as rotas de admin de uma vez', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		for (const caminho of [
			'/api/admin/nucleos',
			'/api/admin/emparelhamentos',
			'/api/admin/emparelhamentos/aprovar',
			'/api/admin/dispositivos',
			'/api/admin/dispositivos/revogar',
			'/api/admin/rota-que-nao-existe',
		]) {
			const resposta = await rotaAdmin(pedido(caminho, { metodo: 'POST', corpo: {}, segredo: 'errado' }), env, AGORA);
			expect(resposta.status, caminho).toBe(401);
		}
	});
});

describe('GET /api/admin/emparelhamentos', () => {
	it('lista os pendentes com o que a sede precisa de ver', async () => {
		await semearPendente('111111');

		const resposta = await rotaAdmin(pedido('/api/admin/emparelhamentos'), env, AGORA);
		const corpo = (await resposta.json()) as { pendentes: { codigo: string; criado_em: string; expira_em: string }[] };

		expect(resposta.status).toBe(200);
		expect(corpo.pendentes).toEqual([{ codigo: '111111', criado_em: '2026-09-05T10:00:00.000Z', expira_em: '2026-09-05T10:15:00.000Z' }]);
	});

	it('não mostra os que já caducaram, mesmo que a base ainda os diga pendentes', async () => {
		await semearPendente('111111', '2026-09-05T09:00:00.000Z');
		await semearPendente('222222', '2026-09-05T10:15:00.000Z');

		expect((await listarPendentes(db, AGORA)).map((linha) => linha.codigo)).toEqual(['222222']);
		// E não os marca: quem varre é a rota de início de emparelhamento.
		expect(db.sql("SELECT estado FROM emparelhamentos WHERE codigo = '111111'")[0]!.estado).toBe('pendente');
	});

	it('não mostra aprovados nem recolhidos', async () => {
		await semearPendente('111111');
		await db.prepare("UPDATE emparelhamentos SET estado = 'aprovado', company_id = 7 WHERE codigo = '111111'").run();

		expect(await listarPendentes(db, AGORA)).toEqual([]);
	});
});

describe('POST /api/admin/emparelhamentos/aprovar', () => {
	it('aprova e atribui o núcleo escolhido', async () => {
		await semearPendente('111111');
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		const resposta = await rotaAdmin(
			pedido('/api/admin/emparelhamentos/aprovar', { metodo: 'POST', corpo: { codigo: '111111', company_id: 7 } }),
			env,
			AGORA,
		);

		expect(resposta.status).toBe(200);
		const [linha] = db.sql("SELECT * FROM emparelhamentos WHERE codigo = '111111'");
		expect(linha!.estado).toBe('aprovado');
		expect(linha!.company_id).toBe(7);
		expect(linha!.aprovado_em).toBe(AGORA.toISOString());
	});

	it('não estica a validade: o expira_em fica como estava', async () => {
		await semearPendente('111111', '2026-09-05T10:05:00.000Z');
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		await rotaAdmin(
			pedido('/api/admin/emparelhamentos/aprovar', { metodo: 'POST', corpo: { codigo: '111111', company_id: 7 } }),
			env,
			AGORA,
		);

		expect(db.sql("SELECT expira_em FROM emparelhamentos WHERE codigo = '111111'")[0]!.expira_em).toBe('2026-09-05T10:05:00.000Z');
	});

	it('recusa aprovar um que caducou entre a listagem e o clique', async () => {
		await semearPendente('111111', '2026-09-05T09:59:00.000Z');

		const resposta = await rotaAdmin(
			pedido('/api/admin/emparelhamentos/aprovar', { metodo: 'POST', corpo: { codigo: '111111', company_id: 7 } }),
			env,
			AGORA,
		);

		expect(resposta.status).toBe(409);
		expect(await resposta.json()).toEqual({ ok: false, erro: 'nao_aprovavel' });
		expect(db.sql("SELECT estado, company_id FROM emparelhamentos WHERE codigo = '111111'")[0]).toMatchObject({
			estado: 'pendente',
			company_id: null,
		});
	});

	it('recusa aprovar duas vezes', async () => {
		await semearPendente('111111');
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		const pedidoAprovar = () =>
			rotaAdmin(pedido('/api/admin/emparelhamentos/aprovar', { metodo: 'POST', corpo: { codigo: '111111', company_id: 7 } }), env, AGORA);

		expect((await pedidoAprovar()).status).toBe(200);
		expect((await pedidoAprovar()).status).toBe(409);
	});

	it('recusa um núcleo que o Odoo não conhece — o número vem do corpo do pedido', async () => {
		await semearPendente('111111');

		const resposta = await rotaAdmin(
			pedido('/api/admin/emparelhamentos/aprovar', { metodo: 'POST', corpo: { codigo: '111111', company_id: 999 } }),
			env,
			AGORA,
		);

		expect(resposta.status).toBe(400);
		expect(await resposta.json()).toEqual({ ok: false, erro: 'nucleo_desconhecido' });
		expect(db.sql("SELECT estado FROM emparelhamentos WHERE codigo = '111111'")[0]!.estado).toBe('pendente');
	});

	/**
	 * A empresa existe no Odoo, tem nome de núcleo e está pendurada na empresa-mãe — e mesmo assim
	 * não passa, porque não está no `company_ids` do utilizador de integração. Em staging são três,
	 * uma delas chamada `PT Núcleo <nome>`.
	 *
	 * Sem esta cerca, aprovar criava um dispositivo com token válido para uma empresa que o Worker
	 * nunca consegue ler, e o erro só aparecia no televisor, semanas depois, vindo do Odoo.
	 */
	it('recusa uma empresa real do Odoo que esteja fora das empresas permitidas', async () => {
		await semearPendente('111111');

		const FORA = 140;
		expect(EMPRESAS_PERMITIDAS).not.toContain(FORA);
		vi.mocked(OdooClient.prototype.searchRead).mockImplementation(async (modelo) => {
			if (modelo === 'res.users') return [{ id: 36, company_ids: EMPRESAS_PERMITIDAS }] as never;
			// O que o Odoo devolve para o domínio restringido: a empresa de fora não vem cá.
			return NUCLEOS as never;
		});

		const resposta = await rotaAdmin(
			pedido('/api/admin/emparelhamentos/aprovar', { metodo: 'POST', corpo: { codigo: '111111', company_id: FORA } }),
			env,
			AGORA,
		);

		expect(resposta.status).toBe(400);
		expect(await resposta.json()).toEqual({ ok: false, erro: 'nucleo_desconhecido' });
		expect(db.sql("SELECT estado, company_id FROM emparelhamentos WHERE codigo = '111111'")[0]).toMatchObject({
			estado: 'pendente',
			company_id: null,
		});
	});

	it('recusa entradas mal formadas', async () => {
		await semearPendente('111111');

		const casos: [unknown, string][] = [
			[{ codigo: '11111', company_id: 7 }, 'codigo_invalido'],
			[{ codigo: 111111, company_id: 7 }, 'codigo_invalido'],
			[{ codigo: '111111' }, 'nucleo_invalido'],
			[{ codigo: '111111', company_id: '7' }, 'nucleo_invalido'],
			[{ codigo: '111111', company_id: -1 }, 'nucleo_invalido'],
			[{ codigo: '111111', company_id: 1.5 }, 'nucleo_invalido'],
		];

		for (const [corpo, esperado] of casos) {
			const resposta = await rotaAdmin(pedido('/api/admin/emparelhamentos/aprovar', { metodo: 'POST', corpo }), env, AGORA);
			expect(await resposta.json(), JSON.stringify(corpo)).toEqual({ ok: false, erro: esperado });
		}
	});
});

describe('GET /api/admin/dispositivos', () => {
	beforeEach(async () => {
		await semearDispositivo('d1', 7, '2026-01-10T08:00:00.000Z');
		await semearDispositivo('d2', 7, '2026-02-10T08:00:00.000Z');
		await semearDispositivo('d3', 12, '2026-03-10T08:00:00.000Z');
	});

	it('numera dentro de cada núcleo, e não à escala da lista toda', async () => {
		const dispositivos = await listarDispositivos(db);

		expect(dispositivos.map((d) => [d.company_id, d.id, d.ordinal])).toEqual([
			[7, 'd1', 1],
			[7, 'd2', 2],
			[12, 'd3', 1],
		]);
	});

	it('mantém o número do revogado, para os outros não mudarem de nome', async () => {
		await revogarDispositivo(db, 'd1', AGORA);
		const dispositivos = await listarDispositivos(db);

		expect(dispositivos.find((d) => d.id === 'd1')).toMatchObject({ ordinal: 1, revogado: true });
		expect(dispositivos.find((d) => d.id === 'd2')).toMatchObject({ ordinal: 2, revogado: false });
	});

	it('não devolve o hash do token nem nada que não seja estado técnico', async () => {
		const resposta = await rotaAdmin(pedido('/api/admin/dispositivos'), env, AGORA);
		const texto = await resposta.text();

		expect(texto).not.toContain('token_hash');
		expect(texto).not.toContain(await sha256Hex('tv_d1'));
	});
});

describe('POST /api/admin/dispositivos/revogar', () => {
	beforeEach(async () => {
		await semearDispositivo('d1', 7, '2026-01-10T08:00:00.000Z');
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	it('revoga e preenche o revogado_em', async () => {
		const resposta = await rotaAdmin(pedido('/api/admin/dispositivos/revogar', { metodo: 'POST', corpo: { id: 'd1' } }), env, AGORA);

		expect(resposta.status).toBe(200);
		expect(db.sql("SELECT revogado, revogado_em FROM dispositivos WHERE id = 'd1'")[0]).toEqual({
			revogado: 1,
			revogado_em: AGORA.toISOString(),
		});
	});

	it('não reescreve a data quando se carrega no botão outra vez', async () => {
		await revogarDispositivo(db, 'd1', AGORA);
		const maisTarde = new Date('2026-09-05T18:00:00.000Z');

		const resposta = await rotaAdmin(pedido('/api/admin/dispositivos/revogar', { metodo: 'POST', corpo: { id: 'd1' } }), env, maisTarde);

		expect(await resposta.json()).toEqual({ ok: true, ja_revogado: true });
		expect(db.sql("SELECT revogado_em FROM dispositivos WHERE id = 'd1'")[0]!.revogado_em).toBe(AGORA.toISOString());
	});

	it('dá 404 a um dispositivo que não existe', async () => {
		const resposta = await rotaAdmin(
			pedido('/api/admin/dispositivos/revogar', { metodo: 'POST', corpo: { id: 'nao-existe' } }),
			env,
			AGORA,
		);
		expect(resposta.status).toBe(404);
	});

	it('recusa um id mal formado', async () => {
		const resposta = await rotaAdmin(pedido('/api/admin/dispositivos/revogar', { metodo: 'POST', corpo: { id: '' } }), env, AGORA);
		expect(resposta.status).toBe(400);
	});
});

describe('GET /api/admin/nucleos', () => {
	it('devolve o que o Odoo tem, pela ordem em que veio', async () => {
		const resposta = await rotaAdmin(pedido('/api/admin/nucleos'), env, AGORA);
		expect(await resposta.json()).toEqual({ ok: true, nucleos: NUCLEOS });
	});

	it('pede só os campos precisos, sem ordenação, e restringe às empresas do utilizador', async () => {
		await rotaAdmin(pedido('/api/admin/nucleos'), env, AGORA);

		// Primeiro o utilizador, que é quem diz quais são as empresas permitidas. A lista **nunca**
		// sai de uma leitura aberta de `res.company`: a base tem empresas que este Worker não
		// consegue ler, e pô-las no dropdown é criar um ecrã que falha semanas depois.
		expect(OdooClient.prototype.searchRead).toHaveBeenCalledWith('res.users', [['login', '=', 'u']], {
			fields: ['company_ids'],
			limit: 1,
			lang: LINGUA_DA_TV,
		});

		// Sem `order`: as empresas são ordenadas à mão no Odoo e é essa a ordem que vale. Se alguém
		// voltar a pôr uma ordenação aqui, este teste fica vermelho antes de a lista chegar à sede
		// com uma ordem que ninguém reconhece.
		expect(OdooClient.prototype.searchRead).toHaveBeenCalledWith('res.company', [['id', 'in', EMPRESAS_PERMITIDAS]], {
			fields: ['name', 'center_prefix'],
			limit: 200,
			lang: LINGUA_DA_TV,
		});
	});

	it('devolve lista vazia — e não todas — quando o utilizador não tem empresa nenhuma', async () => {
		vi.mocked(OdooClient.prototype.searchRead).mockImplementation(async (modelo) => {
			if (modelo === 'res.users') return [{ id: 36, company_ids: [] }] as never;
			throw new Error('não devia chegar ao res.company com company_ids vazio');
		});

		const resposta = await rotaAdmin(pedido('/api/admin/nucleos'), env, AGORA);
		expect(await resposta.json()).toEqual({ ok: true, nucleos: [] });
	});

	it('falha fechada quando o utilizador de integração não existe no Odoo', async () => {
		vi.mocked(OdooClient.prototype.searchRead).mockResolvedValue([] as never);
		vi.spyOn(console, 'error').mockImplementation(() => {});

		const resposta = await rotaAdmin(pedido('/api/admin/nucleos'), env, AGORA);

		// 502, e não uma lista aberta: sem saber quais são as empresas permitidas, não se mostra nada.
		expect(resposta.status).toBe(502);
		expect(await resposta.json()).toEqual({ ok: false, erro: 'odoo_indisponivel' });
	});

	it('devolve os núcleos pela ordem em que o Odoo os deu, sem os mexer', async () => {
		const comoVieram: Nucleo[] = [
			{ id: 3, name: 'Zulu', center_prefix: 'ZUL' },
			{ id: 9, name: 'Alfa', center_prefix: 'ALF' },
			{ id: 5, name: 'Mike', center_prefix: 'MIK' },
		];
		vi.mocked(OdooClient.prototype.searchRead).mockImplementation(async (modelo) => {
			if (modelo === 'res.users') return [{ id: 36, company_ids: comoVieram.map((n) => n.id) }] as never;
			return comoVieram as never;
		});

		const resposta = await rotaAdmin(pedido('/api/admin/nucleos'), env, AGORA);

		expect((await resposta.json()) as { nucleos: Nucleo[] }).toEqual({ ok: true, nucleos: comoVieram });
	});

	it('responde 502 quando o Odoo não responde, em vez de rebentar', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.mocked(OdooClient.prototype.searchRead).mockRejectedValueOnce(new Error('sem rede'));

		const resposta = await rotaAdmin(pedido('/api/admin/nucleos'), env, AGORA);

		expect(resposta.status).toBe(502);
		expect(await resposta.json()).toEqual({ ok: false, erro: 'odoo_indisponivel' });
	});

	it('não aprova nada se não conseguir confirmar o núcleo contra o Odoo', async () => {
		await semearPendente('111111');
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.mocked(OdooClient.prototype.searchRead).mockRejectedValueOnce(new Error('sem rede'));

		const resposta = await rotaAdmin(
			pedido('/api/admin/emparelhamentos/aprovar', { metodo: 'POST', corpo: { codigo: '111111', company_id: 7 } }),
			env,
			AGORA,
		);

		expect(resposta.status).toBe(502);
		expect(db.sql("SELECT estado FROM emparelhamentos WHERE codigo = '111111'")[0]!.estado).toBe('pendente');
	});
});
