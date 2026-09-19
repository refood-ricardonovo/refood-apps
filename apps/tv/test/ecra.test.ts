import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OdooClient } from '@refood/odoo';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	aprovarEmparelhamento,
	configurarDispositivo,
	formaDoLocal,
	listarDispositivos,
	localValido,
	MAX_LOCAL,
	rotaAdmin,
	type EnvAdmin,
} from '../src/admin';
import { recolherToken, type EmparelhamentoDb } from '../src/emparelhamento';
import { sha256Hex } from '../src/auth';
import { autenticarDispositivo } from '../src/sessao';
import { PAINEIS, PAINEL_POR_OMISSAO, painelValido } from '../src/paineis';
import { novaBase, type D1Falso } from './d1-falso';

/**
 * O painel com que um ecrã arranca, e a etiqueta de local.
 *
 * Duas colunas em `dispositivos` (migração `0005`) que se parecem e não são a mesma coisa:
 *
 * - o **painel inicial** é configuração técnica do aparelho, viaja para o televisor e não tem nada
 *   de pessoal;
 * - o **local** é texto livre escrito por pessoas, e a única coisa que o protege é nunca sair do
 *   admin. Essa é a cerca, e é ela que os testes de baixo guardam.
 */

const AGORA = new Date('2026-09-05T10:00:00.000Z');
const SEGREDO_ADMIN = 'um-segredo-de-teste-que-nao-sai-daqui';

let db: D1Falso;
let env: EnvAdmin;

beforeEach(async () => {
	db = novaBase();
	env = { DB: db, ADMIN_SECRET: SEGREDO_ADMIN, ODOO_URL: 'https://odoo.test', ODOO_DB: 't', ODOO_USERNAME: 'u', ODOO_PASSWORD: 'p' };
	await semearDispositivo('dis-1', 7);

	/*
	 * O unico ponto de contacto com o Odoo nestas rotas: o utilizador, que diz quais sao as
	 * empresas permitidas, e as empresas. Mesma substituicao do `admin.test.ts`.
	 */
	vi.spyOn(OdooClient.prototype, 'searchRead').mockImplementation(async (modelo) => {
		if (modelo === 'res.users') return [{ id: 36, company_ids: [7, 12] }] as never;
		return [{ id: 7, name: 'Refood Leiria', center_prefix: 'LRA' }] as never;
	});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

async function semearDispositivo(id: string, empresa: number, criado_em = '2026-09-01T09:00:00.000Z') {
	await db
		.prepare('INSERT INTO dispositivos (id, token_hash, company_id, criado_em) VALUES (?, ?, ?, ?)')
		.bind(id, await sha256Hex(`tv_${id}`), empresa, criado_em)
		.run();
}

function pedido(caminho: string, corpo: unknown): Request {
	return new Request(`https://tv.refood.test${caminho}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${SEGREDO_ADMIN}` },
		body: JSON.stringify(corpo),
	});
}

/** O que a base tem guardado, lido cru — sem passar pelas funções que estão a ser testadas. */
async function lido(id = 'dis-1') {
	return await db.prepare('SELECT painel_inicial, local FROM dispositivos WHERE id = ?').bind(id).first<{
		painel_inicial: string | null;
		local: string | null;
	}>();
}

