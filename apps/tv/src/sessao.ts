/**
 * O middleware da TV: resolve o token de cada pedido e entrega à rota um núcleo já fechado.
 *
 * A regra da raiz — o âmbito vem do sujeito autenticado, nunca do pedido — deixa aqui de ser
 * disciplina e passa a ser tipo. Uma rota de dados recebe um {@link ContextoTv} e mais nada:
 *
 * - **não recebe o `Request`**, portanto não há corpo nem query string de onde tirar um núcleo;
 * - **não recebe o `Env`**, portanto não consegue construir um cliente Odoo sem âmbito;
 * - só fala com o Odoo através do {@link LeitorDoNucleo}, que foi construído a partir do token e
 *   não aceita que lhe digam sobre que empresa deve ler.
 *
 * Escrever uma rota que leia o `company_id` do corpo do pedido deixa de ser uma coisa que se evita
 * por atenção: é um erro de compilação, porque não há `request` no âmbito. Quando uma rota futura
 * precisar mesmo do pedido — um POST com dados, por exemplo — acrescenta-se ao contexto de forma
 * deliberada, e essa passa a ser a rota onde se olha com atenção.
 */

import { createOdooClient, type OdooDomain, type OdooEnv, type OdooRecord } from '@refood/odoo';
import { sha256Hex } from './auth';
import { diaValido } from './dia';

export interface EnvTv extends Partial<OdooEnv> {
	DB: D1Database;
}

/** Quem está a fazer o pedido. Sai do token e de mais lado nenhum. */
export interface SessaoTv {
	readonly dispositivo: string;
	readonly empresa: number;
}

/**
 * As opções de uma leitura ao Odoo, com `fields` e `limit` **obrigatórios**.
 *
 * As duas regras que mais se esquecem — nunca ler um registo inteiro, nunca listar sem tecto —
 * passam a ser exigidas pelo compilador. Um registo completo do Odoo traz dados pessoais e imagens
 * em base64; uma listagem sem `limit` traz o que a base tiver.
 *
 * Não há `context`: deixar o chamador passar contexto é deixá-lo sobrepor-se ao
 * `allowed_company_ids`, que é metade da separação por núcleo. Nem há `lang` — a língua vive no
 * leitor, que a recebe de quem constrói o pedido, pela mesma razão que a empresa: uma rota não a
 * escolhe nem a pode trocar.
 */
export interface OpcoesLeitura {
	fields: readonly string[];
	limit: number;
	offset?: number;
	order?: string;
	/**
	 * Segundos de cache para esta leitura. Ausente — o valor por omissão — não guarda nada.
	 *
	 * **É por leitura e não global de propósito.** As rotas e os turnos mudam quando alguém os
	 * edita no Odoo, e um televisor pode mostrá-los com minutos de atraso sem consequência. O
	 * estado do POS muda enquanto o turno decorre, e mostrar um estado velho é dizer que uma
	 * família já foi servida quando não foi. Quem escreve a leitura é quem sabe qual das duas é,
	 * e por isso a decisão está em cada chamada.
	 */
	cache?: number;
}

/** O único caminho de uma rota da TV até ao Odoo. */
export interface LeitorDoNucleo {
	readonly empresa: number;
	readonly lingua: string;
	searchRead<T extends OdooRecord = OdooRecord>(modelo: string, dominio: OdooDomain, opcoes: OpcoesLeitura): Promise<T[]>;
}

/**
 * A língua em que a TV lê o Odoo. **Uma só, e é sempre esta.**
 *
 * Um televisor não tem pessoa identificada atrás e mostra o que a operação daquele núcleo lê no
 * Odoo — que é português. A constante existe para o valor ter um nome e um sítio, não porque se
 * espere que mude: se algum dia mudar, muda para a app toda de uma vez.
 *
 * **Não está no cliente Odoo de propósito.** O cliente é partilhado pelo isolate; a língua é de
 * quem pede. Na TV a distinção não se nota — é sempre a mesma —, mas é a forma que a PWA vai
 * precisar, com voluntários de línguas diferentes servidos pelo mesmo isolate. Ver
 * `OdooLangOptions` em `@refood/odoo`.
 */
