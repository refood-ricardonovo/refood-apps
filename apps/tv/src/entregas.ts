/**
 * O painel de entregas a beneficiários — o primeiro conteúdo real da TV.
 *
 * Mostra as famílias com entrega **num dia e num turno**, com o estado de cada uma. É o ecrã que
 * está pendurado na cozinha durante a operação, visto de três a quatro metros, e por onde passa
 * quem quiser.
 *
 * ## O que este ficheiro nunca lê, e porquê
 *
 * **Nenhum nome de pessoa sai daqui.** Não é uma regra de apresentação que se cumpre no HTML: é uma
 * regra de leitura, e é aqui que se cumpre.
 *
 * - **`pos.order.client_name` nunca é lido.** Nas Entregas é, em 100% dos registos, o nome do
 *   beneficiário — o `refood_pos` copia-o para dentro da encomenda. Ver `docs/modelos/pos.md`.
 * - **A `res.beneficiary` é lida, e nunca pelo nome.** Lê-se o espelho, o número, o `active` e as
 *   três contagens do agregado — o que o cartão mostra e mais nada. `name`, `full_name`, morada,
 *   contactos e imagens ficam do outro lado da leitura.
 * - **Os rótulos dos many2one são deitados fora à entrada.** Um `many2one` do Odoo vem como
 *   `[id, etiqueta]`, e o `beneficiary_id` de uma rota traz o **nome da pessoa** nessa etiqueta. Por
 *   isso tudo o que entra passa pelo `many2oneId`, que devolve o número e mais nada: o nome nunca
 *   chega a existir numa variável deste módulo, quanto mais a ser serializado.
 *
 * **A única excepção é o nome de um parceiro de apoio, e é uma excepção sobre a espécie do dado.**
 * Um `res.support.partner` é uma instituição que recebe alimentos — não uma pessoa —, da mesma
 * espécie que a fonte de alimento cujo nome o painel do lado já mostra há muito. Sai a `name` da
 * ficha, nunca o `client_name` da encomenda nem o `res.partner`, e **só as duas primeiras
 * palavras**: chega para identificar quem está na cozinha, e é o que sobra do nome se algum dia
 * alguém criar um parceiro que seja uma pessoa singular — coisa que nada no modelo impede. Ver
 * `nomeCurtoDoParceiro`.
 *
 * ## As leituras do estado, por esta ordem
 *
 * 1. As `pos.order` de Entregas do dia, filtradas por `session_id.config_id.pos_type`. Nunca pela
 *    `config_id` directamente, nunca pelo `pos.session.is_delivery` — que é calculado e rebenta
 *    assim que o resultado apanha dois núcleos. **Trazem o `total_in_kg`**, que é o único número do
 *    POS com significado e o que põe os quilos no cartão sem uma ida ao Odoo a mais.
 * 2. As fichas — `res.beneficiary` e `res.support.partner` —, que traduzem o parceiro da encomenda
 *    para quem a recebeu.
 * 3. As `pos.order.line` da categoria *Observações*, **restringidas por `order_id`**. A linha do
 *    POS não tem regra de registo por núcleo: lê-la sem prender à encomenda contorna o filtro que a
 *    encomenda tem.
 * 4. O catálogo, para saber qual das observações **não** é uma falta. Cache longa, e em regime não
 *    custa nada. As três regras — a classificação, a soma e o tecto — estão em `pos.ts`.
 *
 * ## Os quilos são etiqueta, nunca critério
 *
 * O estado de uma família **não vem dos quilos**: vem de existir encomenda e de haver ou não uma
 * observação. Uma entrega registada como cabaz em unidades tem zero quilos e é uma entrega — 51
 * casos na base. Por isso o peso entra no cartão como número ao lado do estado, e nunca como a
 * coisa que decide a cor.
 *
 * ## Os extras — a segunda origem da grelha
 *
 * Até aqui **um cartão nascia sempre de uma rota**, e o POS só lhe pintava o estado por cima. Um
 * extra é o contrário: nasce de uma `pos.order` que não corresponde a rota nenhuma do dia. A grelha
 * passa a ter duas origens, que é a decisão de desenho que os documentos de modelos anteciparam —
 * ver `docs/modelos/beneficiarios.md`.
 *
 * O que isso obriga a resolver está escrito onde acontece:
 *
 * - **quem é** — `lerFichas`, que entra pela ficha e não pelo `res.partner`;
 * - **de que dia** — a comparação é contra as rotas do **dia inteiro**, e não do turno visível, ou
 *   os mesmos quilos apareciam duas vezes no mesmo dia; ver `montarPainel`;
 * - **de que turno** — `turnoDoExtra`, em `pos.ts`, que é a única heurística deste painel;
 * - **o que não se consegue resolver** — contado e dito no cabeçalho, nunca deitado fora em
 *   silêncio; ver `PainelEntregas.porIdentificar`.
 */

import { many2oneId } from '@refood/odoo';
import {
	diaDaSemanaOdoo,
	diaRefood,
	diaValido,
	DIAS_PARA_A_FRENTE,
	diferencaEmDias,
	horaDecimal,
	janelaDoDia,
	nomeDoDiaDaSemana,
	relacaoComHoje,
	somarDias,
} from './dia';
import {
	lerEncomendasComFalta,
	lerIdsTratados,
	resumoPorParceiro,
	TECTO_ENTREGAS_KG,
	totalDoPainel,
	turnoDoExtra,
	type EncomendaComParceiro,
	type PesoDoCartao,
} from './pos';
import type { ContextoTv, LeitorDoNucleo, RotaTv, TurnoDoDia } from './sessao';

/** O `pos_type` das caixas de Entregas. A única coisa na base que separa Recolhas de Entregas. */
const CAIXA_DE_ENTREGAS = 'deliveries';

