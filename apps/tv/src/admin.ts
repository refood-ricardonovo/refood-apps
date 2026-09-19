/**
 * As rotas da sede: aprovar emparelhamentos, atribuir núcleos, revogar ecrãs.
 *
 * Vivem no Worker da TV de propósito. É a mesma D1, a mesma origem e o mesmo deploy, e a aprovação
 * acontece uma vez por dispositivo — o que há-de justificar uma aplicação própria é a monitorização
 * dos 65 ecrãs, não isto.
 *
 * **Duas coisas aqui contrariam regras que valem em todo o resto do repositório, e ambas são
 * deliberadas:**
 *
 * 1. **O `company_id` entra por parâmetro do pedido.** É a única rota em que isso acontece, e é o
 *    ponto do sistema onde a atribuição é feita: alguém na sede escolhe o núcleo de um ecrã que
 *    ainda não tem nenhum. Não há token de onde o tirar, porque o ecrã ainda não tem token — é
 *    justamente o que está a ser emitido. A cerca é esta rota: exige o segredo do admin, só actua
 *    sobre um emparelhamento pendente e dentro do prazo, e recusa um `company_id` que não esteja na
 *    **lista de empresas a que o utilizador de integração tem acesso**. Um número inventado no
 *    corpo do pedido não passa, e um número real de uma empresa que a app não consegue ler também
 *    não.
 * 2. **A consulta ao Odoo não leva âmbito de empresa.** Listar os núcleos entre os quais escolher é
 *    incompatível com estar limitado a um deles. É a leitura de um catálogo, não de dados de
 *    operação: só `id`, `name` e `center_prefix`, de um modelo que não tem dados pessoais.
 *
 *    Não levar âmbito **não** quer dizer não ter limite. O limite é o `company_ids` do utilizador
 *    de integração, e vem dele — nunca de uma leitura de `res.company`. Ver `listarNucleos`.
 *
 * Não há identidades no admin — um segredo único, partilhado. É por isso que não existe
 * `aprovado_por`: uma coluna com o nome de quem aprovou seria uma auditoria imaginada.
 */

import { createOdooClient, type OdooEnv } from '@refood/odoo';
import { deviceOrdinals, hasExpired, sha256Hex, transition, type LinhaDispositivo } from './auth';
import { PAINEIS, PAINEL_POR_OMISSAO, painelValido } from './paineis';
import { LINGUA_DA_TV } from './sessao';

export interface EnvAdmin extends Partial<OdooEnv> {
	DB: D1Database;
	/** Segredo único da sede. Vive em `wrangler secret`, nunca em ficheiro do repositório. */
	ADMIN_SECRET?: string;
}

/**
 * Quanto tempo se guarda a lista de núcleos.
 *
 * A lista muda a conta-gotas — 87 empresas, criadas quase todas em 2021 — e esta página abre-se
 * meia dúzia de vezes por mês. Dez minutos poupam a chamada ao Odoo em cada carregamento sem que um
 * núcleo criado hoje demore a aparecer o suficiente para alguém reparar.
 */
const CACHE_NUCLEOS_S = 600;

/**
 * Chave sintética da cache. Não leva o segredo do admin: a lista de núcleos é a mesma para todos.
 *
 * **Leva a língua**, como toda a chave de cache desta app. Aqui os dois campos que se lêem
 * (`name`, `center_prefix`) são iguais nas duas línguas — medido —, mas a regra não é por campo: é
 * para que uma resposta guardada não sobreviva a uma mudança de língua.
 */
const CHAVE_NUCLEOS = `https://refood-tv.interno/cache/nucleos/${LINGUA_DA_TV}`;

/**
 * Um núcleo, como o Odoo o devolve. `center_prefix` pode vir `false` — é assim que o Odoo escreve
 * "sem valor" em qualquer tipo de campo, e está preenchido nas 87 empresas de staging, o que não é
 * garantia de nada em produção.
 *
 * É um `type` e não uma `interface` porque o `searchRead` exige um `OdooRecord`, e uma interface
 * não satisfaz um `Record<string, unknown>`.
 */
export type Nucleo = {
	id: number;
	name: string;
	center_prefix: string | false;
};

