/**
 * As rotas de emparelhamento da TV, e as consultas ao D1 que as servem.
 *
 * Este ficheiro é o sítio onde o `auth.ts` ganha base de dados e HTTP à volta. O módulo puro
 * mantém-se puro: as decisões continuam a ser dele — que estados estão vivos, quando é que uma
 * linha caducou, quantas vezes se tenta um código — e aqui só se escrevem as queries que as
 * cumprem e as respostas que as embrulham.
 *
 * O fluxo, em três rotas:
 *
 * 1. `POST /api/emparelhamento` — a TV manda o SHA-256 do segredo que gerou; sai um código.
 * 2. `POST /api/emparelhamento/estado` — polling com código e segredo em claro.
 * 3. `POST /api/emparelhamento/recolher` — troca o segredo pelo token, uma vez só.
 */

import {
	ESTADOS_VIVOS,
	MAX_TENTATIVAS_CODIGO,
	evaluatePairing,
	expiresAt,
	generateCode,
	generateToken,
	sha256Hex,
	transition,
	type EstadoEmparelhamento,
} from './auth';

/** Só o que as rotas precisam da linha. `segredo_hash` nunca sai daqui para uma resposta. */
export interface EmparelhamentoDb {
	id: string;
	codigo: string;
	estado: EstadoEmparelhamento;
	company_id: number | null;
	expira_em: string;
}

/** O que estas funções precisam do `Env`. Nada mais — nem Odoo, nem vars. */
export interface EnvEmparelhamento {
	DB: D1Database;
}

/** Um segredo já hasheado pela TV: 64 caracteres hex minúsculos, a forma que `sha256Hex` produz. */
const HASH = /^[0-9a-f]{64}$/;

/** Um código de emparelhamento tal como o `generateCode` o escreve. */
const CODIGO = /^\d{6}$/;

/**
 * Tecto para o segredo em claro que a TV apresenta. São 32 bytes em base64url com prefixo — uns 47
 * caracteres. O limite existe só para não se hashear um corpo de vários MB por engano.
 */
const MAX_SEGREDO = 200;

export class ErroSegredoEmUso extends Error {
	readonly nome = 'segredo_em_uso';
}

export class ErroCodigosEsgotados extends Error {
	readonly nome = 'codigos_esgotados';
}

/**
 * Se um erro do D1 é violação de um índice único, e de qual.
 *
 * O SQLite nomeia as colunas do índice na mensagem, e o D1 mantém essa mensagem dentro do seu
 * `D1_ERROR`. É acoplamento a texto de mensagem, sim — mas a alternativa era ler a linha antes de
 * inserir, o que troca uma garantia atómica do índice por uma corrida entre dois pedidos.
 *
 * O acoplamento falha em silêncio: se o D1 mudar o texto, uma colisão deixa de ser reconhecida e
 * sai 500 onde devia sair 409 — num caminho raro o suficiente para ninguém dar por isso durante
 * meses. Por isso a função está exportada e há um teste que fixa as duas formas observadas da
 * mensagem, a do SQLite cru e a do D1. Se elas mudarem, o teste fica vermelho antes de o incidente
 * acontecer.
 */
export function colisaoEm(erro: unknown, coluna: string): boolean {
	const mensagem = erro instanceof Error ? erro.message : String(erro);
	return /UNIQUE constraint failed/i.test(mensagem) && mensagem.includes(`emparelhamentos.${coluna}`);
}

/**
 * Marca como `expirado` tudo o que passou da validade, e devolve quantas linhas mudaram.
 *
 * **Corre sobre todos os estados vivos, não só sobre o `pendente`.** Um `aprovado` que ninguém
 * recolheu segura o código e o segredo nos índices únicos parciais exactamente como um pendente, e
 * a versão óbvia desta query — `WHERE estado = 'pendente'` — deixava-o lá para sempre. A lista de
 * estados vem do `ESTADOS_VIVOS` do módulo, e não escrita à mão, para que acrescentar um estado
 * vivo alargue a varredura sem ninguém se lembrar de vir aqui.
 */
export async function varrerCaducados(db: D1Database, agora: Date): Promise<number> {
	const marcadores = ESTADOS_VIVOS.map(() => '?').join(', ');
	const resultado = await db
		.prepare(`UPDATE emparelhamentos SET estado = 'expirado' WHERE estado IN (${marcadores}) AND expira_em <= ?`)
		.bind(...ESTADOS_VIVOS, agora.toISOString())
		.run();

	return resultado.meta.changes ?? 0;
}

/**
 * Cria um emparelhamento pendente e devolve o código a mostrar no ecrã.
 *
 * O código sai de um sorteio, e o índice `idx_emparelhamentos_codigo_vivo` é que decide se está
 * livre — daí a inserção poder falhar e repetir-se. O tecto de tentativas é do módulo: esgotá-lo
 * não é azar, é a varredura parada, e tem de sair como erro em vez de ficar a rodar.
 */