/*
 * **O `start_date` compara-se com o dia que se está a ver, não com hoje.**
 *
 * Uma rota é semanal: tem um dia da semana e uma data a partir da qual passa a valer. Uma entrega
 * combinada para começar no dia 13 não deve aparecer no painel do dia 6 — mas *deve* aparecer no do
 * dia 13 em diante. Comparar com hoje escondia-a de quem está a preparar a semana, que é
 * precisamente para isso que a navegação vai sete dias para a frente.
 *
 * A comparação é sobre a **data**, não sobre o instante: o `start_date` é um datetime, mas está a
 * `00:00:00` nas 3 252 rotas da base, e é assim que o Odoo o escreve. Daí o `23:59:59`, que é a
 * maneira de escrever `data(start_date) <= dia` num domínio — uma rota que começasse a meio do dia
 * contaria para esse dia inteiro, que é o que a operação quer dizer.
 *
 * **Não há data de fim.** Uma rota que termina é apagada, e o que resta é o `is_route_ongoing` para
 * as que ficam marcadas como paradas. Por isso não há limite superior nenhum aqui.
 *
 * Se algum dia aparecerem `start_date` com hora, esta comparação passa a precisar da janela de
 * Lisboa em vez da data em UTC — ver `janelaDoDia`.
 */
const LIMITE_DE_ARRANQUE = 'start_date';

/**
 * **Porque é que o `is_route_ongoing` não entra neste domínio.**
 *
 * Parece o filtro óbvio — um boolean chamado "a rota está a decorrer" — e foi assim que esta rota
 * começou. Está errado, e a medição em setembro de 2026 mostra porquê.
 *
 * O campo é um boolean **armazenado e escrito à mão** (`store: true`, `compute: false`), e marca-se
 * a `false` quando se cria uma rota com data de início futura: das 391 a `false`, **390 tinham o
 * `start_date` depois da data de criação**. Só que **nunca é corrigido**: dessas 391, **390 já
 * arrancaram** — o `start_date` está no passado — e continuam marcadas como não decorrentes, mesmo
 * tendo sido editadas depois. E nem é consistente: há rotas criadas com início futuro que ficaram a
 * `true`.
 *
 * Filtrar por ele escondia 390 famílias que já são servidas. **Num painel, uma família escondida não
 * deixa buraco** — ninguém dá pela falta, e é comida que não sai.
 *
 * O `start_date` faz o trabalho útil da marca — excluir o que ainda não arrancou — com um dado que
 * não envelhece. E não é preciso nada para excluir as acabadas, porque **não há data de fim**: uma
 * rota que termina é apagada.
 *
 * O que isto deixa passar: uma rota deliberadamente suspensa sem ser apagada. Pelos dados isso não
 * existe — as 391 são marcas de criação esquecidas. Se um dia passar a existir, é aqui que se trata,
 * e não voltando a pôr o boolean.
 */

/*
 * Quanto tempo se guarda cada leitura, e porquê são números diferentes.
 *
 * **As rotas e os turnos são catálogo**: mudam quando alguém os edita no Odoo, o que acontece
 * poucas vezes por semana. Um televisor mostrá-los com dois minutos de atraso não tem consequência
 * nenhuma — e são três das quatro a seis idas ao Odoo por refresh, em 65 ecrãs, para sempre.
 *
 * **O POS é o que está a acontecer agora.** Uma família que acabou de ser servida tem de mudar de
 * cor no refresh seguinte; um estado com dois minutos é dizer a quem está na cozinha que alguém já
 * foi servido quando não foi. **Não leva cache nenhuma, e é essa a razão de a cache ser por leitura
 * e não global.**
 *
 * Os prazos são folgados em relação ao refresh de 60s de propósito: um prazo de 120s falhava a
 * cache em metade dos refreshes e não poupava quase nada. Cinco minutos de atraso numa rota nova, e
 * quinze num turno novo, não mudam nada para quem olha para o ecrã.
 */
const CACHE_ROTAS_S = 300;
const CACHE_TURNOS_S = 900;
/** O espelho e o número de uma ficha não mudam. Mesmo critério do número da fonte, nas recolhas. */
const CACHE_FICHAS_S = 900;

/** Tectos das leituras. O maior turno da base tem 69 rotas; o enunciado prevê ~90. */
const LIMITE_ROTAS = 500;
const LIMITE_TURNOS = 50;
const LIMITE_ENCOMENDAS = 600;
/**
 * As fichas lêem-se para o **dia inteiro** e não para o turno — é o que permite saber se uma
 * encomenda é extra —, portanto o tecto tem de acomodar as rotas todas do dia mais os parceiros de
 * apoio que apareçam nas encomendas.
 */
const LIMITE_FICHAS = 700;

/**
 * Os estados de uma família no ecrã.
 *
 * **São uma dimensão do cartão, não casos especiais.** Está previsto um quarto — *à espera*, quando
 * a PWA registar quem chegou — e a intenção é que entrar com ele custe uma cor e um símbolo, sem
 * tocar em lógica nenhuma. Por isso o estado viaja como uma etiqueta única e o ecrã trata-o como
 * dado, não como um `if`.
 *
 * **`extra` não é um destes**, e é a razão de ser um campo à parte do cartão: um extra está sempre
 * `entregue` ou `falta` — nunca `por_entregar`, porque é a encomenda que o faz existir. Pô-lo aqui
 * apagava essa distinção e ocupava o lugar reservado ao quarto estado.
 */
export type Estado = 'por_entregar' | 'entregue' | 'falta';

