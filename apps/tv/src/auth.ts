/**
 * Núcleo de autenticação da TV: geração de credenciais, hashing e as decisões sobre o ciclo de
 * vida de um emparelhamento.
 *
 * Tudo aqui é função pura — entra e sai valor. Não há `Env`, não há D1, não há `Request` nem
 * `Response`: as queries e o HTTP vivem nas rotas. É deliberado, e é o que permite testar o
 * módulo que sustenta a segurança da app sem base de dados nem miniflare.
 *
 * O modelo que estas funções servem, e que o esquema do D1 fixa (migração 0002): a TV gera um
 * segredo, guarda-o, e manda ao Worker apenas o SHA-256 dele; o código de 6 dígitos é público e
 * só identifica o ecrã; o token só é emitido a quem apresentar o segredo em claro. Nada aqui
 * compara segredos byte a byte — ver `sha256Hex`.
 *
 * Duas coisas que este módulo não pode decidir, e que a rota de recolha terá de decidir por ele:
 *
 * 1. **A forma da procura.** Procurar por `segredo_hash` sozinho resolve o caso feliz numa
 *    consulta indexada e sem comparação nenhuma, mas colapsa "não existe" e "segredo errado" num
 *    resultado só. Para separar os dois sem passar a comparar hashes em código nosso: procurar
 *    por `codigo` **e** `segredo_hash` no caso feliz e — só quando isso não devolve linha —
 *    procurar pelo `codigo` sozinho, para saber se o código sequer existia. A segunda consulta
 *    paga-se apenas no caminho que já falhou, e é ela que dá a linha de log que interessa.
 * 2. **A varredura da caducidade** tem de cobrir os dois estados de `ESTADOS_VIVOS`, e não só o
 *    `pendente`. Um `aprovado` fora de prazo continua a ocupar o código e o segredo nos índices
 *    únicos parciais até alguém o marcar `expirado`; se a varredura o ignorar, ocupa-os para
 *    sempre — que é exactamente o que os índices parciais existem para evitar.
 */

/** Bytes de entropia do segredo do dispositivo e do token. 32 bytes = 256 bits. */
export const SEGREDO_BYTES = 32;
export const TOKEN_BYTES = 32;

/** Prefixos que distinguem as duas credenciais à vista desarmada, em logs ou no armazenamento da TV. */
export const PREFIXO_SEGREDO = 'seg_';
export const PREFIXO_TOKEN = 'tv_';

/** Validade de um emparelhamento, em milissegundos. Curta: o código está afixado numa cozinha. */
export const VALIDADE_MS = 15 * 60 * 1000;

/** Fonte de aleatoriedade. Injectável só para os testes poderem forçar caminhos improváveis. */
export type Aleatorio = (buffer: Uint8Array) => void;

const aleatorioWebCrypto: Aleatorio = (buffer) => {
	crypto.getRandomValues(buffer);
};

/** Estados de um emparelhamento. Os valores são os do `CHECK` da coluna `estado`. */
export type EstadoEmparelhamento = 'pendente' | 'aprovado' | 'recolhido' | 'expirado';

/**
 * Transições permitidas. `recolhido` e `expirado` são terminais: uma linha gasta nunca volta a
 * estar viva, e é exactamente isso que liberta o código e o segredo dos índices únicos parciais.
 */
const TRANSICOES: Record<EstadoEmparelhamento, readonly EstadoEmparelhamento[]> = {
	pendente: ['aprovado', 'expirado'],
	aprovado: ['recolhido', 'expirado'],
	recolhido: [],
	expirado: [],
};

/** Estados em que o emparelhamento ainda ocupa o código e o segredo — o predicado dos índices parciais. */
export const ESTADOS_VIVOS: readonly EstadoEmparelhamento[] = ['pendente', 'aprovado'];