/**
 * O utilizador de integração, do lado do Odoo, só para lhe ler as empresas.
 *
 * `company_ids` é **o limite exterior de tudo** o que este Worker consegue ler — ver
 * `docs/modelos/permissoes.md`. A regra global das `ir.rule` é `company_id in company_ids`, o que
 * significa que uma empresa fora desta lista não devolve zero registos: devolve o mesmo que uma
 * empresa vazia, sem maneira de distinguir uma coisa da outra a partir daqui.
 */
type UtilizadorOdoo = {
	id: number;
	company_ids: number[];
};

export interface PendenteAdmin {
	codigo: string;
	criado_em: string;
	expira_em: string;
}

export interface DispositivoAdmin {
	id: string;
	company_id: number;
	ordinal: number;
	criado_em: string;
	visto_em: string | null;
	versao: string | null;
	revogado: boolean;
	revogado_em: string | null;
	/** O painel com que o ecrã arranca. `null` = o por omissão. */
	painel_inicial: string | null;
	/** A etiqueta de local, escrita na sede. Só existe deste lado — nunca vai para um televisor. */
	local: string | null;
	/** Há outro ecrã vivo no mesmo núcleo com esta etiqueta. Ver o `formaDoLocal`. */
	local_repetido: boolean;
}

/* ---------------------------------------------------- trava de tentativas */

/** Falhas toleradas dentro da janela antes de o balde estoirar. */
export const MAX_FALHAS_ADMIN = 10;

/** Janela em que as falhas se somam, e duração do bloqueio depois de estoirar. */
export const JANELA_FALHAS_MS = 15 * 60 * 1000;
export const BLOQUEIO_MS = 15 * 60 * 1000;

/** Baldes sem uso há mais do que isto são apagados no caminho da falha, que é quem os cria. */
const VALIDADE_BALDE_MS = 24 * 60 * 60 * 1000;

export interface BaldeTentativas {
	falhas: number;
	primeira_em: string;
	ultima_em: string;
	bloqueado_ate: string | null;
}

/**
 * A chave do balde: SHA-256 do IP com o segredo do admin pelo meio.
 *
 * Um IP é dado pessoal, e um IPv4 hasheado sozinho reverte-se por força bruta em segundos — quatro
 * mil milhões de hipóteses. Com o segredo concatenado, quem tenha a base não consegue voltar ao IP
 * sem ter já o segredo, e portanto o D1 continua a guardar apenas estado técnico.
 *
 * O `CF-Connecting-IP` é escrito pela Cloudflare e não é falsificável pelo cliente. Onde não existir
 * — em `wrangler dev` local, por exemplo — todos os pedidos caem no mesmo balde, o que aperta a
 * trava em vez de a abrir.
 */
export async function chaveDeTentativas(request: Request, segredo: string): Promise<string> {
	return await sha256Hex(`${request.headers.get('cf-connecting-ip') ?? 'sem-ip'}|${segredo}`);
}

/** Se este balde está bloqueado no instante dado. Pura, para se poder testar sem base. */
export function estaBloqueado(balde: BaldeTentativas | null, agora: Date): boolean {
	if (!balde?.bloqueado_ate) return false;

	const ate = Date.parse(balde.bloqueado_ate);
	return Number.isNaN(ate) ? true : ate > agora.getTime();
}

/** Segundos que faltam até desbloquear, para o `Retry-After`. Nunca menos de um. */
export function segundosAteDesbloquear(balde: BaldeTentativas | null, agora: Date): number {
	if (!balde?.bloqueado_ate) return 0;

	const ate = Date.parse(balde.bloqueado_ate);
	if (Number.isNaN(ate)) return Math.ceil(BLOQUEIO_MS / 1000);

	return Math.max(1, Math.ceil((ate - agora.getTime()) / 1000));
}

async function lerBalde(db: D1Database, chave: string): Promise<BaldeTentativas | null> {
	return await db
		.prepare('SELECT falhas, primeira_em, ultima_em, bloqueado_ate FROM tentativas_admin WHERE chave = ?')
		.bind(chave)
		.first<BaldeTentativas>();
}

/**
 * Regista uma falha e devolve o balde já actualizado.
 *
 * A janela é deslizante por reinício: passados `JANELA_FALHAS_MS` desde a **primeira** falha, a
 * contagem recomeça do zero. Assim, uma pessoa que erra a palavra-passe hoje e outra vez daqui a
 * uma hora não se aproxima do bloqueio; quem tenta dez vezes seguidas, sim.
 */