describe('localValido', () => {
	it('aceita uma etiqueta corrente e apara o que está à volta', () => {
		expect(localValido('Cozinha')).toBe('Cozinha');
		expect(localValido('  Sala de convívio  ')).toBe('Sala de convívio');
	});

	/*
	 * Espaços interiores colapsados: numa lista larga escreve-se "Sala  de convívio" sem dar por
	 * isso, e duas etiquetas que só diferem nisso não são duas etiquetas.
	 */
	it('colapsa os espaços interiores', () => {
		expect(localValido('Sala   de    convívio')).toBe('Sala de convívio');
	});

	it('trata o vazio como limpar', () => {
		expect(localValido('')).toBeNull();
		expect(localValido('   ')).toBeNull();
		expect(localValido(null)).toBeNull();
	});

	/*
	 * **A quebra de linha é o caso que interessa.** É um rótulo de uma linha; um `\n` lá dentro não
	 * se vê no campo e desalinha tudo o que o mostre a seguir.
	 */
	it('recusa quebras de linha e caracteres de controlo', () => {
		expect(localValido('Cozinha\nSala')).toBeUndefined();
		expect(localValido('Cozinha\u0007')).toBeUndefined();
		expect(localValido('Cozinha\u007f')).toBeUndefined();
	});

	it(`recusa acima de ${MAX_LOCAL} caracteres e aceita no limite`, () => {
		expect(localValido('x'.repeat(MAX_LOCAL))).toBe('x'.repeat(MAX_LOCAL));
		expect(localValido('x'.repeat(MAX_LOCAL + 1))).toBeUndefined();
	});

	/*
	 * **O JS conta unidades UTF-16 e o `CHECK` da base conta caracteres.** Um emoji conta 2 aqui e 1
	 * lá, portanto esta validação é sempre a mais apertada das duas — e é isso que garante que uma
	 * etiqueta recusada volta como 400 e nunca como um erro de constraint em 500.
	 */
	it('é mais apertado do que o CHECK da base, nunca ao contrário', async () => {
		const quinzeEmoji = '🙂'.repeat(15); // 30 unidades UTF-16, 15 caracteres
		expect(localValido(quinzeEmoji)).toBe(quinzeEmoji);

		// E o que ele aceita, a base aceita: se esta relação se inverter, isto rebenta aqui.
		await configurarDispositivo(db, 'dis-1', { local: quinzeEmoji });
		expect((await lido())?.local).toBe(quinzeEmoji);
	});

	it('recusa o que não é texto', () => {
		expect(localValido(42)).toBeUndefined();
		expect(localValido({})).toBeUndefined();
	});
});

describe('painelValido', () => {
	it('aceita os painéis que existem', () => {
		for (const painel of PAINEIS) expect(painelValido(painel)).toBe(painel);
	});

	it('distingue limpar de não reconhecer', () => {
		expect(painelValido(null)).toBeNull();
		expect(painelValido('cozinha')).toBeUndefined();
		expect(painelValido('')).toBeUndefined();
	});
});

describe('configurarDispositivo', () => {
	it('guarda os dois campos', async () => {
		expect(await configurarDispositivo(db, 'dis-1', { painel_inicial: 'recolhas', local: 'Cozinha' })).toBe('guardado');
		expect(await lido()).toEqual({ painel_inicial: 'recolhas', local: 'Cozinha' });
	});

	/*
	 * Os campos são independentes: quem manda um não mexe no outro. A página envia os dois juntos,
	 * mas a rota não obriga, e uma correcção futura que só toque num não tem de reenviar o outro à
	 * espera de que não se perca pelo caminho.
	 */
	it('não mexe no campo que não vem', async () => {
		await configurarDispositivo(db, 'dis-1', { painel_inicial: 'recolhas', local: 'Cozinha' });

		await configurarDispositivo(db, 'dis-1', { local: 'Sala de convívio' });
		expect(await lido()).toEqual({ painel_inicial: 'recolhas', local: 'Sala de convívio' });

		await configurarDispositivo(db, 'dis-1', { painel_inicial: null });
		expect(await lido()).toEqual({ painel_inicial: null, local: 'Sala de convívio' });
	});

	it('não escreve num revogado', async () => {
		await db.prepare('UPDATE dispositivos SET revogado = 1 WHERE id = ?').bind('dis-1').run();

		expect(await configurarDispositivo(db, 'dis-1', { local: 'Cozinha' })).toBe('revogado');
		expect((await lido())?.local).toBeNull();
	});

	it('diz quando o dispositivo não existe', async () => {
		expect(await configurarDispositivo(db, 'dis-nenhum', { local: 'Cozinha' })).toBe('inexistente');
	});
});