export interface CartaoEntrega {
	/**
	 * O id da rota. Serve de chave estável na grelha; não tem significado para quem olha.
	 *
	 * **Num extra é o simétrico do parceiro** — um negativo, portanto —, porque não há rota. Mantém
	 * a chave estável entre refreshes e não colide com um id de rota, que é sempre positivo.
	 */
	readonly rota: number;
	/** `B28`, do `PTABF_BF000028`; `P12` num parceiro de apoio. `null` quando a ficha não tem número. */
	readonly etiqueta: string | null;
	/** Só para ordenar. `null` ordena para o fim. */
	readonly ordem: number | null;
	/**
	 * O nome curto de um **parceiro de apoio**, e mais nada.
	 *
	 * `null` em todos os outros cartões, e não por omissão: um beneficiário é uma pessoa e o nome
	 * dele não entra neste ecrã em circunstância nenhuma. Ver o cabeçalho deste ficheiro.
	 */
	readonly nome: string | null;
	/**
	 * A hora combinada da entrega. **`null` nos extras**: um extra não estava na escala do dia,
	 * portanto não há hora combinada nenhuma para mostrar. Quem o distingue no ecrã é a barra
	 * ponteada da esquerda, não esta ausência.
	 */
	readonly hora: string | null;
	readonly adultos: number | null;
	readonly criancas: number | null;
	readonly pessoas: number | null;
	readonly estado: Estado;
	/** Se este cartão não estava na escala do dia. Ver a secção dos extras no cabeçalho. */
	readonly extra: boolean;
	/**
	 * O peso entregue, já formatado — `'15 kg'`, `'7,3 kg'`, `'1,2 T'`.
	 *
	 * `null` quando não há número para mostrar, e são quatro casos que o ecrã trata igual: família
	 * sem encomenda, entrega sem peso registado, cartão com falta e cartão fora de escala. Vai
	 * formatado do servidor porque o arredondamento tem de ser feito **uma vez**: é a soma destes
	 * valores que dá o total do cabeçalho.
	 */
	readonly peso: string | null;
}

export interface PainelEntregas {
	readonly dia: string;
	readonly hoje: string;
	readonly nomeDoDia: string;
	readonly relacao: string;
	readonly podeRecuar: boolean;
	readonly podeAvancar: boolean;
	readonly turnos: readonly TurnoDoDia[];
	readonly turno: TurnoDoDia | null;
	/** Os previstos primeiro, por número; os extras a seguir, pela hora a que aconteceram. */
	readonly cartoes: readonly CartaoEntrega[];
	/**
	 * O peso do turno, formatado, ou `null` se não houver nenhum.
	 *
	 * **É a soma exacta dos números que estão nos cartões** — arredondados primeiro, somados depois,
	 * e **os extras contam**, porque estão no ecrã. Quem somar o ecrã à mão obtém este valor; se
	 * desse outro, deixava de acreditar nos dois.
	 */
	readonly pesoTotal: string | null;
	/**
	 * Quantos cartões ficaram **fora de escala** — peso acima do tecto de plausibilidade.
	 *
	 * Não entram na soma e não mostram número, mas **são contados aqui e ditos no cabeçalho**: um
	 * valor absurdo que desaparece em silêncio é um erro que ninguém corrige. O tecto e a sua
	 * medição estão em `pos.ts`.
	 */
	readonly foraDeEscala: number;
	/**
	 * Quantas encomendas do dia **não se conseguiu atribuir a ninguém**.
	 *
	 * Pela mesma razão do `foraDeEscala`: são quilos que aconteceram e que não vão aparecer em
	 * cartão nenhum, e uma coisa que desaparece em silêncio é um erro que ninguém corrige.
	 *
	 * Na prática são duas situações, as duas raras: uma encomenda a uma ficha **arquivada** — que um
	 * televisor nunca mostra —, e um parceiro que não é nem beneficiário nem parceiro de apoio, coisa
	 * que os dados dizem não existir (386 parceiros das Entregas, 367 + 19, nenhum de outra espécie).
	 */
	readonly porIdentificar: number;
	/**
	 * Os recados do turno, para a faixa do rodapé.
	 *
	 * **Vem sempre vazio, e é de propósito.** O sítio existe — o ecrã já sabe mostrá-lo — mas o
	 * conteúdo é texto livre escrito por voluntários, e o `CLAUDE.md` da raiz exige decisão escrita
	 * na rota antes de isso ir para um televisor por onde passa quem quiser. Enquanto essa decisão
	 * não estiver tomada e o D1 não tiver a tabela, esta lista não se enche a partir de lado nenhum.
	 *
	 * Está aqui, e não por inventar, para que o contrato seja visível: quem ligar os recados sabe
	 * exactamente onde os pôr, e vê a condição ao lado.
	 */
	readonly notas: readonly string[];
}

/* ------------------------------------------------------------ o que se lê */

type RotaOdoo = {
	id: number;
	resource_calendar_id: [number, string] | false;
	beneficiary_id: [number, string] | false;
	related_beneficiary_number: string | false;
	start_hour: number | false;
	adult_count: number | false;
	child_count: number | false;
	beneficiary_count: number | false;
};

type CalendarioOdoo = { id: number; name: string; shift_name: string | false };
type EncomendaOdoo = EncomendaComParceiro;

/**
 * A ficha de um beneficiário, no mínimo que este painel precisa.
 *
 * **Sem `name`, sem `full_name`, sem contactos e sem imagens.** As três contagens são as mesmas que
 * a rota já copia para o cartão previsto — lêem-se aqui para o cartão de um extra, que não tem rota
 * de onde as tirar, e não são um dado novo no ecrã.
 */
type BeneficiarioOdoo = {
	id: number;
	partner_id: [number, string] | false;
	number: string | false;
	active: boolean;
	adult_count: number | false;
	child_count: number | false;
	beneficiary_count: number | false;
};

/** A ficha de um parceiro de apoio. O `name` é de uma instituição — ver o cabeçalho. */
type ParceiroDeApoioOdoo = {
	id: number;
	partner_id: [number, string] | false;
	number: string | false;
	name: string | false;
};

/* ------------------------------------------------------------- conversões */

/**
 * `PTABF_BF000028` → `B28`.
 *
 * O `number` da ficha é um `sequence_prefix` seguido do contador com zeros à cabeça. O que a
 * operação diz em voz alta é o contador — "o B28" —, e é isso que o cartão mostra em grande.
 *
 * **Traz sujidade, e não é hipotética:** há fichas com um `\t` colado à cabeça do prefixo, e há
 * fichas sem `number` nenhum. Daí o `trim` antes de qualquer coisa, e o `null` em vez de uma
 * etiqueta inventada — um cartão sem número é melhor do que um cartão com o número de outra
 * família, e melhor do que uma família que desaparece do ecrã.
 */