export async function registarFalha(db: D1Database, chave: string, agora: Date): Promise<BaldeTentativas> {
	const instante = agora.toISOString();
	const anterior = await lerBalde(db, chave);

	const janelaAberta = anterior !== null && agora.getTime() - Date.parse(anterior.primeira_em) < JANELA_FALHAS_MS;
	const falhas = (janelaAberta ? anterior.falhas : 0) + 1;
	const primeira = janelaAberta ? anterior.primeira_em : instante;
	const bloqueado = falhas >= MAX_FALHAS_ADMIN ? new Date(agora.getTime() + BLOQUEIO_MS).toISOString() : null;

	await db
		.prepare(
			`INSERT INTO tentativas_admin (chave, falhas, primeira_em, ultima_em, bloqueado_ate) VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT (chave) DO UPDATE SET falhas = excluded.falhas, primeira_em = excluded.primeira_em,
			   ultima_em = excluded.ultima_em, bloqueado_ate = excluded.bloqueado_ate`,
		)
		.bind(chave, falhas, primeira, instante, bloqueado)
		.run();

	// Limpeza dos baldes esquecidos, aqui e não noutro sítio: este é o único caminho que os cria, e
	// portanto o único que precisa de os arrumar. Sem cron, como a caducidade dos emparelhamentos.
	await db
		.prepare('DELETE FROM tentativas_admin WHERE ultima_em <= ?')
		.bind(new Date(agora.getTime() - VALIDADE_BALDE_MS).toISOString())
		.run();

	return { falhas, primeira_em: primeira, ultima_em: instante, bloqueado_ate: bloqueado };
}

/** Apaga o balde. Uma entrada certa limpa a conta de quem a acertou. */
export async function limparTentativas(db: D1Database, chave: string): Promise<void> {
	await db.prepare('DELETE FROM tentativas_admin WHERE chave = ?').bind(chave).run();
}

/* ---------------------------------------------------------- autenticação */

/**
 * Confere o segredo da sede, apresentado em `Authorization: Bearer`.
 *
 * Compara os **hashes** dos dois segredos, e não os segredos. Aqui há mesmo uma comparação entre
 * dois valores em memória — ao contrário do token da TV, que é procurado num índice — e comparar as
 * strings em claro seria o caso de manual para uma fuga por tempo. Comparados os SHA-256, o tempo
 * que a comparação leva diz quantos caracteres do *hash* coincidem, o que não ajuda ninguém a
 * construir o segredo: para isso seria preciso inverter o SHA-256. Sai mais barato do que explicar
 * uma comparação em tempo constante escrita à mão.
 *
 * Sem segredo configurado, ninguém entra. A ausência de configuração não abre a porta.
 */
export async function autenticarAdmin(request: Request, env: EnvAdmin): Promise<boolean> {
	const esperado = env.ADMIN_SECRET;
	if (!esperado) {
		console.error({ evento: 'admin.sem_segredo_configurado' });
		return false;
	}

	const cabecalho = request.headers.get('authorization') ?? '';
	const apresentado = cabecalho.startsWith('Bearer ') ? cabecalho.slice('Bearer '.length) : '';
	if (apresentado.length === 0 || apresentado.length > 500) return false;

	return (await sha256Hex(apresentado)) === (await sha256Hex(esperado));
}

/* ------------------------------------------------------------- consultas */

/**
 * Os emparelhamentos que a sede pode aprovar agora.
 *
 * Lê os pendentes e deixa cair os que já passaram do prazo, com o `hasExpired` do módulo — a
 * caducidade é lazy e a linha pode dizer `pendente` estando fora de horas. Não varre: quem marca os
 * caducados é a rota de início de emparelhamento, e uma varredura aqui só espalhava o dono.
 */
export async function listarPendentes(db: D1Database, agora: Date): Promise<PendenteAdmin[]> {
	const { results } = await db
		.prepare("SELECT codigo, criado_em, expira_em FROM emparelhamentos WHERE estado = 'pendente' ORDER BY criado_em ASC LIMIT 100")
		.all<PendenteAdmin>();

	return results.filter((linha) => !hasExpired({ estado: 'pendente', expira_em: linha.expira_em }, agora));
}

/**
 * Aprova um emparelhamento pendente e atribui-lhe o núcleo escolhido.
 *
 * O `WHERE` repete o estado e o prazo: entre a listagem e o clique podem ter passado minutos, e um
 * emparelhamento que caducou nesse intervalo não se aprova. A aprovação **não estica a validade** —
 * `expira_em` fica como estava, e um aprovado que ninguém recolha caduca como qualquer outro.
 */