describe('POST /api/admin/dispositivos/configurar', () => {
	it('guarda e devolve ok', async () => {
		const resposta = await rotaAdmin(
			pedido('/api/admin/dispositivos/configurar', { id: 'dis-1', painel_inicial: 'recolhas', local: 'Cozinha' }),
			env,
			AGORA,
		);

		expect(resposta.status).toBe(200);
		expect(await lido()).toEqual({ painel_inicial: 'recolhas', local: 'Cozinha' });
	});

	it('recusa um painel que não existe', async () => {
		const resposta = await rotaAdmin(pedido('/api/admin/dispositivos/configurar', { id: 'dis-1', painel_inicial: 'cozinha' }), env, AGORA);

		expect(resposta.status).toBe(400);
		expect(await resposta.json()).toMatchObject({ erro: 'painel_invalido' });
		expect((await lido())?.painel_inicial).toBeNull();
	});

	it('recusa um local com quebra de linha, e não guarda nada', async () => {
		const resposta = await rotaAdmin(pedido('/api/admin/dispositivos/configurar', { id: 'dis-1', local: 'Cozinha\nSala' }), env, AGORA);

		expect(resposta.status).toBe(400);
		expect(await resposta.json()).toMatchObject({ erro: 'local_invalido' });
		expect((await lido())?.local).toBeNull();
	});

	it('responde 409 a um ecrã revogado e 404 a um que não existe', async () => {
		await db.prepare('UPDATE dispositivos SET revogado = 1 WHERE id = ?').bind('dis-1').run();
		expect((await rotaAdmin(pedido('/api/admin/dispositivos/configurar', { id: 'dis-1', local: 'Cozinha' }), env, AGORA)).status).toBe(409);
		expect((await rotaAdmin(pedido('/api/admin/dispositivos/configurar', { id: 'dis-nenhum', local: 'Cozinha' }), env, AGORA)).status).toBe(
			404,
		);
	});

	it('a listagem do admin devolve os dois campos e a lista de painéis', async () => {
		await configurarDispositivo(db, 'dis-1', { painel_inicial: 'recolhas', local: 'Cozinha' });

		const resposta = await rotaAdmin(
			new Request('https://tv.refood.test/api/admin/dispositivos', { headers: { authorization: `Bearer ${SEGREDO_ADMIN}` } }),
			env,
			AGORA,
		);
		const corpo = (await resposta.json()) as { dispositivos: { local: string | null; painel_inicial: string | null }[]; paineis: string[] };

		expect(corpo.dispositivos[0]).toMatchObject({ painel_inicial: 'recolhas', local: 'Cozinha' });
		expect(corpo.paineis).toEqual([...PAINEIS]);
	});
});

/**
 * **A cerca: o `local` não sai do admin.**
 *
 * É a única protecção que existe sobre o conteúdo, porque sobre o conteúdo não há nenhuma — alguém
 * vai escrever o nome de uma pessoa e não há coluna que o impeça. O que se garante é que esse texto
 * nunca chega a um televisor, e a garantia é estrutural: não é lido na autenticação, portanto não
 * está na sessão, portanto nenhuma rota da TV o tem à mão para o pôr numa resposta.
 */
describe('o local não chega ao televisor', () => {
	it('não entra na sessão', async () => {
		await configurarDispositivo(db, 'dis-1', { local: 'Cozinha da Dona Maria', painel_inicial: 'recolhas' });

		const request = new Request('https://tv.refood.test/api/ecra', { headers: { authorization: `Bearer tv_dis-1` } });
		const resultado = await autenticarDispositivo(db, request);

		expect(resultado.estado).toBe('ok');
		if (resultado.estado !== 'ok') return;

		// O painel inicial vem — é para vir. O local não existe do lado de cá.
		expect(resultado.sessao.painelInicial).toBe('recolhas');
		expect(JSON.stringify(resultado.sessao)).not.toContain('Maria');
		expect(Object.keys(resultado.sessao)).toEqual(['dispositivo', 'empresa', 'painelInicial']);
	});

	/*
	 * E a prova de que a cerca é a **consulta** e não a boa vontade: a coluna existe na linha, tem
	 * valor, e mesmo assim não vem. Se alguém trocar o SELECT por um `*`, este teste fica vermelho.
	 */
	it('a coluna tem valor na base, e à mesma não vem', async () => {
		await configurarDispositivo(db, 'dis-1', { local: 'Cozinha da Dona Maria' });
		expect((await lido())?.local).toBe('Cozinha da Dona Maria');

		const resultado = await autenticarDispositivo(
			db,
			new Request('https://tv.refood.test/api/ecra', { headers: { authorization: `Bearer tv_dis-1` } }),
		);
		expect('local' in (resultado as { sessao?: object }).sessao!).toBe(false);
	});
});