export function etiquetaDoNumero(valor: unknown): string | null {
	if (typeof valor !== 'string') return null;

	const encontrado = /_BF(\d+)\s*$/.exec(valor.trim());
	if (!encontrado) return null;

	const semZeros = String(Number(encontrado[1]));
	return `B${semZeros}`;
}

/** O número por trás da etiqueta, para ordenar. `null` vai para o fim da grelha. */
export function ordemDoNumero(valor: unknown): number | null {
	if (typeof valor !== 'string') return null;

	const encontrado = /_BF(\d+)\s*$/.exec(valor.trim());
	return encontrado ? Number(encontrado[1]) : null;
}

/**
 * `PTABF_PA000012` → `P12`. A mesma numeração das outras fichas, com o sufixo `_PA`.
 *
 * **Um quinto dos parceiros de apoio não tem número** — 220 em 1 014 —, e nesses o cartão fica sem
 * etiqueta, como uma família sem número. O nome curto continua lá, e é por ele que se reconhece.
 */
export function etiquetaDoParceiro(valor: unknown): string | null {
	if (typeof valor !== 'string') return null;

	const encontrado = /_PA(\d+)\s*$/.exec(valor.trim());
	return encontrado ? `P${Number(encontrado[1])}` : null;
}

/** O número por trás da etiqueta de um parceiro de apoio, para ordenar. */
export function ordemDoParceiro(valor: unknown): number | null {
	if (typeof valor !== 'string') return null;

	const encontrado = /_PA(\d+)\s*$/.exec(valor.trim());
	return encontrado ? Number(encontrado[1]) : null;
}

/**
 * O nome de um parceiro de apoio como vai ao ecrã: **as duas primeiras palavras** — três, quando a
 * segunda é um traço.
 *
 * **Não é só para caber.** É a única coisa que este painel mostra que veio de um campo `name`, e o
 * corte é o que garante que continua a ser uma identificação e não uma ficha: `res.support.partner`
 * é onde vivem as instituições que recebem alimentos, mas **nada no modelo obriga a que um parceiro
 * seja uma instituição** — 651 dos 1 014 nem têm tipo preenchido, e o campo por onde um beneficiário
 * aponta ao parceiro que o acompanha diz "tipicamente a assistente social". Duas palavras chegam
 * para dizer *Centro Paroquial* e não chegam para dizer o nome completo de ninguém.
 *
 * **A excepção do traço, e porque é que não abre a regra.** Há nomes na forma `SIGLA - Nome por
 * extenso`, e nesses o corte a duas palavras dava *"ARPILF -"*: um traço pendurado onde devia estar
 * a informação, visto num televisor. Quando a segunda palavra é só um traço, entra a terceira. O
 * limite de exposição aguenta-o — **o nome de uma pessoa não leva um traço isolado em segundo
 * lugar**, portanto a terceira palavra só se ganha em nomes que já eram de entidade.
 *
 * Contam-se os três traços que aparecem em texto — `-`, `–` e `—` —, porque quem escreve um nome
 * numa ficha do Odoo usa o que o teclado ou a colagem lhe deu, e os três produzem exactamente o
 * mesmo cartão partido.
 *
 * Um traço que fique no fim por não haver terceira palavra é cortado: `ARPILF -` mostra-se
 * *ARPILF*, que identifica, em vez de sugerir que falta ali qualquer coisa.
 *
 * **Duas palavras podem colidir** — dois "Centro Social" no mesmo ecrã lêem-se como um cartão
 * repetido. É por isso que a etiqueta `P12` fica ao lado: são os dois o identificador, como o
 * número e o nome nas recolhas.
 *
 * O espaço colapsa-se antes de cortar: há nomes com espaço duplo, e sem isso a segunda "palavra"
 * saía vazia.
 */
export function nomeCurtoDoParceiro(valor: unknown): string | null {
	if (typeof valor !== 'string') return null;

	const palavras = valor.trim().split(/\s+/).filter(Boolean);
	const ehTraco = (palavra: string | undefined) => palavra === '-' || palavra === '–' || palavra === '—';

	const curto = palavras.slice(0, ehTraco(palavras[1]) ? 3 : 2);
	// Sem terceira palavra, o traço ficava pendurado no fim do cartão.
	while (curto.length > 0 && ehTraco(curto[curto.length - 1])) curto.pop();

	return curto.length > 0 ? curto.join(' ') : null;
}

/**
 * Uma contagem da rota, ou `null`.
 *
 * As três contagens são cópia fiel da ficha, e **estão a zero em cerca de metade das rotas** — o que
 * quer dizer "ninguém preencheu", não "família de zero pessoas". O ecrã diz *sem contagem*; escrever
 * "0 pessoas" numa cozinha é dizer uma coisa falsa a quem está a separar comida.
 */
export function contagem(valor: unknown): number | null {
	return typeof valor === 'number' && Number.isFinite(valor) && valor > 0 ? valor : null;
}

/**
 * O nome legível de onde se extrai a hora do turno.
 *
 * Não é o que vai para o cabeçalho — para isso serve o `name`, que é o que uma pessoa escreveu para
 * distinguir um turno do outro. Esta função existe só para o {@link horaDoTurno} ter onde procurar
 * a hora, que vive no `shift_name` calculado da primeira linha de horário.
 *
 * O `shift_name` é calculado e **não armazenado**: lê-se, mas não serve para filtrar nem para
 * ordenar. O `name` é o que está guardado (*2f t1*), e é o recurso quando o outro vem vazio, como
 * acontece nos calendários standard herdados.
 */
export function nomeDoTurno(calendario: CalendarioOdoo): string {
	const legivel = typeof calendario.shift_name === 'string' ? calendario.shift_name.trim() : '';
	return legivel.length > 0 ? legivel : calendario.name;
}