export async function aprovarEmparelhamento(db: D1Database, codigo: string, empresa: number, agora: Date): Promise<boolean> {
	const instante = agora.toISOString();
	const resultado = await db
		.prepare(
			`UPDATE emparelhamentos SET estado = ?, company_id = ?, aprovado_em = ?
			 WHERE codigo = ? AND estado = 'pendente' AND expira_em > ?`,
		)
		.bind(transition('pendente', 'aprovado'), empresa, instante, codigo, instante)
		.run();

	return resultado.meta.changes === 1;
}

/**
 * Todos os dispositivos, já numerados dentro do respectivo núcleo.
 *
 * A numeração é feita núcleo a núcleo com o `deviceOrdinals` do Bloco 3 — as linhas são agrupadas
 * primeiro, e é a guarda dessa função que rebenta se o agrupamento estiver mal feito. A query não
 * filtra por `revogado`: o ordinal conta-se sobre todas as linhas, e um ecrã revogado mantém o seu
 * número para que os outros não mudem de nome.
 */
export async function listarDispositivos(db: D1Database): Promise<DispositivoAdmin[]> {
	const { results } = await db
		.prepare(
			`SELECT id, company_id, criado_em, visto_em, versao, revogado, revogado_em, painel_inicial, local
			 FROM dispositivos ORDER BY company_id ASC, criado_em ASC, id ASC LIMIT 500`,
		)
		.all<
			LinhaDispositivo & {
				visto_em: string | null;
				versao: string | null;
				revogado: number;
				revogado_em: string | null;
				painel_inicial: string | null;
				local: string | null;
			}
		>();

	const porEmpresa = new Map<number, typeof results>();
	for (const linha of results) {
		const lista = porEmpresa.get(linha.company_id) ?? [];
		lista.push(linha);
		porEmpresa.set(linha.company_id, lista);
	}

	const dispositivos: DispositivoAdmin[] = [];
	for (const [empresa, linhas] of porEmpresa) {
		const ordinais = deviceOrdinals(linhas, empresa);

		/*
		 * **Etiquetas repetidas dentro do núcleo, contadas aqui e não na página.**
		 *
		 * Pela mesma razão que o ordinal: é uma conta sobre o conjunto das linhas, e o servidor é
		 * quem as tem todas. A página mostra o que vier — como já faz com o número do ecrã.
		 *
		 * **Só entre ecrãs vivos.** A etiqueta de um revogado não colide com nada: aquele ecrã já não
		 * está na parede, e marcá-lo mandava alguém procurar um problema que não existe.
		 */
		const quantos = new Map<string, number>();
		for (const linha of linhas) {
			if (linha.revogado === 1 || !linha.local) continue;
			const forma = formaDoLocal(linha.local);
			quantos.set(forma, (quantos.get(forma) ?? 0) + 1);
		}

		for (const linha of linhas) {
			dispositivos.push({
				id: linha.id,
				company_id: linha.company_id,
				ordinal: ordinais.get(linha.id)!,
				criado_em: linha.criado_em,
				visto_em: linha.visto_em,
				versao: linha.versao,
				revogado: linha.revogado === 1,
				revogado_em: linha.revogado_em,
				painel_inicial: linha.painel_inicial,
				local: linha.local,
				local_repetido: linha.revogado !== 1 && !!linha.local && (quantos.get(formaDoLocal(linha.local)) ?? 0) > 1,
			});
		}
	}

	return dispositivos;
}

/** O tecto da etiqueta de local, em unidades UTF-16 — ver a nota do `localValido`. */
export const MAX_LOCAL = 30;

/**
 * A forma de uma etiqueta para efeitos de comparação: sem maiúsculas e sem acentos.
 *
 * "Cozinha", "cozinha" e "COZINHA" são o mesmo sítio, e quem escreve "Sala de convivio" à pressa
 * quer dizer o mesmo que "Sala de convívio". **A comparação erra de propósito para o lado de
 * avisar:** um aviso a mais custa um olhar, e um aviso que não aparece custa uma revogação no ecrã
 * errado.
 */
export function formaDoLocal(texto: string | null): string {
	return (texto ?? '')
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.trim();
}

