import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '../src/auth';
import {
	colisaoEm,
	procurarPorCodigoESegredo,
	recolherToken,
	rotaEstadoEmparelhamento,
	rotaIniciarEmparelhamento,
	rotaRecolherToken,
} from '../src/emparelhamento';
import { novaBase, type D1Falso } from './d1-falso';

const AGORA = new Date('2026-09-05T10:00:00.000Z');
const SEGREDO = 'seg_umSegredoDeTesteQueNaoVaiParaLadoNenhum';

let db: D1Falso;
let env: { DB: D1Falso };

beforeEach(() => {
	db = novaBase();
	env = { DB: db };
});

afterEach(() => {
	vi.restoreAllMocks();
});

function pedido(caminho: string, corpo: unknown): Request {
	return new Request(`https://tv.refood.test${caminho}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(corpo),
	});
}

/** Cria um emparelhamento directamente na base, no estado e no prazo que o teste precisar. */
async function semearEmparelhamento(
	opcoes: Partial<{ codigo: string; segredo: string; estado: string; expira_em: string; company_id: number }> = {},
) {
	const codigo = opcoes.codigo ?? '123456';
	const segredo = opcoes.segredo ?? SEGREDO;
	const estado = opcoes.estado ?? 'pendente';
	const empresa = opcoes.company_id ?? (estado === 'pendente' ? null : 7);

	// Um emparelhamento recolhido tem de apontar para um dispositivo — é o CHECK da 0002 que o
	// exige, e o cenário só é honesto se o dispositivo existir mesmo.
	let dispositivo: string | null = null;
	if (estado === 'recolhido') {
		dispositivo = 'disp-1';
		await db
			.prepare('INSERT INTO dispositivos (id, token_hash, company_id, criado_em) VALUES (?, ?, ?, ?)')
			.bind(dispositivo, await sha256Hex('tv_token-semeado'), empresa, AGORA.toISOString())
			.run();
	}

	await db
		.prepare(
			`INSERT INTO emparelhamentos (id, codigo, segredo_hash, estado, company_id, dispositivo_id, criado_em, expira_em)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			'emp-1',
			codigo,
			await sha256Hex(segredo),
			estado,
			empresa,
			dispositivo,
			AGORA.toISOString(),
			opcoes.expira_em ?? '2026-09-05T10:15:00.000Z',
		)
		.run();

	return { codigo, segredo };
}