export const LINGUA_DA_TV = 'pt_PT';

/**
 * O que uma rota pode saber do pedido: **um dia e um turno, e mais nada**.
 *
 * É a extensão deliberada que o comentário do topo deste ficheiro prevê, e a forma importa. A rota
 * continua a não receber o `Request`: recebe dois valores já analisados e tipados, e por isso
 * continua a não haver de onde tirar uma empresa. Acrescentar aqui um terceiro campo é uma decisão
 * que se toma com esta frase à frente.
 *
 * Ambos podem vir `null` — sem parâmetro, ou com um parâmetro que não passa a validação. Um pedido
 * mal formado não é erro: é o painel de hoje, no primeiro turno. Um televisor não tem quem corrija
 * um endereço.
 */
export interface VistaPedida {
	/** `YYYY-MM-DD`, já validado como data que existe. */
	readonly dia: string | null;
	/** O `id` de um `resource.calendar`. Inteiro positivo, e mais nada se sabe dele aqui. */
	readonly turno: number | null;
}

/**
 * Um turno do dia que está no ecrã.
 *
 * Vive aqui, e não no painel que primeiro precisou dele, porque os dois painéis — entregas e
 * recolhas — mostram a mesma coisa no mesmo sítio do cabeçalho e navegam-na com as mesmas teclas.
 */
export interface TurnoDoDia {
	readonly id: number;
	/** O nome do Odoo, inteiro. Serve de rótulo acessível e de recurso quando a hora não sai. */
	readonly nome: string;
	/** `18:00` — o que o separador mostra. `null` quando não há hora no nome do turno. */
	readonly hora: string | null;
}

/** Tudo o que uma rota de dados da TV recebe. */
export interface ContextoTv {
	readonly sessao: SessaoTv;
	readonly leitor: LeitorDoNucleo;
	readonly vista: VistaPedida;
	/**
	 * A língua deste pedido — {@link LINGUA_DA_TV} sempre, nesta app.
	 *
	 * Está aqui, e não no cliente Odoo, porque é propriedade de quem pede. O `leitor` recebe-a e é
	 * ele que a leva a cada leitura; uma rota que precise de formatar algo tem-na à mão sem a
	 * inventar.
	 */
	readonly lingua: string;
	/**
	 * O instante em que o pedido entrou.
	 *
	 * Vem do middleware e não do `new Date()` de dentro da rota, porque o dia Refood depende dele:
	 * um painel que chamasse o relógio duas vezes podia calcular o dia com um instante e a janela
	 * com outro, e às 2:59:59 isso são dois dias diferentes.
	 */
	readonly agora: Date;
}

export type RotaTv = (contexto: ContextoTv) => Promise<Response>;

/**
 * Como é que cada modelo se prende ao núcleo — o campo, e a forma da cláusula.
 *
 * Quase tudo no Odoo tem `company_id`, e a forma é `= empresa`. Duas excepções, cada uma com a sua
 * razão, e **enumeradas aqui para não haver rota que decida isto por si**:
 *
 * - **`res.company`** prende-se pelo `id`, porque **ela é a empresa**: um domínio com `company_id`
 *   sobre ela rebenta em vez de filtrar.
 * - **`product.product`** prende-se pela forma `in [empresa, false]`, porque o catálogo de POS é
 *   **global** — 24 produtos, nenhum com `company_id`, os mesmos para todos os núcleos. Com a
 *   cláusula estrita a leitura devolve **zero de 24**: medido em staging.
 *
 * ## A forma `nullable` é mais fraca, e por isso vale só para catálogo
 *
 * `in [empresa, false]` deixa passar o registo sem empresa — é a `ir.rule` que o próprio Odoo usa
 * no `res.partner`, e **foi recusada para dados de pessoas**: lá a solução foi entrar pela ficha
 * (`res.beneficiary`, `res.food.source`), onde o `company_id` é obrigatório. Ver os comentários em
 * `entregas.ts` e `recolhas.ts`.
 *
 * O que a justifica aqui não é o modelo responder bem — é **não haver ali nada para separar**: dois
 * núcleos recebem as mesmas 24 linhas por construção, sem dados pessoais nem operacionais. Um
 * modelo que *tenha* `company_id` com significado nunca entra nesta lista.
 */
