/**
 * `POST /api/entrar` — o atalho da demonstração: um NIF entra, um nome e um núcleo saem.
 *
 * **Isto não autentica ninguém.** Quem escreve um NIF não prova que é essa pessoa, e a rota
 * responde na mesma. É o atalho que sai no dia em que o login a sério entrar — NIF, código para o
 * `hr_email`, PIN escolhido — e o `CLAUDE.md` desta app diz porquê e o que o cerca até lá.
 *
 * ## A ordem dos passos não é acidental
 *
 * 1. **Formato.** Nove dígitos depois de tirar o resto. Fora disso não se toca no Odoo — é o filtro
 *    que impede um `=ilike` de correr com o que alguém escreveu à toa.
 * 2. **Travão por IP.** Antes do interruptor, porque **também vale com a porta fechada**: uma rota
 *    aberta ao mundo que responde sempre a mesma coisa continua a ser uma rota que alguém pode
 *    martelar, e o travão é o que limita o ritmo nos dois estados.
 * 3. **Interruptor.** Fechado responde como "não há ficha". **Já não é para esconder o estado** — o
 *    `GET /api/estado` publica-o, porque a página de entrada tem de saber qual das duas versões
 *    mostrar. É simplesmente a resposta certa: com a porta fechada não há ficha nenhuma a devolver,
 *    e um segundo caminho de código para dizer o mesmo por outras palavras não serve ninguém.
 *    Fechado é o valor por omissão — ver `interruptor.ts`.
 * 4. **Odoo**, em duas passagens.
 * 5. **D1**, uma linha por pessoa.
 *
 * ## As duas passagens, e porque é que a segunda precisa de confirmação em JS
 *
 * A primeira é igualdade sobre o `vat`, que está armazenado. Apanha as fichas cujo NIF está guardado
 * exactamente como a pessoa o escreveu.
 *
 * A segunda só corre se a primeira vier vazia, e existe pelas **317 fichas activas cujo `vat` tem
 * espaços pelo meio** — `123 456 789`. O `=ilike` com os dígitos separados por `%` apanha-as, mas
 * apanha muito mais: `%` casa com qualquer coisa, portanto `1%2%3…` também casa com um valor que
 * tenha outros dígitos pelo meio. **O domínio não filtra isso, e por isso a igualdade confirma-se em
 * JS**, normalizando o `vat` que veio e comparando com os nove dígitos escritos.
 *
 * ## Não há filtro por `barcode`, e a razão é de produto
 *
 * A rota exigia `_VL` no fim do `barcode` e descartava tudo o resto. **Deixou de exigir:
 * encontrar uma ficha activa com aquele NIF é a resposta, e o núcleo é o `company_id` dela.** Um
 * voluntário sem código de barras existe na base e não conseguia entrar; e uma ficha com outro
 * sufixo não é, para efeitos desta demonstração, uma ficha de outra coisa.
 *
 * Se o filtro voltar, **verifica-se em JS e nunca num domínio**: `_` é um wildcard de um
 * caractere no `LIKE` do SQL, e `['barcode', 'like', '%_VL']` casaria com `XVL`, `1VL` e tudo o
 * que acabe em três caracteres terminados em `VL`.
 *
 * ## Não vai âmbito nenhum no contexto, e não é esquecimento
 *
 * Não se constrói `allowed_company_ids`. Esta rota existe para descobrir o núcleo, portanto não
 * pode restringir-se a uma lista antes de o conhecer — e o tecto do que a conta lê continua a
 * ser imposto pelo Odoo, que um contexto só podia estreitar. Ver `odoo.ts`.
 */

import { createOdooClient, many2one } from '@refood/odoo';
import { nomeCurto, nucleoDaEntrada } from './nomes';
import { entradaAberta } from './interruptor';
import { LINGUA } from './odoo';

/** Cinco chega: o máximo de fichas activas com o mesmo NIF normalizado, medido em staging, é três. */
const LIMITE_FICHAS = 5;