export async function criarEmparelhamento(
	db: D1Database,
	segredoHash: string,
	agora: Date,
): Promise<{ codigo: string; expira_em: string }> {
	const expira = expiresAt(agora);

	for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_CODIGO; tentativa++) {
		const codigo = generateCode();

		try {
			await db
				.prepare(
					`INSERT INTO emparelhamentos (id, codigo, segredo_hash, estado, criado_em, expira_em)
					 VALUES (?, ?, ?, 'pendente', ?, ?)`,
				)
				.bind(crypto.randomUUID(), codigo, segredoHash, agora.toISOString(), expira)
				.run();

			return { codigo, expira_em: expira };
		} catch (erro) {
			// O segredo já tem um emparelhamento vivo. Não é colisão de sorteio e repetir não ajuda:
			// ou o pedido chegou duas vezes, ou a TV reutilizou um segredo que devia ter descartado.
			if (colisaoEm(erro, 'segredo_hash')) throw new ErroSegredoEmUso();
			if (!colisaoEm(erro, 'codigo')) throw erro;
		}
	}

	throw new ErroCodigosEsgotados();
}

/**
 * A linha correspondente a um código **e** ao segredo apresentado, seja qual for o estado.
 *
 * Sem filtro de estado de propósito: é o `evaluatePairing` que decide o que dizer de um recolhido
 * ou de um caducado, e um filtro aqui transformava os dois em "não existe".
 */
export async function procurarPorCodigoESegredo(db: D1Database, codigo: string, segredoHash: string): Promise<EmparelhamentoDb | null> {
	return await db
		.prepare('SELECT id, codigo, estado, company_id, expira_em FROM emparelhamentos WHERE codigo = ? AND segredo_hash = ?')
		.bind(codigo, segredoHash)
		.first<EmparelhamentoDb>();
}

/**
 * Se o código existe, seja em que estado for. **Só para registo, nunca para decidir a resposta.**
 *
 * Corre apenas quando a procura com segredo já falhou, e serve para separar duas ocorrências que o
 * cliente vê iguais: um código que não existe é uma TV com o ecrã em cache ou um engano; um código
 * que existe com o segredo errado é alguém a tentar recolher um token com o número afixado na
 * parede. Sem filtro de estado — um código já recolhido com segredo errado é o mesmo sinal e não
 * pode escapar por um `WHERE estado = ...`.
 */
export async function codigoExiste(db: D1Database, codigo: string): Promise<boolean> {
	const linha = await db
		.prepare('SELECT 1 AS existe FROM emparelhamentos WHERE codigo = ? LIMIT 1')
		.bind(codigo)
		.first<{ existe: number }>();
	return linha !== null;
}

/**
 * Emite o token e fecha o emparelhamento, numa transição atómica. Devolve `null` se outro pedido
 * chegou primeiro ou se a linha entretanto deixou de estar aprovada.
 *
 * As duas escritas vão num `batch`, que o D1 executa como uma transação. A inserção do dispositivo
 * é um `INSERT ... SELECT` condicionado ao mesmo `WHERE` do `UPDATE`: se o emparelhamento já não
 * estiver aprovado e dentro do prazo, não insere linha nenhuma. É isso que faz o uso único —
 * inserir primeiro e verificar depois deixaria para trás um dispositivo com token válido de cada
 * vez que a corrida se perdesse.
 *
 * O `company_id` do dispositivo vem do `SELECT` sobre o emparelhamento, dentro do SQL. Não passa
 * pelo pedido nem pelo JavaScript, e por isso não há por onde um cliente o sugerir.
 */
export async function recolherToken(db: D1Database, linha: EmparelhamentoDb, agora: Date): Promise<string | null> {
	// Rebenta se a linha não estiver num estado que permita recolher: a tabela de transições do
	// módulo é que manda, e o literal do novo estado sai de lá em vez de ser escrito aqui à mão.
	const novoEstado = transition(linha.estado, 'recolhido');

	const dispositivoId = crypto.randomUUID();
	const token = generateToken();
	const tokenHash = await sha256Hex(token);
	const instante = agora.toISOString();

	const [, actualizacao] = await db.batch([
		db
			.prepare(
				`INSERT INTO dispositivos (id, token_hash, company_id, criado_em)
				 SELECT ?, ?, company_id, ? FROM emparelhamentos WHERE id = ? AND estado = ? AND expira_em > ?`,
			)
			.bind(dispositivoId, tokenHash, instante, linha.id, linha.estado, instante),
		db
			.prepare(
				`UPDATE emparelhamentos SET estado = ?, recolhido_em = ?, dispositivo_id = ?
				 WHERE id = ? AND estado = ? AND expira_em > ?`,
			)
			.bind(novoEstado, instante, dispositivoId, linha.id, linha.estado, instante),
	]);

	return actualizacao.meta.changes === 1 ? token : null;
}

/* ------------------------------------------------------------------ rotas */

function json(corpo: unknown, status = 200): Response {
	return Response.json(corpo, { status });
}

function erro(status: number, nome: string): Response {
	return json({ ok: false, erro: nome }, status);
}