/**
 * Valida a etiqueta de local que vem do admin.
 *
 * Devolve a etiqueta pronta a guardar, `null` para a limpar, ou `undefined` para a recusar.
 *
 * O que recusa, e porquê:
 *
 * - **Quebras de linha e caracteres de controlo.** É um rótulo de uma linha numa lista; um `
`
 *   lá dentro não se vê no campo e desalinha tudo o que o mostrar a seguir.
 * - **Mais de 30 unidades.** A contagem é a do JavaScript — unidades UTF-16 — e o `CHECK` da base
 *   conta caracteres, que para um emoji dá menos. **Ser o JS o mais apertado dos dois é
 *   deliberado:** assim o `CHECK` nunca dispara, e uma etiqueta recusada volta como 400 e não como
 *   500.
 *
 * O espaço à volta é aparado e os espaços interiores são colapsados antes de contar: uma etiqueta
 * que só difere da outra por dois espaços não é outra etiqueta, e quem escreve numa lista larga
 * deixa espaços sem dar por isso.
 *
 * **O que não valida é o conteúdo.** Nada aqui impede "Cozinha da Dona Maria". Ver a nota da
 * migração `0005` e a secção respectiva do `CLAUDE.md`: a mitigação não é a validação, é isto
 * nunca sair do admin.
 */
export function localValido(valor: unknown): string | null | undefined {
	if (valor === null) return null;
	if (typeof valor !== 'string') return undefined;

	/* Sem regex: um intervalo de caracteres de controlo escrito à mão é fácil de ler mal, e estes não se veem. */
	for (const caracter of valor) {
		const codigo = caracter.codePointAt(0) ?? 0;
		if (codigo < 0x20 || codigo === 0x7f) return undefined;
	}

	const limpa = valor.replace(/\s+/gu, ' ').trim();
	if (limpa.length === 0) return null;
	return limpa.length <= MAX_LOCAL ? limpa : undefined;
}

/**
 * Escreve a configuração de um ecrã: o painel com que arranca e a etiqueta de local.
 *
 * **Os dois campos são opcionais e independentes.** Quem só manda o `local` não mexe no painel, e
 * ao contrário: a página edita os dois juntos, mas a rota não obriga a isso, e uma correcção
 * futura que só toque num não tem de reenviar o outro à espera de que não se tenha perdido pelo
 * caminho.
 *
 * Não actua sobre um dispositivo revogado. Não é uma regra de segurança — quem tem o segredo do
 * admin podia revogar e voltar a escrever — é para a lista não convidar a arrumar ecrãs que já não
 * existem, e para o `revogado_em` continuar a ser a última coisa que aconteceu àquela linha.
 */
export async function configurarDispositivo(
	db: D1Database,
	id: string,
	campos: { painel_inicial?: string | null; local?: string | null },
): Promise<'guardado' | 'revogado' | 'inexistente'> {
	const partes: string[] = [];
	const valores: (string | null)[] = [];

	if ('painel_inicial' in campos) {
		partes.push('painel_inicial = ?');
		valores.push(campos.painel_inicial ?? null);
	}
	if ('local' in campos) {
		partes.push('local = ?');
		valores.push(campos.local ?? null);
	}
	if (partes.length === 0) return 'guardado';

	const resultado = await db
		.prepare(`UPDATE dispositivos SET ${partes.join(', ')} WHERE id = ? AND revogado = 0`)
		.bind(...valores, id)
		.run();

	if (resultado.meta.changes === 1) return 'guardado';

	const linha = await db.prepare('SELECT revogado FROM dispositivos WHERE id = ?').bind(id).first<{ revogado: number }>();
	if (!linha) return 'inexistente';
	return linha.revogado === 1 ? 'revogado' : 'guardado';
}

/**
 * Revoga um dispositivo, preenchendo o `revogado_em`.
 *
 * Só actua sobre um que ainda não esteja revogado: a data da primeira revogação é o registo, e
 * carregar duas vezes no botão não a deve reescrever para a hora do segundo clique.
 */
export async function revogarDispositivo(db: D1Database, id: string, agora: Date): Promise<'revogado' | 'ja_revogado' | 'inexistente'> {
	const resultado = await db
		.prepare('UPDATE dispositivos SET revogado = 1, revogado_em = ? WHERE id = ? AND revogado = 0')
		.bind(agora.toISOString(), id)
		.run();

	if (resultado.meta.changes === 1) return 'revogado';

	const linha = await db.prepare('SELECT 1 AS existe FROM dispositivos WHERE id = ?').bind(id).first<{ existe: number }>();
	return linha ? 'ja_revogado' : 'inexistente';
}