describe('POST /api/emparelhamento — iniciar', () => {
	it('devolve um código de 6 dígitos e a expiração, e deixa a linha pendente', async () => {
		const hash = await sha256Hex(SEGREDO);
		const resposta = await rotaIniciarEmparelhamento(pedido('/api/emparelhamento', { segredo_hash: hash }), env, AGORA);
		const corpo = (await resposta.json()) as { ok: boolean; codigo: string; expira_em: string };

		expect(resposta.status).toBe(201);
		expect(corpo.codigo).toMatch(/^\d{6}$/);
		expect(corpo.expira_em).toBe('2026-09-05T10:15:00.000Z');

		const [linha] = db.sql('SELECT * FROM emparelhamentos');
		expect(linha!.estado).toBe('pendente');
		expect(linha!.company_id).toBeNull();
		expect(linha!.dispositivo_id).toBeNull();
	});

	it('guarda o hash e nunca o segredo — em coluna nenhuma', async () => {
		const hash = await sha256Hex(SEGREDO);
		await rotaIniciarEmparelhamento(pedido('/api/emparelhamento', { segredo_hash: hash }), env, AGORA);

		const [linha] = db.sql('SELECT * FROM emparelhamentos');
		expect(linha!.segredo_hash).toBe(hash);
		expect(JSON.stringify(linha)).not.toContain(SEGREDO);
	});

	it('recusa um segredo_hash que não seja SHA-256 em hex', async () => {
		for (const invalido of ['', 'abc', 'z'.repeat(64), (await sha256Hex(SEGREDO)).toUpperCase(), 'a'.repeat(63)]) {
			const resposta = await rotaIniciarEmparelhamento(pedido('/api/emparelhamento', { segredo_hash: invalido }), env, AGORA);
			expect(resposta.status, invalido).toBe(400);
		}
	});

	it('recusa um corpo que não é objecto JSON', async () => {
		const cru = new Request('https://tv.refood.test/api/emparelhamento', { method: 'POST', body: 'isto não é json' });
		expect((await rotaIniciarEmparelhamento(cru, env, AGORA)).status).toBe(400);
	});

	it('recusa o segredo que já tem um emparelhamento vivo, em vez de o duplicar', async () => {
		const hash = await sha256Hex(SEGREDO);
		await rotaIniciarEmparelhamento(pedido('/api/emparelhamento', { segredo_hash: hash }), env, AGORA);
		const repetido = await rotaIniciarEmparelhamento(pedido('/api/emparelhamento', { segredo_hash: hash }), env, AGORA);

		expect(repetido.status).toBe(409);
		expect(await repetido.json()).toEqual({ ok: false, erro: 'segredo_em_uso' });
		expect(db.sql('SELECT COUNT(*) AS n FROM emparelhamentos')[0]!.n).toBe(1);
	});

	describe('a varredura de caducidade, que corre antes de emitir o código', () => {
		it('apanha os pendentes fora de prazo', async () => {
			await semearEmparelhamento({ estado: 'pendente', expira_em: '2026-09-05T09:00:00.000Z' });

			await rotaIniciarEmparelhamento(pedido('/api/emparelhamento', { segredo_hash: await sha256Hex('outro') }), env, AGORA);

			expect(db.sql("SELECT estado FROM emparelhamentos WHERE id = 'emp-1'")[0]!.estado).toBe('expirado');
		});

		it('apanha também os aprovados que ninguém recolheu — que é o que a query óbvia deixava para trás', async () => {
			await semearEmparelhamento({ estado: 'aprovado', company_id: 7, expira_em: '2026-09-05T09:00:00.000Z' });

			await rotaIniciarEmparelhamento(pedido('/api/emparelhamento', { segredo_hash: await sha256Hex('outro') }), env, AGORA);

			expect(db.sql("SELECT estado FROM emparelhamentos WHERE id = 'emp-1'")[0]!.estado).toBe('expirado');
		});

		it('liberta o código de um caducado para ser reemitido — é para isso que a varredura existe', async () => {
			// O código antigo está preso no índice único parcial enquanto a linha estiver viva.
			await semearEmparelhamento({ codigo: '424242', estado: 'aprovado', company_id: 7, expira_em: '2026-09-05T09:00:00.000Z' });

			const resposta = await rotaIniciarEmparelhamento(
				pedido('/api/emparelhamento', { segredo_hash: await sha256Hex('outro') }),
				env,
				AGORA,
			);
			expect(resposta.status).toBe(201);

			// Com o antigo já expirado, inserir '424242' outra vez passa a ser possível.
			await db
				.prepare(`INSERT INTO emparelhamentos (id, codigo, segredo_hash, estado, criado_em, expira_em) VALUES (?, ?, ?, 'pendente', ?, ?)`)
				.bind('emp-2', '424242', await sha256Hex('terceiro'), AGORA.toISOString(), '2026-09-05T10:15:00.000Z')
				.run();

			expect(db.sql("SELECT COUNT(*) AS n FROM emparelhamentos WHERE codigo = '424242'")[0]!.n).toBe(2);
		});

		it('não toca nos que ainda estão dentro do prazo', async () => {
			await semearEmparelhamento({ estado: 'aprovado', company_id: 7, expira_em: '2026-09-05T10:10:00.000Z' });

			await rotaIniciarEmparelhamento(pedido('/api/emparelhamento', { segredo_hash: await sha256Hex('outro') }), env, AGORA);

			expect(db.sql("SELECT estado FROM emparelhamentos WHERE id = 'emp-1'")[0]!.estado).toBe('aprovado');
		});
	});
});