/**
 * **Duas etiquetas iguais no mesmo núcleo.**
 *
 * É o único caso em que a etiqueta deixa de servir para o que foi feita: duas "Cozinha" em Leiria
 * não desempatam nada, e quem revogar pelo rótulo revoga o ecrã errado. Avisa-se e não se recusa —
 * há a manhã em que se está a mudar um ecrã de sala e os dois nomes coincidem por umas horas.
 *
 * A contagem é do servidor e não da página, pela mesma razão que o ordinal: é uma conta sobre o
 * conjunto das linhas, e é o servidor quem as tem todas.
 */
describe('locais repetidos no mesmo núcleo', () => {
	beforeEach(async () => {
		await semearDispositivo('dis-2', 7, '2026-09-01T09:05:00.000Z');
		await semearDispositivo('dis-3', 12, '2026-09-01T09:10:00.000Z');
	});

	async function marcados() {
		const lista = await listarDispositivos(db);
		return Object.fromEntries(lista.map((d) => [d.id, d.local_repetido]));
	}

	it('marca os dois quando a etiqueta se repete', async () => {
		await configurarDispositivo(db, 'dis-1', { local: 'Cozinha' });
		await configurarDispositivo(db, 'dis-2', { local: 'Cozinha' });

		expect(await marcados()).toMatchObject({ 'dis-1': true, 'dis-2': true });
	});

	it('não marca etiquetas diferentes', async () => {
		await configurarDispositivo(db, 'dis-1', { local: 'Cozinha' });
		await configurarDispositivo(db, 'dis-2', { local: 'Sala de convívio' });

		expect(await marcados()).toMatchObject({ 'dis-1': false, 'dis-2': false });
	});

	/* Maiúsculas e acentos não fazem sítios diferentes, e é aí que um aviso ingénuo falharia. */
	it('ignora maiúsculas e acentos', async () => {
		await configurarDispositivo(db, 'dis-1', { local: 'Sala de convívio' });
		await configurarDispositivo(db, 'dis-2', { local: 'SALA DE CONVIVIO' });

		expect(await marcados()).toMatchObject({ 'dis-1': true, 'dis-2': true });
	});

	/* Núcleos diferentes não colidem: "Cozinha" em Leiria e "Cozinha" no Porto são duas cozinhas. */
	it('não atravessa núcleos', async () => {
		await configurarDispositivo(db, 'dis-1', { local: 'Cozinha' });
		await configurarDispositivo(db, 'dis-3', { local: 'Cozinha' });

		expect(await marcados()).toMatchObject({ 'dis-1': false, 'dis-3': false });
	});

	/* Um ecrã revogado já não está na parede: a etiqueta dele não colide com a de ninguém. */
	it('não conta os revogados, de nenhum dos lados', async () => {
		await configurarDispositivo(db, 'dis-1', { local: 'Cozinha' });
		await configurarDispositivo(db, 'dis-2', { local: 'Cozinha' });
		await db.prepare('UPDATE dispositivos SET revogado = 1 WHERE id = ?').bind('dis-2').run();

		expect(await marcados()).toMatchObject({ 'dis-1': false, 'dis-2': false });
	});

	it('uma etiqueta vazia não é uma repetição', async () => {
		expect(await marcados()).toMatchObject({ 'dis-1': false, 'dis-2': false });
	});

	it('o normalizador tira acentos e maiúsculas, e apara', () => {
		expect(formaDoLocal('  Sala de Convívio ')).toBe('sala de convivio');
		expect(formaDoLocal(null)).toBe('');
	});
});

/**
 * **A configuração escolhida na aprovação chega ao dispositivo.**
 *
 * Quem aprova está ao telefone com quem instala, e é o único momento em que alguém sabe que aquele
 * ecrã é o da cozinha. As duas colunas ficam no emparelhamento (migração `0006`) e a recolha
 * copia-as para o dispositivo — pelo mesmo `SELECT` que já copiava o núcleo, sem tocar na escrita
 * atómica.
 */