/** Codifica bytes em base64url, sem `=`. Sem `Buffer`: isto corre no Worker. */
function base64url(bytes: Uint8Array): string {
	let binario = '';
	for (const byte of bytes) binario += String.fromCharCode(byte);
	return btoa(binario).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function credencial(prefixo: string, bytes: number, aleatorio: Aleatorio): string {
	const buffer = new Uint8Array(bytes);
	aleatorio(buffer);
	return prefixo + base64url(buffer);
}

/**
 * Segredo do dispositivo: 32 bytes aleatórios, gerados e guardados na TV.
 *
 * É a única prova de identidade no emparelhamento. Gera-se um novo a cada tentativa — nunca se
 * reutiliza o anterior quando um código expira.
 */
export function generateDeviceSecret(aleatorio: Aleatorio = aleatorioWebCrypto): string {
	return credencial(PREFIXO_SEGREDO, SEGREDO_BYTES, aleatorio);
}

/** Token do dispositivo: 32 bytes aleatórios, emitidos na recolha. Permanente até revogação. */
export function generateToken(aleatorio: Aleatorio = aleatorioWebCrypto): string {
	return credencial(PREFIXO_TOKEN, TOKEN_BYTES, aleatorio);
}

/** Maior múltiplo de 1e6 que cabe num uint32 — acima disto, o valor é rejeitado em vez de dobrado. */
const LIMITE_CODIGO = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;

/**
 * Quantas vezes uma rota tenta inserir um código antes de desistir.
 *
 * Um código gerado aqui pode colidir com outro ainda vivo — este módulo não vê a base, e a
 * unicidade é do índice `idx_emparelhamentos_codigo_vivo`. A rota apanha o erro de constraint e
 * sorteia outro, mas com um tecto: são 65 ecrãs contra um milhão de códigos, e a varredura lazy
 * devolve ao bolo os que caducaram, por isso a colisão é rara e cinco tentativas seguidas a
 * falhar não são azar. São sinal de que a varredura deixou de correr e a tabela está cheia de
 * códigos vivos que já deviam estar expirados. Isso tem de sair como erro, alto e imediato — um
 * ciclo sem limite transformava a mesma avaria em latência, que é a forma de a não descobrir.
 */
export const MAX_TENTATIVAS_CODIGO = 5;

/**
 * Código de emparelhamento: exactamente 6 dígitos, com os zeros à cabeça preservados — é uma
 * string, não um número, e `'004217'` é um código legítimo.
 *
 * Usa rejeição em vez de resto da divisão: 2^32 não é múltiplo de 1e6, por isso `% 1_000_000`
 * sobre um uint32 tornaria os primeiros 967_296 códigos mais prováveis do que os restantes. O
 * código não é uma credencial, e o enviesamento não abre ataque nenhum — mas é invisível a olho
 * nu, não aparece em teste nenhum que não o procure de propósito, e custa quatro linhas evitar.
 * Se alguém "simplificar" isto para um `%`, nada falha: o defeito fica lá, calado, para sempre.
 */
export function generateCode(aleatorio: Aleatorio = aleatorioWebCrypto): string {
	const buffer = new Uint8Array(4);
	const vista = new DataView(buffer.buffer);

	for (;;) {
		aleatorio(buffer);
		const valor = vista.getUint32(0, false);
		if (valor < LIMITE_CODIGO) return String(valor % 1_000_000).padStart(6, '0');
	}
}

/**
 * SHA-256 em hexadecimal minúsculo, 64 caracteres. É esta a forma que entra nas colunas
 * `segredo_hash` e `token_hash` e a que se procura nos índices únicos.
 *
 * Hex e não base64 porque vai para uma coluna TEXT que se compara e indexa como texto: não tem
 * padding, não tem variantes url-safe, e o mesmo valor escreve-se sempre da mesma maneira. Um
 * índice do SQLite não sabe que aquilo é um hash — compara bytes de texto —, por isso duas
 * grafias do mesmo valor são, para ele, dois valores. É o mesmo argumento que fixa o formato das
 * datas em `expiresAt`, e a razão por que nenhum destes formatos é escolha de gosto.
 *
 * É aqui que morre a questão do tempo constante: o segredo e o token nunca são comparados em
 * código nosso. Passam por esta função e são procurados num índice único — o SQLite encontra a
 * linha ou não encontra. Não há comparação byte a byte para vazar tempo, e escrever uma só
 * inventaria o risco de que dizia defender.
 */
export async function sha256Hex(valor: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(valor));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Instante de caducidade de um emparelhamento criado em `agora`, no formato que o D1 guarda.
 *
 * ISO-8601 em UTC com `Z`. Não é o formato do Odoo — estas colunas são nossas — e a escolha
 * importa pela mesma razão que o hex em `sha256Hex`: o índice `idx_emparelhamentos_vivos`
 * percorre `expira_em` como texto e não sabe que aquilo é uma data. Só um formato de largura
 * fixa e em UTC ordena lexicograficamente na mesma ordem em que ordena no tempo — largura
 * variável ou fusos misturados na coluna, e a varredura passa ao lado de linhas caducadas sem
 * dar erro nenhum. Tudo o que escrever nesta coluna passa por aqui.
 */
export function expiresAt(agora: Date, validadeMs: number = VALIDADE_MS): string {
	return new Date(agora.getTime() + validadeMs).toISOString();
}

/** O que estas funções precisam de saber de uma linha de `emparelhamentos`. Nada mais. */
export interface LinhaEmparelhamento {
	estado: EstadoEmparelhamento;
	expira_em: string;
}

/**
 * Se uma linha viva já passou da validade no instante dado.
 *
 * A caducidade é lazy: a coluna `estado` só muda quando a rota de início de emparelhamento a
 * varre. Até lá, uma linha `pendente` fora de prazo continua `pendente` na base, e é esta função
 * que sabe que já não vale.
 *
 * Uma data ilegível conta como caducada. Falha fechado: o que não se consegue ler não autoriza.
 */
export function hasExpired(linha: LinhaEmparelhamento, agora: Date): boolean {
	if (!ESTADOS_VIVOS.includes(linha.estado)) return false;

	const limite = Date.parse(linha.expira_em);
	if (Number.isNaN(limite)) return true;

	return limite <= agora.getTime();
}

/** Se uma transição de estado é permitida. */
export function canTransition(de: EstadoEmparelhamento, para: EstadoEmparelhamento): boolean {
	return TRANSICOES[de].includes(para);
}

/**
 * Aplica uma transição, ou rebenta. A alternativa — devolver o estado antigo em silêncio — daria
 * uma recolha que parece ter corrido bem e não emitiu token nenhum.
 */
export function transition(de: EstadoEmparelhamento, para: EstadoEmparelhamento): EstadoEmparelhamento {
	if (!canTransition(de, para)) {
		throw new TypeError(`Transição inválida de emparelhamento: '${de}' → '${para}'.`);
	}
	return para;
}

/**
 * A decisão que o polling da TV precisa, já com a caducidade aplicada:
 *
 * - `pendente` — existe e ainda espera aprovação da sede;
 * - `pronto` — aprovado e dentro da validade: pode emitir-se o token;
 * - `expirado` — passou da validade, ou já lá estava marcado; a TV pede código novo;
 * - `recolhido` — o token já foi emitido uma vez. O código é de uso único.
 *
 * **Não distingue "não existe" de "o segredo não bate", e não pode.** Só recebe linhas que já
 * foram encontradas; quem apresenta um segredo errado não produz linha nenhuma para avaliar. Do
 * lado da rota as duas dão 401, e devem — mas não são a mesma ocorrência: um código válido com
 * segredo errado é alguém a tentar recolher um token com o número que está afixado na parede, e
 * é a única das duas que vale a pena registar. Essa distinção faz-se na rota, com o que se
 * procura na base; ver a nota no topo do módulo.
 */
export function evaluatePairing(linha: LinhaEmparelhamento, agora: Date): 'pendente' | 'pronto' | 'expirado' | 'recolhido' {
	if (linha.estado === 'recolhido') return 'recolhido';
	if (linha.estado === 'expirado' || hasExpired(linha, agora)) return 'expirado';

	return linha.estado === 'aprovado' ? 'pronto' : 'pendente';
}

/** O que estas funções precisam de saber de uma linha de `dispositivos` para numerar ecrãs. */
export interface LinhaDispositivo {
	id: string;
	company_id: number;
	criado_em: string;
}

/**
 * Numera os dispositivos de um núcleo pela ordem em que foram emparelhados, a partir de linhas já
 * lidas — esta função não vai à base, recebe o que a rota leu.
 *
 * Conta **todas** as linhas do núcleo, revogadas incluídas. Numerar só as visíveis renumerava
 * todos os ecrãs a seguir a cada revogação, e um número que muda sozinho é pior do que nenhum. Os
 * buracos são para ficar: um buraco diz que ali houve uma revogação.
 *
 * `empresa` vem do token ou da sessão de quem chama, nunca de um parâmetro do pedido, e uma linha
 * de outro núcleo na lista é um erro de âmbito — não um caso a acomodar em silêncio.
 *
 * **A guarda só apanha metade do problema, e é a metade menos perigosa.** Uma lista a mais
 * rebenta aqui; uma lista a menos — do núcleo certo, mas incompleta — passa incólume e devolve
 * ordinais errados sem um ruído. É o caso provável, não o improvável: a query óbvia é a que
 * reaproveita o `WHERE revogado = 0` do `idx_dispositivos_empresa`, e essa devolve linhas todas
 * do núcleo certo e todas erradas para efeitos de numeração. Nenhuma função que receba as linhas
 * já lidas consegue detectar isso — a defesa é a query, e o teste que a protege é o do Bloco 3,
 * contra a query real. Aqui fica só assinalado.
 */
export function deviceOrdinals(linhas: readonly LinhaDispositivo[], empresa: number): Map<string, number> {
	const forasteira = linhas.find((linha) => linha.company_id !== empresa);
	if (forasteira) {
		throw new TypeError(`Ordinais: a linha ${forasteira.id} é da empresa ${forasteira.company_id}, não da ${empresa}.`);
	}

	// `criado_em` é ISO em UTC, por isso ordena como texto. O `id` desempata duas criações no mesmo
	// milissegundo, para que a numeração não dependa da ordem em que a query devolveu as linhas.
	const ordenadas = [...linhas].sort((a, b) => a.criado_em.localeCompare(b.criado_em) || a.id.localeCompare(b.id));

	return new Map(ordenadas.map((linha, indice) => [linha.id, indice + 1]));
}

/** O ordinal de um dispositivo, ou `null` se não estiver na lista. */
export function deviceOrdinal(linhas: readonly LinhaDispositivo[], empresa: number, id: string): number | null {
	return deviceOrdinals(linhas, empresa).get(id) ?? null;
}