type ModoDeAmbito = 'estrito' | 'nullable';

const AMBITO_POR_MODELO: Record<string, { readonly campo: string; readonly modo: ModoDeAmbito }> = {
	'res.company': { campo: 'id', modo: 'estrito' },
	'product.product': { campo: 'company_id', modo: 'nullable' },
};

/** A cláusula de âmbito de uma leitura. Vai sempre à frente do domínio de quem chama. */
export function clausulaDeAmbito(modelo: string, empresa: number): OdooDomain {
	const { campo, modo } = AMBITO_POR_MODELO[modelo] ?? { campo: 'company_id', modo: 'estrito' };
	return modo === 'nullable' ? [[campo, 'in', [empresa, false]]] : [[campo, '=', empresa]];
}

/**
 * Um cliente Odoo preso a um núcleo.
 *
 * Cada leitura leva **as duas** metades do âmbito: a cláusula no domínio e o `allowed_company_ids`
 * no contexto. Não são redundantes — o domínio filtra as linhas que a consulta pede, e o
 * `allowed_company_ids` prende as regras multi-empresa do próprio Odoo, de modo que uma cláusula
 * esquecida ou contornada por um campo relacionado continue a não devolver outro núcleo.
 *
 * A empresa vem por argumento de quem constrói o leitor — o middleware, a partir do token — e não
 * há forma de a mudar depois: não existe método que a aceite.
 */
/**
 * O cliente Odoo do isolate, partilhado por todos os pedidos que ele servir.
 *
 * **Serve para não reautenticar em cada pedido.** O `Env` só existe dentro do `fetch`, portanto a
 * versão anterior construía um cliente por pedido e o `uid` em cache morria com ele: medido, era
 * **uma chamada `common.authenticate` em cada quatro a seis** idas ao Odoo, para sempre, em 65
 * ecrãs.
 *
 * O cliente não guarda âmbito nenhum — só o url, a base, as credenciais e o `uid` —, e as
 * credenciais são as mesmas para todos os pedidos deste Worker. **O âmbito por núcleo continua a
 * viver no leitor**, que é construído por pedido a partir do token; partilhar o cliente não
 * partilha empresa nenhuma.
 *
 * A chave inclui as credenciais para o caso de mudarem: um `wrangler secret put` novo dá um cliente
 * novo em vez de continuar com o antigo. E se o `uid` ficar obsoleto, o cliente já reautentica e
 * repete a chamada uma vez.
 */
let clientePartilhado: { chave: string; cliente: ReturnType<typeof createOdooClient> } | null = null;

function clienteDoIsolate(env: EnvTv): ReturnType<typeof createOdooClient> {
	const chave = `${env.ODOO_URL}|${env.ODOO_DB}|${env.ODOO_USERNAME}|${env.ODOO_PASSWORD}`;
	if (clientePartilhado?.chave !== chave) clientePartilhado = { chave, cliente: createOdooClient(env) };

	return clientePartilhado.cliente;
}

/** Só para os testes: esquece o cliente partilhado, para um caso não herdar o do anterior. */
export function esquecerClientePartilhado(): void {
	clientePartilhado = null;
}

/**
 * A chave de cache de uma leitura.
 *
 * **O núcleo vai no caminho, em claro, e é a primeira coisa que lá está.** A Cache API de um Worker
 * é partilhada pelos televisores do mesmo POP — dois ecrãs de núcleos diferentes na mesma cidade
 * batem na mesma cache. Uma chave sem empresa não devolvia dados a mais: devolvia **os dados do
 * outro núcleo**, que é a falha que todo este projeto existe para não ter.
 *
 * Em claro, e não dentro do hash, para se ver numa listagem de cache e para um erro aqui ser
 * visível à vista desarmada em vez de ficar escondido numa soma.
 *
 * **A língua vai na chave pela mesma razão que o núcleo, e não é higiene.** Uma resposta guardada
 * numa língua continuaria a ser servida depois de a língua mudar — e na PWA, onde a língua é de cada
 * voluntário, duas pessoas de línguas diferentes partilhariam a mesma entrada. Também em claro: um
 * `/en_US/` no meio de uma chave num painel português vê-se sem ferramenta nenhuma.
 */