describe('da aprovação até ao dispositivo', () => {
	async function semearPendente(codigo: string) {
		await db
			.prepare("INSERT INTO emparelhamentos (id, codigo, segredo_hash, estado, criado_em, expira_em) VALUES (?, ?, ?, 'pendente', ?, ?)")
			.bind(`emp-${codigo}`, codigo, await sha256Hex(`seg_${codigo}`), AGORA.toISOString(), '2026-09-05T10:15:00.000Z')
			.run();
	}

	/** A linha como o `recolherToken` a espera depois de aprovada. */
	function aprovado(codigo: string): EmparelhamentoDb {
		return { id: `emp-${codigo}`, codigo, estado: 'aprovado', company_id: 7, expira_em: '2026-09-05T10:15:00.000Z' } as EmparelhamentoDb;
	}

	it('o painel e o local viajam da aprovação para o dispositivo', async () => {
		await semearPendente('111111');

		expect(await aprovarEmparelhamento(db, '111111', 7, AGORA, { painel_inicial: 'recolhas', local: 'Cozinha' })).toBe(true);

		const token = await recolherToken(db, aprovado('111111'), AGORA);
		expect(token).not.toBeNull();

		const linha = await db
			.prepare("SELECT company_id, painel_inicial, local FROM dispositivos WHERE id <> 'dis-1'")
			.first<{ company_id: number; painel_inicial: string | null; local: string | null }>();

		expect(linha).toEqual({ company_id: 7, painel_inicial: 'recolhas', local: 'Cozinha' });
	});

	/* Aprovar sem escrever nada continua a funcionar: os dois campos são opcionais. */
	it('sem configuração o dispositivo nasce com os dois a null', async () => {
		await semearPendente('222222');
		await aprovarEmparelhamento(db, '222222', 7, AGORA);
		await recolherToken(db, aprovado('222222'), AGORA);

		const linha = await db
			.prepare("SELECT painel_inicial, local FROM dispositivos WHERE id <> 'dis-1'")
			.first<{ painel_inicial: string | null; local: string | null }>();

		expect(linha).toEqual({ painel_inicial: null, local: null });
	});

	it('a rota valida o painel e o local antes de aprovar', async () => {
		await semearPendente('333333');

		const resposta = await rotaAdmin(
			pedido('/api/admin/emparelhamentos/aprovar', { codigo: '333333', company_id: 7, local: 'Cozinha\nSala' }),
			env,
			AGORA,
		);

		expect(resposta.status).toBe(400);
		expect(await resposta.json()).toMatchObject({ erro: 'local_invalido' });

		// E não aprovou: a linha continua pendente, sem núcleo.
		const linha = await db.prepare("SELECT estado, company_id FROM emparelhamentos WHERE codigo = '333333'").first();
		expect(linha).toMatchObject({ estado: 'pendente', company_id: null });
	});
});

/**
 * As duas listas de painéis — a do Worker e a do `painel.html` — têm de dizer o mesmo.
 *
 * São duas porque os assets são servidos estáticos, sem passo de compilação que pudesse importar o
 * `paineis.ts`; é a mesma duplicação assumida que o `index.html` tem do SHA-256 do `auth.ts`. O que
 * não pode é divergirem em silêncio: um painel que o admin deixe escolher e o televisor não saiba
 * desenhar é um ecrã preto numa cozinha.
 */
describe('as duas listas de painéis', () => {
	it('o AREAS do painel.html tem exactamente as chaves do PAINEIS', async () => {
		const html = await readFile(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'painel.html'), 'utf8');

		const bloco = /const AREAS = \{([\s\S]*?)\n\t*\};/.exec(html);
		expect(bloco, 'não se encontrou o AREAS no painel.html — o teste está a olhar para o sítio errado').not.toBeNull();

		const chaves = [...bloco![1].matchAll(/^\s*(\w+):\s*\{/gm)].map((m) => m[1]);

		expect(chaves, `o painel.html desenha ${chaves.join(', ')} e o Worker aceita ${PAINEIS.join(', ')}`).toEqual([...PAINEIS]);
	});

	it('o painel por omissão é um dos que existem', () => {
		expect(PAINEIS).toContain(PAINEL_POR_OMISSAO);
	});

	/* A listagem do admin não é afectada pela coluna nova estar vazia — o caso normal de hoje. */
	it('um ecrã sem escolha aparece com os dois campos a null', async () => {
		const [dispositivo] = await listarDispositivos(db);
		expect(dispositivo).toMatchObject({ painel_inicial: null, local: null });
	});
});