describe('POST /api/emparelhamento — colisão de código', () => {
	/** Substitui só o `generateCode`, para se poder forçar colisões que de outra forma não acontecem. */
	async function comCodigosFixos(codigos: string[]) {
		const real = await vi.importActual<typeof import('../src/auth')>('../src/auth');
		let indice = 0;
		vi.doMock('../src/auth', () => ({ ...real, generateCode: () => codigos[Math.min(indice++, codigos.length - 1)]! }));
		vi.resetModules();
		return await import('../src/emparelhamento');
	}

	afterEach(() => {
		vi.doUnmock('../src/auth');
		vi.resetModules();
	});

	it('sorteia outro código quando o primeiro está ocupado', async () => {
		await semearEmparelhamento({ codigo: '111111' });
		const rotas = await comCodigosFixos(['111111', '222222']);

		const resposta = await rotas.rotaIniciarEmparelhamento(
			pedido('/api/emparelhamento', { segredo_hash: await sha256Hex('outro') }),
			env,
			AGORA,
		);

		expect(resposta.status).toBe(201);
		expect(await resposta.json()).toMatchObject({ codigo: '222222' });
	});

	it('desiste com erro claro quando as tentativas se esgotam, em vez de ficar a rodar', async () => {
		await semearEmparelhamento({ codigo: '111111' });
		const rotas = await comCodigosFixos(['111111']);
		const registo = vi.spyOn(console, 'error').mockImplementation(() => {});

		const resposta = await rotas.rotaIniciarEmparelhamento(
			pedido('/api/emparelhamento', { segredo_hash: await sha256Hex('outro') }),
			env,
			AGORA,
		);

		expect(resposta.status).toBe(503);
		expect(await resposta.json()).toEqual({ ok: false, erro: 'codigos_esgotados' });
		expect(registo).toHaveBeenCalledWith(expect.objectContaining({ evento: 'emparelhamento.codigos_esgotados' }));
		expect(db.sql('SELECT COUNT(*) AS n FROM emparelhamentos')[0]!.n).toBe(1);
	});
});

describe('reconhecimento da colisão de índice único', () => {
	/**
	 * O texto exacto que o D1 entrega dentro do Worker, apanhado uma vez contra a base de staging
	 * com um `console.error` temporário no `catch`. Não é inventado nem copiado da documentação: foi
	 * lido de um Worker a correr contra o D1 remoto, em setembro de 2026.
	 */
	const MENSAGEM_D1 =
		'D1_ERROR: UNIQUE constraint failed: emparelhamentos.segredo_hash: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)';

	/** A mesma violação vista pela API HTTP do D1, sem o prefixo `D1_ERROR`. */
	const MENSAGEM_API =
		'UNIQUE constraint failed: emparelhamentos.codigo: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE) [code: 7500]';

	it('reconhece a mensagem que o SQLite a sério produz', async () => {
		const db = novaBase();
		const inserir = async (id: string) =>
			await db
				.prepare(
					`INSERT INTO emparelhamentos (id, codigo, segredo_hash, estado, criado_em, expira_em) VALUES (?, '555555', ?, 'pendente', ?, ?)`,
				)
				.bind(id, await sha256Hex(id), AGORA.toISOString(), '2026-09-05T10:15:00.000Z')
				.run();

		await inserir('a');
		const erro = await inserir('b').catch((falha: unknown) => falha);

		expect(colisaoEm(erro, 'codigo')).toBe(true);
		expect(colisaoEm(erro, 'segredo_hash')).toBe(false);
	});

	it('reconhece as duas formas observadas da mensagem do D1', () => {
		expect(colisaoEm(new Error(MENSAGEM_D1), 'segredo_hash')).toBe(true);
		expect(colisaoEm(new Error(MENSAGEM_D1), 'codigo')).toBe(false);
		expect(colisaoEm(new Error(MENSAGEM_API), 'codigo')).toBe(true);
	});

	it('não confunde outra falha com uma colisão', () => {
		expect(colisaoEm(new Error('D1_ERROR: no such table: emparelhamentos'), 'codigo')).toBe(false);
		expect(colisaoEm(new Error('CHECK constraint failed: emparelhamentos.codigo'), 'codigo')).toBe(false);
		expect(colisaoEm(new Error('UNIQUE constraint failed: dispositivos.token_hash'), 'codigo')).toBe(false);
		expect(colisaoEm('uma string qualquer', 'codigo')).toBe(false);
	});
});