async function chaveDeCache(empresa: number, lingua: string, modelo: string, dominio: OdooDomain, opcoes: OpcoesLeitura): Promise<string> {
	const assinatura = JSON.stringify([dominio, opcoes.fields, opcoes.limit, opcoes.offset ?? 0, opcoes.order ?? '']);
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(assinatura));
	const hex = [...new Uint8Array(digest)]
		.slice(0, 12)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');

	return `https://refood-tv.interno/cache/nucleo/${empresa}/${lingua}/${modelo}/${hex}`;
}

export function criarLeitor(env: EnvTv, empresa: number, lingua: string): LeitorDoNucleo {
	const odoo = clienteDoIsolate(env);

	return {
		empresa,
		lingua,
		async searchRead<T extends OdooRecord = OdooRecord>(modelo: string, dominio: OdooDomain, opcoes: OpcoesLeitura): Promise<T[]> {
			const ambito = clausulaDeAmbito(modelo, empresa);
			const cache = opcoes.cache && typeof caches !== 'undefined' ? caches.default : null;
			const chave = cache ? new Request(await chaveDeCache(empresa, lingua, modelo, dominio, opcoes)) : null;

			if (cache && chave) {
				const guardada = await cache.match(chave);
				if (guardada) return await guardada.json<T[]>();
			}

			const linhas = await odoo.searchRead<T>(modelo, [...ambito, ...dominio], {
				fields: opcoes.fields,
				limit: opcoes.limit,
				offset: opcoes.offset,
				order: opcoes.order,
				lang: lingua,
				context: { allowed_company_ids: [empresa] },
			});

			if (cache && chave) {
				await cache.put(chave, Response.json(linhas, { headers: { 'cache-control': `max-age=${opcoes.cache}` } }));
			}

			return linhas;
		},
	};
}

/* ------------------------------------------------------ resolução do token */

/**
 * Ao fim de quanto tempo é que vale a pena voltar a escrever o `visto_em`.
 *
 * O sinal de vida é escrito pelo middleware, em qualquer pedido autenticado, mas só quando a marca
 * anterior já está velha. Assim o número de escritas por ecrã depende do relógio e não do tráfego:
 * quando os painéis começarem a pedir dados de 25 em 25 segundos, isto continua a escrever uma vez
 * a cada poucos minutos, em vez de uma vez por pedido.
 *
 * Quatro minutos para um sinal de cinco: a folga evita que uma diferença de segundos entre o
 * relógio da TV e o do Worker faça saltar uma escrita a cada duas.
 */
export const LIMIAR_SINAL_MS = 4 * 60 * 1000;

interface LinhaDispositivo {
	id: string;
	company_id: number;
	revogado: number;
	visto_em: string | null;
}

export type ResultadoAutenticacao =
	| { estado: 'ok'; sessao: SessaoTv; visto_em: string | null }
	| { estado: 'sem_token' }
	| { estado: 'desconhecido' }
	| { estado: 'revogado'; dispositivo: string };

/**
 * Resolve o `Authorization: Bearer` num dispositivo.
 *
 * O token é procurado pelo SHA-256 num índice único, como o segredo do emparelhamento: o SQLite
 * encontra a linha ou não encontra, e não há comparação byte a byte em código nosso.
 *
 * **A revogação é verificada aqui, em todos os pedidos.** Não é uma verificação de emparelhamento
 * que depois se assume para sempre: um ecrã revogado tem de parar no pedido seguinte, e não quando
 * uma cache ou uma sessão expirarem.
 */
export async function autenticarDispositivo(db: D1Database, request: Request): Promise<ResultadoAutenticacao> {
	const cabecalho = request.headers.get('authorization') ?? '';
	const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice('Bearer '.length) : '';
	if (token.length === 0 || token.length > 200) return { estado: 'sem_token' };

	const linha = await db
		.prepare('SELECT id, company_id, revogado, visto_em FROM dispositivos WHERE token_hash = ?')
		.bind(await sha256Hex(token))
		.first<LinhaDispositivo>();

	if (!linha) return { estado: 'desconhecido' };
	if (linha.revogado !== 0) return { estado: 'revogado', dispositivo: linha.id };

	return { estado: 'ok', sessao: { dispositivo: linha.id, empresa: linha.company_id }, visto_em: linha.visto_em };
}