/**
 * A hora de início do turno, para o separador.
 *
 * **O separador é só a hora.** O `shift_name` do Odoo é *Quinta-Feira 18:00*, e pô-lo inteiro num
 * botão repetia o dia da semana num cabeçalho que já o tem em grande — e fazia todos os separadores
 * de um dia começarem pela mesma palavra, que é a maneira mais rápida de os tornar indistinguíveis.
 * Os turnos que ali estão são todos do dia selecionado; o que os separa é a hora.
 *
 * Sai do nome porque é lá que está: o `shift_name` é calculado da primeira linha de horário do
 * calendário, e é essa a hora nominal do turno — não a `start_hour` das rotas, que varia de família
 * para família dentro do mesmo turno.
 *
 * **É também a hora com que um extra é atribuído a um turno** — ver `turnoDoExtra`, em `pos.ts`.
 */
export function horaDoTurno(calendario: CalendarioOdoo): string | null {
	const encontrado = /(\d{1,2}):(\d{2})/.exec(nomeDoTurno(calendario));
	if (!encontrado) return null;

	const horas = Number(encontrado[1]);
	if (!Number.isInteger(horas) || horas > 23) return null;

	return `${String(horas).padStart(2, '0')}:${encontrado[2]}`;
}

/* ------------------------------------------------------------ o estado POS */

/** O que o POS diz de uma família num dia: o estado, e os quilos. */
export interface ResumoDoBeneficiario {
	readonly estado: Estado;
	readonly peso: PesoDoCartao;
}

/**
 * Um extra já montado, à espera de saber se é do turno que está no ecrã.
 *
 * O `turno` vem da heurística de `turnoDoExtra`; o `peso` viaja ao lado do cartão porque o total do
 * cabeçalho se calcula com os pesos e não com o texto que eles produziram.
 */
interface ExtraDoDia {
	readonly turno: number | null;
	readonly quando: string;
	readonly peso: PesoDoCartao;
	readonly cartao: CartaoEntrega;
}

/** Tudo o que o POS e as fichas dizem sobre um dia. */
interface EstadoDoDia {
	/** O estado de cada família **prevista**, pelo id da ficha. */
	readonly porBeneficiario: ReadonlyMap<number, ResumoDoBeneficiario>;
	readonly extras: readonly ExtraDoDia[];
	readonly porIdentificar: number;
}

const DIA_VAZIO: EstadoDoDia = { porBeneficiario: new Map(), extras: [], porIdentificar: 0 };

/**
 * As fichas por trás dos parceiros que aparecem no POS, e das rotas do dia.
 *
 * **Entra-se pela ficha e nunca pelo `res.partner`, e a diferença é a correcção de um bug.**
 * O leitor acrescenta `['company_id', '=', empresa]` a toda a consulta, e o `company_id` do
 * `res.partner` é **opcional no Odoo**: vazio quer dizer "contacto partilhado", não "de nenhuma
 * empresa". A própria `ir.rule` do Odoo deixa passar o vazio —
 * `['|', ('company_id','=',False), ('company_id','in',company_ids)]` — e a nossa cláusula, mais
 * apertada do que a da base, descartava espelhos legítimos sem aviso: o cartão ficava por entregar
 * com a encomenda registada à frente. Na `res.beneficiary` o `company_id` é obrigatório e o âmbito
 * assenta nele. Ver `docs/modelos/beneficiarios.md`.
 *
 * São 50 espelhos sem `company_id` em 3 853 — poucos, mas o mesmo defeito valia 47 em 68 do lado
 * das fontes, que foi por onde se deu por ele.
 *
 * ## Uma leitura, duas perguntas — daí o `|`
 *
 * A `res.beneficiary` responde de uma vez a *«quem são as famílias com rota hoje»* (pelo `id`) e a
 * *«a quem pertencem os parceiros que aparecem no POS»* (pelo `partner_id`). Podiam ser duas
 * leituras; é uma, com um `|` no domínio, porque a segunda pergunta só se pode fazer depois de o
 * POS responder e não vale a pena pagar duas idas ao Odoo para o mesmo modelo no mesmo instante.
 *
 * **`active in [true, false]`, e o `active` vem nos campos.** As duas perguntas querem coisas
 * diferentes: a das rotas quer o arquivado — para cobrir a janela entre as caches, rotas 5 minutos e
 * fichas 15, em que a lista de rotas em cache ainda traz uma ficha arquivada há dois minutos, e sem
 * isso o cartão aparecia nesse intervalo **sem estado nenhum** —, e a dos extras não o quer, porque
 * **um televisor nunca mostra um registo arquivado**. Lê-se com os dois e separa-se aqui, com o
 * campo à mão.
 *
 * ## O `res.support.partner` é a segunda espécie, e só existe por causa dos extras
 *
 * Uma `pos.order` de Entregas aponta para beneficiários **e para parceiros de apoio** — 367 e 19
 * parceiros distintos, 8 995 e 1 220 encomendas. Enquanto cada cartão nascia de uma rota, as
 * encomendas de PA não casavam com nada e desapareciam: **os parceiros de apoio não têm rotas**. Com
 * os extras passam a ter cartão, e os quilos deles passam a contar no total do turno.
 */
async function lerFichas(
	leitor: LeitorDoNucleo,
	beneficiariosDoDia: readonly number[],
	parceirosDoPos: readonly number[],
): Promise<{ fichas: readonly BeneficiarioOdoo[]; parceirosDeApoio: readonly ParceiroDeApoioOdoo[] }> {
	const [fichas, parceirosDeApoio] = await Promise.all([
		beneficiariosDoDia.length === 0 && parceirosDoPos.length === 0
			? Promise.resolve([] as BeneficiarioOdoo[])
			: leitor.searchRead<BeneficiarioOdoo>(
					'res.beneficiary',
					['|', ['id', 'in', [...beneficiariosDoDia]], ['partner_id', 'in', [...parceirosDoPos]], ['active', 'in', [true, false]]],
					{
						fields: ['partner_id', 'number', 'active', 'adult_count', 'child_count', 'beneficiary_count'],
						limit: LIMITE_FICHAS,
						cache: CACHE_FICHAS_S,
					},
				),
		// Sem cláusula de `active`: o Odoo já esconde os arquivados por omissão, e aqui é isso que
		// se quer — um parceiro arquivado não faz cartão.
		parceirosDoPos.length === 0
			? Promise.resolve([] as ParceiroDeApoioOdoo[])
			: leitor.searchRead<ParceiroDeApoioOdoo>('res.support.partner', [['partner_id', 'in', [...parceirosDoPos]]], {
					fields: ['partner_id', 'number', 'name'],
					limit: LIMITE_FICHAS,
					cache: CACHE_FICHAS_S,
				}),
	]);

	return { fichas, parceirosDeApoio };
}