describe('POST /api/emparelhamento/estado — polling', () => {
	it('diz pendente enquanto a sede não aprovou', async () => {
		const { codigo, segredo } = await semearEmparelhamento();
		const resposta = await rotaEstadoEmparelhamento(pedido('/api/emparelhamento/estado', { codigo, segredo }), env, AGORA);

		expect(resposta.status).toBe(200);
		expect(await resposta.json()).toMatchObject({ estado: 'pendente', expira_em: '2026-09-05T10:15:00.000Z' });
	});

	it('diz pronto depois de aprovado', async () => {
		const { codigo, segredo } = await semearEmparelhamento({ estado: 'aprovado', company_id: 7 });
		const resposta = await rotaEstadoEmparelhamento(pedido('/api/emparelhamento/estado', { codigo, segredo }), env, AGORA);

		expect(await resposta.json()).toMatchObject({ estado: 'pronto' });
	});

	it('diz expirado a um aprovado fora de prazo — a aprovação não estica a validade', async () => {
		const { codigo, segredo } = await semearEmparelhamento({ estado: 'aprovado', company_id: 7, expira_em: '2026-09-05T09:00:00.000Z' });
		const resposta = await rotaEstadoEmparelhamento(pedido('/api/emparelhamento/estado', { codigo, segredo }), env, AGORA);

		expect(await resposta.json()).toMatchObject({ estado: 'expirado' });
	});

	it('diz expirado a um pendente fora de prazo antes de a varredura lá chegar', async () => {
		const { codigo, segredo } = await semearEmparelhamento({ expira_em: '2026-09-05T09:00:00.000Z' });
		const resposta = await rotaEstadoEmparelhamento(pedido('/api/emparelhamento/estado', { codigo, segredo }), env, AGORA);

		expect(await resposta.json()).toMatchObject({ estado: 'expirado' });
		// A linha continua 'pendente' na base: quem a marca é a rota de início, não esta.
		expect(db.sql("SELECT estado FROM emparelhamentos WHERE id = 'emp-1'")[0]!.estado).toBe('pendente');
	});

	it('não distingue, para o cliente, um código inexistente de um segredo errado', async () => {
		await semearEmparelhamento({ codigo: '123456' });

		const errado = await rotaEstadoEmparelhamento(
			pedido('/api/emparelhamento/estado', { codigo: '123456', segredo: 'seg_outro' }),
			env,
			AGORA,
		);
		const inexistente = await rotaEstadoEmparelhamento(
			pedido('/api/emparelhamento/estado', { codigo: '999999', segredo: SEGREDO }),
			env,
			AGORA,
		);

		const corpoErrado = await errado.json();
		const corpoInexistente = await inexistente.json();

		expect(errado.status).toBe(inexistente.status);
		expect(corpoErrado).toEqual(corpoInexistente);
		expect(corpoErrado).toEqual({ ok: true, estado: 'expirado' });
	});

	it('regista o segredo errado sobre código válido, e só esse', async () => {
		await semearEmparelhamento({ codigo: '123456' });
		const registo = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await rotaEstadoEmparelhamento(pedido('/api/emparelhamento/estado', { codigo: '999999', segredo: SEGREDO }), env, AGORA);
		expect(registo).not.toHaveBeenCalled();

		await rotaEstadoEmparelhamento(pedido('/api/emparelhamento/estado', { codigo: '123456', segredo: 'seg_outro' }), env, AGORA);
		expect(registo).toHaveBeenCalledWith({ evento: 'emparelhamento.segredo_errado', codigo: '123456' });
	});

	it('regista o segredo errado mesmo quando o código já foi recolhido — não escapa por filtro de estado', async () => {
		await semearEmparelhamento({ codigo: '123456', estado: 'recolhido', company_id: 7 });
		const registo = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await rotaEstadoEmparelhamento(pedido('/api/emparelhamento/estado', { codigo: '123456', segredo: 'seg_outro' }), env, AGORA);

		expect(registo).toHaveBeenCalledWith({ evento: 'emparelhamento.segredo_errado', codigo: '123456' });
	});

	it('a um código já recolhido responde expirado: a TV só pode pedir outro', async () => {
		const { codigo, segredo } = await semearEmparelhamento({ estado: 'recolhido', company_id: 7 });
		const registo = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const resposta = await rotaEstadoEmparelhamento(pedido('/api/emparelhamento/estado', { codigo, segredo }), env, AGORA);

		expect(await resposta.json()).toEqual({ ok: true, estado: 'expirado' });
		expect(registo).toHaveBeenCalledWith(expect.objectContaining({ evento: 'emparelhamento.polling_apos_recolha' }));
	});

	it('recusa pedidos mal formados sem ir à base', async () => {
		for (const corpo of [{}, { codigo: '12345', segredo: SEGREDO }, { codigo: 'abcdef', segredo: SEGREDO }, { codigo: '123456' }]) {
			const resposta = await rotaEstadoEmparelhamento(pedido('/api/emparelhamento/estado', corpo), env, AGORA);
			expect(resposta.status, JSON.stringify(corpo)).toBe(400);
		}
	});
});