/**
 * A lista de núcleos, do Odoo, com cache.
 *
 * **A lista é o `company_ids` do utilizador de integração, não o conteúdo de `res.company`.** São
 * coisas diferentes: em staging a base tem 87 empresas e o utilizador tem 84. Ler `res.company`
 * punha as outras três no dropdown da sede, indistinguíveis das reais — uma delas chama-se
 * `PT Núcleo <nome>` e está pendurada na empresa-mãe, exactamente como um núcleo a sério. Aprovar
 * um ecrã para ela criava um dispositivo com token válido para uma empresa que este Worker nunca
 * consegue ler, e a falha só aparecia semanas depois, no televisor, como erro do Odoo.
 *
 * É a mesma regra que o `AccessError` ensina do outro lado: pedir uma empresa fora do `company_ids`
 * em `allowed_company_ids` devolve *Access to unauthorized or invalid companies*. A lista de onde
 * se escolhe e o contexto com que se lê têm de sair da mesma fonte, ou divergem.
 *
 * **Falha fechada.** Sem utilizador em `res.users`, lança; com `company_ids` vazio, a lista vem
 * vazia e a aprovação recusa tudo. Nenhum dos dois casos cai para "então mostram-se todas".
 *
 * `res.company` **não tem `active`** — as empresas não se arquivam, e não há campo na base que diga
 * que um núcleo deixou de operar. Dentro das permitidas vêm todas, e a escolha é humana: nada aqui
 * infere o papel de uma empresa pela hierarquia, pelo nome ou pelo NIF.
 *
 * **Sem `order`, de propósito.** As empresas são ordenadas à mão no Odoo — é para isso que serve o
 * `sequence` do modelo —, e essa é a ordem que a operação conhece. Pedir uma ordenação nossa por
 * cima dela dava uma lista diferente da que as mesmas pessoas veem no Odoo, o que não se justifica
 * por gosto de alfabeto. Sem `order`, o Odoo devolve pela ordem do modelo, que é a manual.
 *
 * Consequência: quem consumir esta lista mostra-a **pela ordem em que vem**. Reordenar do lado do
 * cliente desfaz exactamente o que esta decisão preserva.
 *
 * O `center_prefix` continua a vir: é a identificação legível do núcleo, distinta em todas as
 * empresas, e a monitorização há-de precisar dela.
 *
 * `fields` explícito, como sempre: uma `res.company` inteira traz o logótipo em base64 e dezenas de
 * contas de contabilidade que não interessam a ninguém deste lado.
 */
export async function listarNucleos(env: EnvAdmin): Promise<Nucleo[]> {
	const cache = typeof caches !== 'undefined' ? caches.default : null;
	const chave = new Request(CHAVE_NUCLEOS);

	const guardada = await cache?.match(chave);
	if (guardada) return await guardada.json<Nucleo[]>();

	const odoo = createOdooClient(env);

	const [utilizador] = await odoo.searchRead<UtilizadorOdoo>('res.users', [['login', '=', env.ODOO_USERNAME ?? '']], {
		fields: ['company_ids'],
		limit: 1,
		lang: LINGUA_DA_TV,
	});
	if (!utilizador) {
		throw new Error(`Odoo: o utilizador de integração '${env.ODOO_USERNAME}' não existe em res.users; sem ele não há lista de núcleos.`);
	}

	const nucleos = utilizador.company_ids.length
		? await odoo.searchRead<Nucleo>('res.company', [['id', 'in', utilizador.company_ids]], {
				fields: ['name', 'center_prefix'],
				limit: 200,
				lang: LINGUA_DA_TV,
			})
		: [];

	await cache?.put(chave, Response.json(nucleos, { headers: { 'cache-control': `max-age=${CACHE_NUCLEOS_S}` } }));
	return nucleos;
}

/* ------------------------------------------------------------------ rotas */

function json(corpo: unknown, status = 200): Response {
	return Response.json(corpo, { status });
}

function erro(status: number, nome: string): Response {
	return json({ ok: false, erro: nome }, status);
}