/**
 * O cartão de um extra a um beneficiário.
 *
 * Tudo o que ele mostra vem da **ficha**, e não de uma rota que não existe: o número, e as três
 * contagens do agregado. **Não leva hora** — não estava na escala do dia, portanto não há hora
 * combinada nenhuma para mostrar. Quem o marca no ecrã é a barra ponteada da esquerda.
 */
function cartaoDeBeneficiarioExtra(parceiro: number, ficha: BeneficiarioOdoo, resumo: ResumoDoBeneficiario): CartaoEntrega {
	return {
		rota: -parceiro,
		etiqueta: etiquetaDoNumero(ficha.number),
		ordem: ordemDoNumero(ficha.number),
		nome: null,
		hora: null,
		adultos: contagem(ficha.adult_count),
		criancas: contagem(ficha.child_count),
		pessoas: contagem(ficha.beneficiary_count),
		estado: resumo.estado,
		extra: true,
		peso: resumo.peso.estado === 'com_peso' ? resumo.peso.texto : null,
	};
}

/**
 * O cartão de uma entrega a um parceiro de apoio. **Todos são extras**, porque os parceiros de apoio
 * não têm rotas — não há escala de onde pudessem faltar.
 *
 * Onde uma família tem hora e composição do agregado, um parceiro tem o nome curto: não tem nem uma
 * nem outra, e o espaço estava a mais.
 */
function cartaoDeParceiroExtra(parceiro: number, ficha: ParceiroDeApoioOdoo, resumo: ResumoDoBeneficiario): CartaoEntrega {
	return {
		rota: -parceiro,
		etiqueta: etiquetaDoParceiro(ficha.number),
		ordem: ordemDoParceiro(ficha.number),
		nome: nomeCurtoDoParceiro(ficha.name),
		hora: null,
		adultos: null,
		criancas: null,
		pessoas: null,
		estado: resumo.estado,
		extra: true,
		peso: resumo.peso.estado === 'com_peso' ? resumo.peso.texto : null,
	};
}

/**
 * O que aconteceu no dia inteiro: o estado das famílias previstas, e os extras.
 *
 * **A comparação que decide o que é extra é contra as rotas do dia todo, e não do turno visível.**
 * Se fosse contra o turno, uma família servida no turno das 18h aparecia como cartão verde nesse
 * turno **e** como cartão extra no das 20h — os mesmos quilos em dois cabeçalhos do mesmo dia.
 *
 * A consequência que isto aceita, escrita para não ser surpresa: uma família que **tem** rota hoje e
 * recebe uma segunda entrega não combinada não ganha cartão de extra — os quilos somam no cartão
 * dela, como já somavam. Distinguir as duas encomendas exigiria saber qual delas correspondeu à
 * rota, e não há na base nada que o diga.
 */
async function lerEstadoDoDia(
	leitor: LeitorDoNucleo,
	dia: string,
	beneficiariosDoDia: readonly number[],
	turnos: readonly TurnoDoDia[],
): Promise<EstadoDoDia> {
	const { inicio, fim } = janelaDoDia(dia);
	const comoOdoo = (data: Date) => data.toISOString().slice(0, 19).replace('T', ' ');

	// As duas não dependem uma da outra: o POS diz o que aconteceu, e o catálogo diz qual das
	// observações não é uma falta. O catálogo vem de cache em regime.
	const [encomendas, tratados] = await Promise.all([
		leitor.searchRead<EncomendaOdoo>(
			'pos.order',
			[
				['session_id.config_id.pos_type', '=', CAIXA_DE_ENTREGAS],
				['date_order', '>=', comoOdoo(inicio)],
				['date_order', '<', comoOdoo(fim)],
			],
			{ fields: ['partner_id', 'date_order', 'name', 'total_in_kg'], limit: LIMITE_ENCOMENDAS },
		),
		lerIdsTratados(leitor),
	]);

	const parceirosDoPos = [
		...new Set(encomendas.map((encomenda) => many2oneId(encomenda.partner_id)).filter((id): id is number => id !== null)),
	];

	// As fichas e as linhas não dependem umas das outras — as duas só precisam das encomendas.
	const [{ fichas, parceirosDeApoio }, comFalta] = await Promise.all([
		lerFichas(leitor, beneficiariosDoDia, parceirosDoPos),
		encomendas.length === 0
			? Promise.resolve(new Set<number>() as ReadonlySet<number>)
			: lerEncomendasComFalta(
					leitor,
					encomendas.map((encomenda) => encomenda.id),
					tratados,
				),
	]);

	const resumos = resumoPorParceiro(encomendas, comFalta, TECTO_ENTREGAS_KG);

	const fichaDoParceiro = new Map<number, BeneficiarioOdoo>();
	const parceiroDaFicha = new Map<number, number>();
	for (const ficha of fichas) {
		const parceiro = many2oneId(ficha.partner_id);
		if (parceiro === null) continue;
		fichaDoParceiro.set(parceiro, ficha);
		parceiroDaFicha.set(ficha.id, parceiro);
	}

	const parceiroDeApoioDoParceiro = new Map<number, ParceiroDeApoioOdoo>();
	for (const parceiroDeApoio of parceirosDeApoio) {
		const parceiro = many2oneId(parceiroDeApoio.partner_id);
		if (parceiro !== null) parceiroDeApoioDoParceiro.set(parceiro, parceiroDeApoio);
	}

	// Os parceiros que **estavam na escala do dia**. Tudo o resto que apareça no POS é extra.
	const planeados = new Set<number>();
	for (const beneficiario of beneficiariosDoDia) {
		const parceiro = parceiroDaFicha.get(beneficiario);
		if (parceiro !== undefined) planeados.add(parceiro);
	}

	const porBeneficiario = new Map<number, ResumoDoBeneficiario>();
	const extras: ExtraDoDia[] = [];
	let porIdentificar = 0;

	for (const [parceiro, resumo] of resumos) {
		const estado: ResumoDoBeneficiario = { estado: resumo.falta ? 'falta' : 'entregue', peso: resumo.peso };
		const ficha = fichaDoParceiro.get(parceiro);

		if (planeados.has(parceiro)) {
			if (ficha !== undefined) porBeneficiario.set(ficha.id, estado);
			continue;
		}

		// Um televisor nunca mostra um registo arquivado — nem sequer o de um extra.
		if (ficha !== undefined && ficha.active) {
			extras.push({
				turno: turnoDoExtra(resumo.quando, turnos),
				quando: resumo.quando,
				peso: resumo.peso,
				cartao: cartaoDeBeneficiarioExtra(parceiro, ficha, estado),
			});
			continue;
		}

		const parceiroDeApoio = parceiroDeApoioDoParceiro.get(parceiro);
		if (parceiroDeApoio !== undefined) {
			extras.push({
				turno: turnoDoExtra(resumo.quando, turnos),
				quando: resumo.quando,
				peso: resumo.peso,
				cartao: cartaoDeParceiroExtra(parceiro, parceiroDeApoio, estado),
			});
			continue;
		}

		porIdentificar++;
	}

	return { porBeneficiario, extras, porIdentificar };
}