/**
 * Marca o sinal de vida, se a marca anterior já estiver velha. Devolve se chegou a escrever.
 *
 * Só toca em linhas não revogadas: revogar um ecrã que continue a bater à porta não deve deixar de
 * parecer revogado só porque ele insiste.
 */
export async function registarSinalDeVida(db: D1Database, sessao: SessaoTv, vistoEm: string | null, agora: Date): Promise<boolean> {
	const anterior = vistoEm === null ? null : Date.parse(vistoEm);
	const recente = anterior !== null && !Number.isNaN(anterior) && agora.getTime() - anterior < LIMIAR_SINAL_MS;
	if (recente) return false;

	await db
		.prepare('UPDATE dispositivos SET visto_em = ? WHERE id = ? AND revogado = 0')
		.bind(agora.toISOString(), sessao.dispositivo)
		.run();

	return true;
}

/* -------------------------------------------------------------- middleware */

function naoAutorizado(): Response {
	// Sempre a mesma resposta, exista o token ou não: o cliente não tem nada a ganhar em saber se
	// o token que apresentou já existiu. A diferença fica no registo.
	return Response.json({ ok: false, erro: 'nao_autorizado' }, { status: 401 });
}

/**
 * Corre uma rota da TV com o token já resolvido.
 *
 * É por aqui que entram todas as rotas de dados: autentica, recusa o que não passa, constrói o
 * leitor preso ao núcleo do token, e trata do sinal de vida sem atrasar a resposta.
 */
export async function servirRotaTv(
	request: Request,
	env: EnvTv,
	rota: RotaTv,
	opcoes: { agora?: Date; aguardar?: (promessa: Promise<unknown>) => void } = {},
): Promise<Response> {
	const agora = opcoes.agora ?? new Date();
	const resultado = await autenticarDispositivo(env.DB, request);

	if (resultado.estado === 'revogado') {
		// Vale a pena registar: é um ecrã que já foi nosso e continua a pedir. O 401 manda-o
		// recomeçar do zero, e a linha revogada fica como registo do que aconteceu.
		console.warn({ evento: 'tv.dispositivo_revogado', dispositivo: resultado.dispositivo });
		return naoAutorizado();
	}

	if (resultado.estado !== 'ok') {
		if (resultado.estado === 'desconhecido') console.warn({ evento: 'tv.token_desconhecido' });
		return naoAutorizado();
	}

	const sinal = registarSinalDeVida(env.DB, resultado.sessao, resultado.visto_em, agora);
	// A escrita não faz parte da resposta: o ecrã não espera por ela. Sem `waitUntil` — nos testes,
	// por exemplo — espera-se, para não deixar uma promessa a apanhar ar.
	if (opcoes.aguardar) opcoes.aguardar(sinal);
	else await sinal;

	return await rota({
		sessao: resultado.sessao,
		leitor: criarLeitor(env, resultado.sessao.empresa, LINGUA_DA_TV),
		vista: lerVista(request),
		lingua: LINGUA_DA_TV,
		agora,
	});
}

/**
 * O que se aceita da query string, e o que se deita fora sem dizer nada.
 *
 * O `dia` tem de ser uma data que exista — `2026-02-30` não passa —, e o `turno` um inteiro
 * positivo. Tudo o resto vira `null`, e a rota decide o que fazer com isso.
 *
 * **Nada aqui devolve uma empresa, e é esse o ponto.** A assinatura da `VistaPedida` é o que impede
 * que uma rota futura leia um núcleo do pedido: não é disciplina, é o que o compilador tem.
 */
function lerVista(request: Request): VistaPedida {
	const parametros = new URL(request.url).searchParams;

	const dia = parametros.get('dia');
	const turno = Number(parametros.get('turno'));

	return {
		dia: dia !== null && diaValido(dia) ? dia : null,
		turno: Number.isInteger(turno) && turno > 0 ? turno : null,
	};
}