async function corpoJson(request: Request): Promise<Record<string, unknown>> {
	try {
		const corpo: unknown = await request.json();
		return typeof corpo === 'object' && corpo !== null ? (corpo as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/**
 * Encaminha `/api/admin/*`, depois de conferir o segredo.
 *
 * A autenticação está aqui e não em cada rota: uma rota nova nasce protegida, em vez de nascer
 * aberta à espera de que alguém se lembre da linha que falta.
 */
export async function rotaAdmin(request: Request, env: EnvAdmin, agora = new Date()): Promise<Response> {
	const caminho = new URL(request.url).pathname;

	if (!env.ADMIN_SECRET) {
		console.error({ evento: 'admin.sem_segredo_configurado' });
		return erro(401, 'nao_autorizado');
	}

	// A trava vem antes da comparação, e não depois: enquanto o balde estiver bloqueado nem se olha
	// para o segredo apresentado. Comparar à mesma devolveria, pela diferença entre as respostas, o
	// oráculo de adivinhação que a trava existe para fechar.
	const chave = await chaveDeTentativas(request, env.ADMIN_SECRET);
	const balde = await lerBalde(env.DB, chave);

	if (estaBloqueado(balde, agora)) {
		const segundos = segundosAteDesbloquear(balde, agora);
		console.warn({ evento: 'admin.bloqueado', caminho, faltam_s: segundos });
		return Response.json({ ok: false, erro: 'demasiadas_tentativas' }, { status: 429, headers: { 'retry-after': String(segundos) } });
	}

	if (!(await autenticarAdmin(request, env))) {
		const actualizado = await registarFalha(env.DB, chave, agora);
		console.warn({ evento: 'admin.nao_autorizado', caminho, falhas: actualizado.falhas, bloqueado: actualizado.bloqueado_ate !== null });
		return erro(401, 'nao_autorizado');
	}

	// Entrada certa limpa a conta: quem se enganou duas vezes e acertou à terceira não fica a meio
	// caminho do bloqueio para o resto do dia.
	if (balde) await limparTentativas(env.DB, chave);

	const metodo = request.method;

	// A versão do Odoo, que era `/api/version` aberto a quem passasse. Continua a ser a maneira mais
	// rápida de saber se a ligação está de pé, mas agora atrás do segredo da sede: a versão do
	// servidor de outra pessoa não é conversa para quem não tem nada a ver com isto.
	if (caminho === '/api/admin/version' && metodo === 'GET') {
		try {
			return json({ ok: true, versao: await createOdooClient(env).version() });
		} catch (falha) {
			console.error({ evento: 'admin.odoo_indisponivel', erro: falha instanceof Error ? falha.message : String(falha) });
			return erro(502, 'odoo_indisponivel');
		}
	}

	if (caminho === '/api/admin/nucleos' && metodo === 'GET') {
		try {
			return json({ ok: true, nucleos: await listarNucleos(env) });
		} catch (falha) {
			console.error({ evento: 'admin.odoo_indisponivel', erro: falha instanceof Error ? falha.message : String(falha) });
			return erro(502, 'odoo_indisponivel');
		}
	}

	if (caminho === '/api/admin/emparelhamentos' && metodo === 'GET') {
		return json({ ok: true, pendentes: await listarPendentes(env.DB, agora) });
	}

	if (caminho === '/api/admin/emparelhamentos/aprovar' && metodo === 'POST') {
		const corpo = await corpoJson(request);
		const codigo = typeof corpo.codigo === 'string' ? corpo.codigo : '';
		const empresa = typeof corpo.company_id === 'number' ? corpo.company_id : NaN;

		if (!/^\d{6}$/.test(codigo)) return erro(400, 'codigo_invalido');
		if (!Number.isInteger(empresa) || empresa <= 0) return erro(400, 'nucleo_invalido');

		// O núcleo é escolhido por uma pessoa, mas o número chega num corpo de pedido: só se aceita
		// se corresponder a uma empresa que este Worker **consegue ler**, que é mais apertado do que
		// uma empresa que exista no Odoo. É a mesma lista que alimenta o dropdown, de propósito: se
		// a validação e a escolha saíssem de fontes diferentes, um dia divergiam.
		let nucleos: Nucleo[];
		try {
			nucleos = await listarNucleos(env);
		} catch (falha) {
			console.error({ evento: 'admin.odoo_indisponivel', erro: falha instanceof Error ? falha.message : String(falha) });
			return erro(502, 'odoo_indisponivel');
		}
		if (!nucleos.some((nucleo) => nucleo.id === empresa)) return erro(400, 'nucleo_desconhecido');

		if (!(await aprovarEmparelhamento(env.DB, codigo, empresa, agora))) {
			// Ou já não está pendente, ou caducou entre a listagem e o clique.
			return erro(409, 'nao_aprovavel');
		}

		console.warn({ evento: 'admin.emparelhamento_aprovado', codigo, company_id: empresa });
		return json({ ok: true });
	}

	if (caminho === '/api/admin/dispositivos' && metodo === 'GET') {
		/*
		 * A lista de painéis vai com os dispositivos, e não escrita na página.
		 *
		 * O `admin.html` é estático e não importa o `paineis.ts`; se tivesse a lista lá dentro,
		 * ficavam **três** cópias — esta, a do Worker e a do `painel.html` — e a terceira seria a que
		 * ninguém se lembrava de actualizar. Assim a página oferece o que o servidor aceita, que é a
		 * mesma regra do dropdown dos núcleos: a lista de onde se escolhe e a validação da escolha
		 * saem da mesma fonte, ou divergem.
		 */
		return json({
			ok: true,
			dispositivos: await listarDispositivos(env.DB),
			paineis: PAINEIS,
			painel_por_omissao: PAINEL_POR_OMISSAO,
		});
	}

	/*
	 * **Escrever configuração de um ecrã não é escrever o âmbito dele, e a diferença é toda.**
	 *
	 * A aprovação de um emparelhamento é a única rota destas apps que aceita um `company_id` num
	 * corpo de pedido, e vale por ter as três cercas que estão escritas no `CLAUDE.md`. Esta rota
	 * aceita dois campos, e **nenhum deles decide o que o ecrã pode ler**: o painel inicial escolhe
	 * entre dados que aquele token já podia ver, e a etiqueta de local nunca sai do admin. O âmbito
	 * continua a vir de onde vinha — do `company_id` da linha, escrito na recolha, a partir do
	 * `SELECT` de dentro do SQL.
	 *
	 * Que fique dito para não haver analogia: **um campo que mudasse o núcleo de um dispositivo não
	 * entrava aqui.** Trocar um ecrã de núcleo é revogá-lo e emparelhá-lo outra vez, que é o caminho
	 * que deixa rasto nas duas linhas.
	 */
	if (caminho === '/api/admin/dispositivos/configurar' && metodo === 'POST') {
		const corpo = await corpoJson(request);
		const id = typeof corpo.id === 'string' && corpo.id.length > 0 && corpo.id.length <= 64 ? corpo.id : null;
		if (!id) return erro(400, 'id_invalido');

		const campos: { painel_inicial?: string | null; local?: string | null } = {};

		if ('painel_inicial' in corpo) {
			const painel = painelValido(corpo.painel_inicial);
			if (painel === undefined) return erro(400, 'painel_invalido');
			campos.painel_inicial = painel;
		}

		if ('local' in corpo) {
			const local = localValido(corpo.local);
			if (local === undefined) return erro(400, 'local_invalido');
			campos.local = local;
		}

		const resultado = await configurarDispositivo(env.DB, id, campos);
		if (resultado === 'inexistente') return erro(404, 'inexistente');
		if (resultado === 'revogado') return erro(409, 'revogado');

		/*
		 * **O que se regista é que houve escrita, e não o que lá foi escrito.** A etiqueta é texto de
		 * pessoas e pode trazer um nome sem ninguém querer; um log que a copiasse punha-a num sítio
		 * que ninguém pensa em apagar. Fica se foi tocada, e o comprimento, que chega para perceber
		 * o que se passou sem guardar o quê.
		 */
		console.warn({
			evento: 'admin.dispositivo_configurado',
			dispositivo: id,
			painel_inicial: campos.painel_inicial ?? null,
			local_tocado: 'local' in campos,
			local_comprimento: campos.local?.length ?? 0,
		});
		return json({ ok: true });
	}

	if (caminho === '/api/admin/dispositivos/revogar' && metodo === 'POST') {
		const corpo = await corpoJson(request);
		const id = typeof corpo.id === 'string' && corpo.id.length > 0 && corpo.id.length <= 64 ? corpo.id : null;
		if (!id) return erro(400, 'id_invalido');

		const resultado = await revogarDispositivo(env.DB, id, agora);
		if (resultado === 'inexistente') return erro(404, 'inexistente');

		console.warn({ evento: 'admin.dispositivo_revogado', dispositivo: id, ja_estava: resultado === 'ja_revogado' });
		return json({ ok: true, ja_revogado: resultado === 'ja_revogado' });
	}

	return erro(404, 'rota_inexistente');
}