type FichaOdoo = {
	id: number;
	name: string | false;
	full_name: string | false;
	company_id: [number, string] | false;
	vat?: string | false;
};

/** Tirar tudo o que não é dígito. É o que faz `123 456 789` casar com o que a pessoa escreve. */
export function digitosDoNif(valor: unknown): string | null {
	if (typeof valor !== 'string' && typeof valor !== 'number') return null;

	const digitos = String(valor).replace(/\D/g, '');
	return digitos.length === 9 ? digitos : null;
}

/**
 * O padrão da segunda passagem: `123456789` → `1%2%3%4%5%6%7%8%9`.
 *
 * Sem `%` nas pontas, de propósito: o valor tem de **começar** no primeiro dígito e **acabar** no
 * último. Um `%` à cabeça faria a pesquisa apanhar qualquer NIF que contivesse estes nove dígitos
 * pelo meio, e a base tem que os percorrer a todos.
 */
export function padraoFrouxo(digitos: string): string {
	return digitos.split('').join('%');
}

/* ------------------------------------------------------------ travão por IP */

/**
 * Dez tentativas por minuto e por origem, em memória do isolate.
 *
 * **Não protege de nada determinado, e é para isso mesmo.** Um atacante a sério distribui-se por
 * isolates e por IPs; isto trava o script distraído e o dedo preso no Enter. O que verdadeiramente
 * limita esta rota no tempo é o interruptor.
 *
 * **Nada é escrito e nada sai do isolate.** É a diferença para o `tentativas_admin` do `apps/tv`,
 * que hasheia o IP com o segredo porque o guarda numa base de dados; um `Map` que morre com o
 * isolate e que ninguém lê não ganha nada com o hash — ganha um parágrafo a explicá-lo.
 */
const JANELA_MS = 60_000;
const MAX_TENTATIVAS = 10;
const baldes = new Map<string, { desde: number; tentativas: number }>();

export function excedeTentativas(origem: string, agora: number): boolean {
	// Limpeza oportunista: o mapa só cresce enquanto houver tráfego, e é aqui que ele passa.
	for (const [chave, balde] of baldes) {
		if (agora - balde.desde >= JANELA_MS) baldes.delete(chave);
	}

	const balde = baldes.get(origem);
	if (!balde || agora - balde.desde >= JANELA_MS) {
		baldes.set(origem, { desde: agora, tentativas: 1 });
		return false;
	}

	balde.tentativas++;
	return balde.tentativas > MAX_TENTATIVAS;
}

/* ------------------------------------------------------------------ a rota */

/**
 * A resposta de "não encontrámos ficha".
 *
 * **É a mesma com a entrada fechada e com a entrada aberta e sem resultados.** Não para esconder
 * o estado do interruptor — esse é público, no `/api/estado` — mas porque é a mesma verdade: não
 * há ficha para devolver, e as duas situações não pedem duas frases.
 *
 * ## A frase é escolhida, palavra a palavra, e não é uma mensagem de erro
 *
 * Vai ser lida por dezenas de pessoas ao mesmo tempo, numa sala, com quem está ao lado a ver o ecrã
 * do vizinho. **418 fichas activas não têm NIF utilizável — uma em catorze** — e nem toda a gente
 * que está na sala está em sistema. Isto vai aparecer muitas vezes, e não pode soar a recusa.
 *
 * - **"Ainda"** tira o definitivo: não é um "não", é um "por enquanto".
 * - **"Há fichas por completar"** põe a falha no sistema, onde ela está, e não na pessoa.
 * - **"pode ser uma delas"** não afirma uma causa que esta rota não sabe. A ficha pode não ter NIF,
 *   ter um diferente do que a pessoa escreveu, ou a pessoa pode nunca ter sido registada — e daqui
 *   não se distingue nenhuma das três. Uma frase que dissesse *"falta o NIF na tua ficha"* seria
 *   mais tranquilizadora e podia estar errada em voz alta.
 * - **"eles tratam disso"** fecha com o passo seguinte, e com ele do lado de quem o pode dar.
 *
 * O ecrã mostra-a **a branco**, e não no vermelho do erro de formato: vermelho lê-se como recusa, e
 * a única coisa aqui que é mesmo uma correcção é o "o NIF são nove dígitos".
 */