async function corpoJson(request: Request): Promise<Record<string, unknown> | null> {
	try {
		const corpo: unknown = await request.json();
		return typeof corpo === 'object' && corpo !== null ? (corpo as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

function texto(valor: unknown, maximo: number): string | null {
	return typeof valor === 'string' && valor.length > 0 && valor.length <= maximo ? valor : null;
}

/**
 * `POST /api/emparelhamento` — inicia um emparelhamento.
 *
 * Recebe `{ segredo_hash }` e devolve `{ codigo, expira_em }`. O segredo em claro nunca é enviado
 * neste pedido: fica na TV até à recolha, e é a razão por que o código sozinho não abre nada.
 */
export async function rotaIniciarEmparelhamento(request: Request, env: EnvEmparelhamento, agora = new Date()): Promise<Response> {
	const corpo = await corpoJson(request);
	const segredoHash = corpo && texto(corpo.segredo_hash, 64);
	if (!segredoHash || !HASH.test(segredoHash)) return erro(400, 'segredo_hash_invalido');

	// A varredura corre aqui, antes de se sortear o código: é este pedido que precisa de códigos
	// livres, e é ele que os liberta. Sem cron — ver a nota no topo do `auth.ts`.
	await varrerCaducados(env.DB, agora);

	try {
		const { codigo, expira_em } = await criarEmparelhamento(env.DB, segredoHash, agora);
		return json({ ok: true, codigo, expira_em }, 201);
	} catch (falha) {
		if (falha instanceof ErroSegredoEmUso) return erro(409, 'segredo_em_uso');

		if (falha instanceof ErroCodigosEsgotados) {
			console.error({ evento: 'emparelhamento.codigos_esgotados', tentativas: MAX_TENTATIVAS_CODIGO });
			return erro(503, 'codigos_esgotados');
		}

		throw falha;
	}
}

/**
 * `POST /api/emparelhamento/estado` — o polling da TV.
 *
 * Recebe `{ codigo, segredo }` e devolve `pendente`, `pronto` ou `expirado`. Duas consultas, e a
 * segunda só quando a primeira falha: ver `codigoExiste`. Um emparelhamento já recolhido responde
 * `expirado`, porque a única coisa que a TV pode fazer a seguir é pedir um código novo.
 */
export async function rotaEstadoEmparelhamento(request: Request, env: EnvEmparelhamento, agora = new Date()): Promise<Response> {
	const corpo = await corpoJson(request);
	const codigo = corpo && texto(corpo.codigo, 6);
	const segredo = corpo && texto(corpo.segredo, MAX_SEGREDO);
	if (!codigo || !CODIGO.test(codigo) || !segredo) return erro(400, 'pedido_invalido');

	const linha = await procurarPorCodigoESegredo(env.DB, codigo, await sha256Hex(segredo));

	if (!linha) {
		if (await codigoExiste(env.DB, codigo)) {
			console.warn({ evento: 'emparelhamento.segredo_errado', codigo });
		}
		// A mesma resposta para "não existe" e para "segredo errado" — mesmo corpo e mesmo estado
		// HTTP. Distinguir os dois no código de estado devolvia pela porta das traseiras aquilo que
		// o corpo se dá ao trabalho de esconder.
		return json({ ok: true, estado: 'expirado' });
	}

	const estado = evaluatePairing(linha, agora);
	if (estado === 'recolhido') {
		console.warn({ evento: 'emparelhamento.polling_apos_recolha', codigo });
		return json({ ok: true, estado: 'expirado' });
	}

	return json({ ok: true, estado, expira_em: linha.expira_em });
}

/**
 * `POST /api/emparelhamento/recolher` — troca segredo por token, uma vez só.
 *
 * Recebe `{ codigo, segredo }` e devolve `{ token }`. Quem não apresentar o segredo certo leva 401,
 * exista o código ou não; quem o apresentar mas ainda não estiver aprovado leva 409 com o estado,
 * que já não é segredo nenhum para quem provou ter o segredo.
 */
export async function rotaRecolherToken(request: Request, env: EnvEmparelhamento, agora = new Date()): Promise<Response> {
	const corpo = await corpoJson(request);
	const codigo = corpo && texto(corpo.codigo, 6);
	const segredo = corpo && texto(corpo.segredo, MAX_SEGREDO);
	if (!codigo || !CODIGO.test(codigo) || !segredo) return erro(400, 'pedido_invalido');

	const linha = await procurarPorCodigoESegredo(env.DB, codigo, await sha256Hex(segredo));

	if (!linha) {
		if (await codigoExiste(env.DB, codigo)) {
			console.warn({ evento: 'recolha.segredo_errado', codigo });
		}
		return erro(401, 'nao_autorizado');
	}

	const estado = evaluatePairing(linha, agora);
	if (estado !== 'pronto') {
		return json({ ok: false, erro: 'estado_invalido', estado }, 409);
	}

	const token = await recolherToken(env.DB, linha, agora);
	if (token === null) {
		// A linha deixou de estar recolhível entre a leitura e a escrita: outro pedido ganhou a
		// corrida, ou o prazo virou. Uso único quer dizer que só um destes caminhos leva token.
		console.warn({ evento: 'recolha.corrida_perdida', codigo });
		return erro(409, 'ja_recolhido');
	}

	return json({ ok: true, token }, 201);
}