describe('POST /api/emparelhamento/recolher', () => {
	it('emite o token, cria o dispositivo no núcleo aprovado e fecha o emparelhamento', async () => {
		const { codigo, segredo } = await semearEmparelhamento({ estado: 'aprovado', company_id: 7 });

		const resposta = await rotaRecolherToken(pedido('/api/emparelhamento/recolher', { codigo, segredo }), env, AGORA);
		const corpo = (await resposta.json()) as { ok: boolean; token: string };

		expect(resposta.status).toBe(201);
		expect(corpo.token).toMatch(/^tv_[A-Za-z0-9_-]{43}$/);

		const [dispositivo] = db.sql('SELECT * FROM dispositivos');
		expect(dispositivo!.company_id).toBe(7);
		expect(dispositivo!.revogado).toBe(0);
		expect(dispositivo!.token_hash).toBe(await sha256Hex(corpo.token));

		const [emparelhamento] = db.sql('SELECT * FROM emparelhamentos');
		expect(emparelhamento!.estado).toBe('recolhido');
		expect(emparelhamento!.dispositivo_id).toBe(dispositivo!.id);
		expect(emparelhamento!.recolhido_em).toBe(AGORA.toISOString());
	});

	it('guarda o hash do token, e o token em claro não fica em lado nenhum', async () => {
		const { codigo, segredo } = await semearEmparelhamento({ estado: 'aprovado', company_id: 7 });
		const resposta = await rotaRecolherToken(pedido('/api/emparelhamento/recolher', { codigo, segredo }), env, AGORA);
		const { token } = (await resposta.json()) as { token: string };

		expect(JSON.stringify(db.sql('SELECT * FROM dispositivos'))).not.toContain(token);
		expect(JSON.stringify(db.sql('SELECT * FROM emparelhamentos'))).not.toContain(token);
	});

	it('o núcleo vem do emparelhamento, mesmo que o pedido tente sugerir outro', async () => {
		const { codigo, segredo } = await semearEmparelhamento({ estado: 'aprovado', company_id: 7 });

		await rotaRecolherToken(pedido('/api/emparelhamento/recolher', { codigo, segredo, company_id: 999, empresa: 999 }), env, AGORA);

		expect(db.sql('SELECT company_id FROM dispositivos')[0]!.company_id).toBe(7);
	});

	it('é de uso único: a segunda recolha não emite token nem cria segundo dispositivo', async () => {
		const { codigo, segredo } = await semearEmparelhamento({ estado: 'aprovado', company_id: 7 });
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		const primeira = await rotaRecolherToken(pedido('/api/emparelhamento/recolher', { codigo, segredo }), env, AGORA);
		const segunda = await rotaRecolherToken(pedido('/api/emparelhamento/recolher', { codigo, segredo }), env, AGORA);

		expect(primeira.status).toBe(201);
		expect(segunda.status).toBe(409);
		expect(await segunda.json()).toMatchObject({ ok: false, estado: 'recolhido' });
		expect(db.sql('SELECT COUNT(*) AS n FROM dispositivos')[0]!.n).toBe(1);
	});

	it('perde a corrida sem deixar dispositivo órfão', async () => {
		const { codigo, segredo } = await semearEmparelhamento({ estado: 'aprovado', company_id: 7 });
		const linha = (await procurarPorCodigoESegredo(db, codigo, await sha256Hex(segredo)))!;

		// Entre a leitura e a escrita, outro pedido recolheu. A inserção do dispositivo está
		// condicionada ao mesmo WHERE do UPDATE, por isso não fica nada para trás.
		await db.prepare("UPDATE emparelhamentos SET estado = 'expirado' WHERE id = ?").bind(linha.id).run();

		expect(await recolherToken(db, linha, AGORA)).toBeNull();
		expect(db.sql('SELECT COUNT(*) AS n FROM dispositivos')[0]!.n).toBe(0);
	});

	it('não recolhe um aprovado fora de prazo, e não cria dispositivo', async () => {
		const { codigo, segredo } = await semearEmparelhamento({ estado: 'aprovado', company_id: 7, expira_em: '2026-09-05T09:00:00.000Z' });

		const resposta = await rotaRecolherToken(pedido('/api/emparelhamento/recolher', { codigo, segredo }), env, AGORA);

		expect(resposta.status).toBe(409);
		expect(await resposta.json()).toMatchObject({ estado: 'expirado' });
		expect(db.sql('SELECT COUNT(*) AS n FROM dispositivos')[0]!.n).toBe(0);
	});

	it('não recolhe o que a sede ainda não aprovou', async () => {
		const { codigo, segredo } = await semearEmparelhamento({ estado: 'pendente' });

		const resposta = await rotaRecolherToken(pedido('/api/emparelhamento/recolher', { codigo, segredo }), env, AGORA);

		expect(resposta.status).toBe(409);
		expect(await resposta.json()).toMatchObject({ estado: 'pendente' });
		expect(db.sql('SELECT COUNT(*) AS n FROM dispositivos')[0]!.n).toBe(0);
	});

	it('dá 401 a quem tem o código mas não o segredo — e o mesmo a quem inventa o código', async () => {
		await semearEmparelhamento({ codigo: '123456', estado: 'aprovado', company_id: 7 });
		const registo = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const comCodigoDaParede = await rotaRecolherToken(
			pedido('/api/emparelhamento/recolher', { codigo: '123456', segredo: 'seg_outro' }),
			env,
			AGORA,
		);
		const inventado = await rotaRecolherToken(
			pedido('/api/emparelhamento/recolher', { codigo: '999999', segredo: 'seg_outro' }),
			env,
			AGORA,
		);

		expect(comCodigoDaParede.status).toBe(401);
		expect(inventado.status).toBe(401);
		expect(await comCodigoDaParede.json()).toEqual(await inventado.json());
		expect(db.sql('SELECT COUNT(*) AS n FROM dispositivos')[0]!.n).toBe(0);

		// Para o cliente são iguais; no registo não, e é a do código afixado na parede que interessa.
		expect(registo).toHaveBeenCalledTimes(1);
		expect(registo).toHaveBeenCalledWith({ evento: 'recolha.segredo_errado', codigo: '123456' });
	});
});