function semFicha(): Response {
	return Response.json(
		{
			ok: false,
			erro: 'sem_ficha',
			titulo: 'Ainda não te encontrámos.',
			mensagem: 'Há fichas por completar, e a tua pode ser uma delas. Diz ao teu núcleo e eles tratam disso.',
		},
		{ status: 404 },
	);
}

export async function rotaEntrar(request: Request, env: Env): Promise<Response> {
	const corpo = (await request.json().catch(() => null)) as { nif?: unknown } | null;
	const digitos = digitosDoNif(corpo?.nif);

	// Formato primeiro: o que não são nove dígitos não chega ao Odoo nem gasta uma tentativa.
	if (digitos === null) {
		return Response.json({ ok: false, erro: 'formato', mensagem: 'O NIF são nove dígitos.' }, { status: 400 });
	}

	// Antes do interruptor: o travão vale nos dois estados. Ver o cabeçalho.
	const origem = request.headers.get('CF-Connecting-IP') ?? 'desconhecida';
	if (excedeTentativas(origem, Date.now())) {
		return Response.json({ ok: false, erro: 'demasiadas_tentativas' }, { status: 429, headers: { 'Retry-After': '60' } });
	}

	if (!entradaAberta(env)) return semFicha();

	const cliente = createOdooClient(env);

	const opcoes = {
		fields: ['id', 'name', 'full_name', 'company_id'],
		limit: LIMITE_FICHAS,
		order: 'id asc',
		lang: LINGUA,
	};

	// Passagem 1: igualdade sobre o `vat`, que está armazenado.
	let fichas = await cliente.searchRead<FichaOdoo>(
		'hr.employee',
		[
			['vat', '=', digitos],
			['active', '=', true],
		],
		opcoes,
	);

	// Passagem 2, só se a primeira nada trouxe: apanha o `vat` com espaços pelo meio.
	if (fichas.length === 0) {
		const largas = await cliente.searchRead<FichaOdoo>(
			'hr.employee',
			[
				['vat', '=ilike', padraoFrouxo(digitos)],
				['active', '=', true],
			],
			{ ...opcoes, fields: [...opcoes.fields, 'vat'] },
		);
		// O `=ilike` traz falsos positivos que o domínio não sabe filtrar: confirma-se aqui.
		fichas = largas.filter((f) => digitosDoNif(f.vat) === digitos);
	}

	// A primeira que aparecer, por `id` ascendente. Não há mais nenhum filtro depois da pesquisa.
	const ficha = fichas[0];
	if (!ficha) return semFicha();

	/*
	 * **O núcleo é o `company_id` da ficha**, e o nome dele vem dentro do próprio many2one, já em
	 * pt-PT por causa do `lang` — não é preciso uma segunda leitura a `res.company`.
	 *
	 * Sem empresa não há núcleo a dizer. O `company_id` é obrigatório no `hr.employee`, portanto
	 * isto é uma guarda e não um caso esperado.
	 */
	const nucleo = many2one(ficha.company_id);
	if (nucleo === null) return semFicha();

	/*
	 * **Fica com a primeira, e não diz que havia mais.**
	 *
	 * Em staging há 33 valores normalizados em mais do que uma ficha activa, e 14 atravessam
	 * núcleos. Mostrar a lista à pessoa era entregar o oráculo de uma vez — *este NIF é voluntário
	 * nestes núcleos* —, que é o que o interruptor existe para evitar. O desempate a sério é o
	 * código para o `hr_email`, e não existe ainda.
	 */
	await env.DB.prepare('INSERT INTO presencas_demo (employee_id, company_id, criado_em) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
		.bind(ficha.id, nucleo.id, new Date().toISOString())
		.run();

	return Response.json({
		ok: true,
		nome: nomeCurto(ficha.full_name, ficha.name),
		nucleo: nucleoDaEntrada(nucleo.nome),
	});
}