/* ------------------------------------------------------------- a montagem */

/**
 * O painel completo de um dia e de um turno.
 *
 * A ordem das leituras não é acidental: primeiro as rotas, que definem quem devia estar no ecrã, e
 * só depois o POS, que diz o que aconteceu — a cada uma delas, e a quem lá não estava.
 *
 * **Um dia sem rotas nenhumas não lê o POS, e por isso não mostra extras.** Sem rotas não há turnos,
 * e sem turnos não há sítio onde um extra possa aparecer: a grelha tem sempre um turno por baixo. É
 * o dia em que o núcleo não opera, e o preço é um extra registado nesse dia não se ver no televisor
 * — inventar um turno para o pendurar era pior, e a alternativa custava uma ida ao Odoo por refresh
 * em todos os dias vazios de todos os ecrãs.
 */
export async function montarPainel(contexto: ContextoTv, agora: Date): Promise<PainelEntregas> {
	const { leitor, vista } = contexto;
	const hoje = diaRefood(agora);

	// Um dia fora da janela navegável volta a hoje em silêncio. O ecrã fica onde o deixaram, mas o
	// que se deixa é uma seta carregada, não um endereço escrito à mão.
	const pedido = vista.dia !== null && diaValido(vista.dia) ? vista.dia : hoje;
	const distancia = diferencaEmDias(hoje, pedido);
	const dia = distancia < 0 || distancia > DIAS_PARA_A_FRENTE ? hoje : pedido;

	const rotas = await leitor.searchRead<RotaOdoo>(
		'res.delivery.route',
		[
			['week_day', '=', diaDaSemanaOdoo(dia)],
			// Uma rota só conta a partir do dia em que começou — ver a nota do `LIMITE_DE_ARRANQUE`.
			// **Não há aqui `is_route_ongoing`, e é deliberado**: ver a nota abaixo.
			[LIMITE_DE_ARRANQUE, '<=', `${dia} 23:59:59`],
			/*
			 * **A ficha arquivada não faz cartão.** Uma rota continua a apontar para a ficha depois de
			 * ela ser arquivada: hoje, arquivar apaga as rotas, mas antes era um processo manual e
			 * ficaram rotas penduradas em fichas que já não são da operação. Medido em staging:
			 * ****544 rotas de 3 252 — 16,7%** apontam para beneficiários arquivados**, e num único turno chegam a ser **37, em Benfica**.
			 *
			 * Informação histórica não é para aparecer aqui — o televisor mostra o trabalho de hoje.
			 *
			 * **O filtro é na rota e não na ficha**, para o cartão nunca nascer: filtrar depois deixava
			 * o cartão no ecrã sem a ficha por trás, que é exactamente o sintoma que se viu — um cartão
			 * com nome e sem número, porque o nome vem da rota e o número da ficha.
			 *
			 * As `res.collection.route` e `res.delivery.route` **não têm `active`** — não são
			 * arquiváveis, são apagadas —, portanto a única cláusula possível é a travessia. Verificada
			 * contra a base: as contagens fecham exactamente (3 252 = 2 708 + 544).
			 */
			['beneficiary_id.active', '=', true],
		],
		{
			fields: [
				'resource_calendar_id',
				'beneficiary_id',
				'related_beneficiary_number',
				'start_hour',
				'adult_count',
				'child_count',
				'beneficiary_count',
			],
			limit: LIMITE_ROTAS,
			cache: CACHE_ROTAS_S,
		},
	);

	const idsDeTurno = [...new Set(rotas.map((rota) => many2oneId(rota.resource_calendar_id)).filter((id): id is number => id !== null))];

	// `active in [true, false]`: um turno arquivado continua a ter rotas apontadas para ele, e sem
	// isto o cabeçalho ficava sem nome para mostrar.
	const calendarios =
		idsDeTurno.length === 0
			? []
			: await leitor.searchRead<CalendarioOdoo>(
					'resource.calendar',
					[
						['id', 'in', idsDeTurno],
						['active', 'in', [true, false]],
					],
					{ fields: ['name', 'shift_name'], limit: LIMITE_TURNOS, cache: CACHE_TURNOS_S },
				);

	/*
	 * Ordenados pela hora, que é o que o separador mostra.
	 *
	 * **O `nome` é o `name` do calendário, não o `shift_name`.** O `shift_name` é derivado da
	 * primeira linha de horário e dá a hora — que é boa para o separador e **insuficiente para
	 * identificar**: há núcleos com seis turnos no mesmo dia e dois deles a começar à mesma hora
	 * (`Turno 2.18` e `Turno 2.18 Hiper`). O que os distingue é o nome que alguém escreveu, e é esse
	 * que vai para o cabeçalho.
	 *
	 * **A ordem por hora também é contrato do `turnoDoExtra`**, que percorre esta lista à procura do
	 * último turno já começado.
	 */
	const turnos: TurnoDoDia[] = calendarios
		.map((calendario) => ({ id: calendario.id, nome: calendario.name, hora: horaDoTurno(calendario) }))
		.sort((a, b) => (a.hora ?? '99:99').localeCompare(b.hora ?? '99:99') || a.nome.localeCompare(b.nome, 'pt'));

	const turno = turnos.find((candidato) => candidato.id === vista.turno) ?? turnos[0] ?? null;
	const doTurno = turno === null ? [] : rotas.filter((rota) => many2oneId(rota.resource_calendar_id) === turno.id);

	// **Do dia inteiro, e não do turno.** É esta lista que diz o que estava na escala, e é contra ela
	// que se decide o que é extra — ver `lerEstadoDoDia`.
	const beneficiariosDoDia = [...new Set(rotas.map((rota) => many2oneId(rota.beneficiary_id)).filter((id): id is number => id !== null))];
	const estado = turno === null ? DIA_VAZIO : await lerEstadoDoDia(leitor, dia, beneficiariosDoDia, turnos);

	// Os pesos ficam à parte da grelha porque o total é a soma **destes** — e a grelha vai ser
	// ordenada a seguir, o que não pode mexer num total.
	const pesos: PesoDoCartao[] = [];

	const previstos: CartaoEntrega[] = doTurno
		.map((rota) => {
			const beneficiario = many2oneId(rota.beneficiary_id);
			const resumo = beneficiario === null ? undefined : estado.porBeneficiario.get(beneficiario);
			const peso = resumo?.peso ?? { estado: 'sem_peso' as const };
			pesos.push(peso);

			return {
				rota: rota.id,
				etiqueta: etiquetaDoNumero(rota.related_beneficiary_number),
				ordem: ordemDoNumero(rota.related_beneficiary_number),
				nome: null,
				hora: horaDecimal(rota.start_hour),
				adultos: contagem(rota.adult_count),
				criancas: contagem(rota.child_count),
				pessoas: contagem(rota.beneficiary_count),
				estado: resumo?.estado ?? ('por_entregar' as const),
				extra: false,
				peso: peso.estado === 'com_peso' ? peso.texto : null,
			};
		})
		/*
		 * **A ordem é a do número, sempre, e é ela que faz a grelha ser procurável.**
		 *
		 * Ordena-se aqui e não no Odoo: o número é texto (`PTABF_BF000028`), e um `order` alfabético
		 * punha o B10 antes do B9. Quem não tem número vai para o fim, por ordem de rota, para a
		 * posição ser estável.
		 *
		 * **Não é pela hora, e o painel das recolhas ao lado ordena pela hora — a diferença é de
		 * propósito.** Nas recolhas a hora é a ordem do trabalho, feito em sequência. Aqui o
		 * `start_hour` é **indicativo, e raramente cumprido**: as famílias chegam por sua conta, e
		 * quem olha para este ecrã procura um número concreto — *"onde está o B47?"* —, não a próxima
		 * da fila. Uma grelha por hora dava uma ordem que a realidade não segue.
		 *
		 * Pelo mesmo motivo, **nada aqui deve contar atrasos nem alarmar sobre a hora**: comparar o
		 * `start_hour` com o relógio dava um ecrã cheio de avisos sobre uma hora que ninguém prometeu
		 * cumprir. Confirmado com a equipa em setembro de 2026.
		 */
		.sort((a, b) => {
			if (a.ordem === null && b.ordem === null) return a.rota - b.rota;
			if (a.ordem === null) return 1;
			if (b.ordem === null) return -1;
			return a.ordem - b.ordem;
		});

	/*
	 * **Os extras vão para o fim, e pela ordem em que aconteceram.**
	 *
	 * Ao fim porque a grelha tem de continuar a ser procurável pelo número: um extra intercalado
	 * movia todos os cartões abaixo dele de sítio a meio do turno, que é exactamente o que a ordem
	 * estável existe para não fazer.
	 *
	 * Entre si é pelo `date_order`, e não pelo número: um extra não estava na escala, portanto não há
	 * ordem prevista nenhuma a que pertença — o que dele se sabe é quando aconteceu. O parceiro
	 * desempata, para dois registos do mesmo segundo não trocarem de lugar entre refreshes.
	 */
	const extras: CartaoEntrega[] = estado.extras
		.filter((extra) => turno !== null && extra.turno === turno.id)
		.sort((a, b) => a.quando.localeCompare(b.quando) || a.cartao.rota - b.cartao.rota)
		.map((extra) => {
			pesos.push(extra.peso);
			return extra.cartao;
		});

	return {
		dia,
		hoje,
		nomeDoDia: nomeDoDiaDaSemana(dia),
		relacao: relacaoComHoje(dia, hoje),
		podeRecuar: diferencaEmDias(hoje, dia) > 0,
		podeAvancar: diferencaEmDias(hoje, dia) < DIAS_PARA_A_FRENTE,
		turnos,
		turno,
		cartoes: [...previstos, ...extras],
		...totalDoPainel(pesos),
		porIdentificar: estado.porIdentificar,
		notas: [],
	};
}

/**
 * `GET /api/entregas` — a grelha de um dia e de um turno.
 *
 * O dia e o turno vêm do pedido; o núcleo **não**, e não há por onde o passar. Ver o `ContextoTv`.
 */
export const rotaEntregas: RotaTv = async (contexto) => {
	const painel = await montarPainel(contexto, contexto.agora);
	return Response.json({ ok: true, painel });
};

/** O dia seguinte e o anterior, para quem desenhar as setas do lado do ecrã. */
export const proximoDia = somarDias;
