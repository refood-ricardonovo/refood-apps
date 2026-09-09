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
 * 2. **Travão por IP.** Antes do interruptor, de propósito: se corresse depois, um `429` só apareceria
 *    com a entrada aberta e a resposta passava a dizer em que estado é que o interruptor está.
 * 3. **Interruptor.** Fechado responde **exactamente** como "não há ficha" — mesmo corpo, mesmo
 *    estado. Fechado é o valor por omissão: um segredo em falta fecha, nunca abre.
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
 * ## O `_VL` do barcode verifica-se em JS, e não no domínio
 *
 * `_` é um wildcard de um caractere no `LIKE` do SQL: um domínio `['barcode', 'like', '%_VL']`
 * casaria com `XVL`, `1VL` e tudo o que acabe em três caracteres terminados em `VL`. A verificação
 * fica do lado do Worker, onde `_` é só um underscore.
 */

import { many2oneId } from '@refood/odoo';
import { nomeCurto } from './nomes';
import { LINGUA, ligarAoOdoo } from './odoo';

/** Cinco chega: o máximo de fichas activas com o mesmo NIF normalizado, medido em staging, é três. */
const LIMITE_FICHAS = 5;

/** O sufixo que um `barcode` de voluntário tem. Verificado em JS — ver o cabeçalho. */
const SUFIXO_VOLUNTARIO = '_VL';

/** O valor que abre a entrada. Qualquer outra coisa, e a ausência do segredo, fecha. */
const ABERTA = 'aberta';

type FichaOdoo = {
	id: number;
	name: string | false;
	full_name: string | false;
	company_id: [number, string] | false;
	barcode: string | false;
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

/** Um `barcode` de voluntário acaba em `_VL`. Sem barcode, não é candidato. */
export function ehVoluntario(barcode: unknown): boolean {
	return typeof barcode === 'string' && barcode.trimEnd().endsWith(SUFIXO_VOLUNTARIO);
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
 * **É a mesma com a entrada fechada e com a entrada aberta e sem resultados**, e essa igualdade é
 * deliberada: o corpo não diz se o interruptor está ligado. Encaminha para o núcleo, que é o que
 * uma pessoa sem ficha utilizável — 418 activas, uma em catorze — tem de fazer.
 */
function semFicha(): Response {
	return Response.json({ ok: false, erro: 'sem_ficha', mensagem: 'Não encontrámos a tua ficha. Fala com o teu núcleo.' }, { status: 404 });
}

export async function rotaEntrar(request: Request, env: Env): Promise<Response> {
	const corpo = (await request.json().catch(() => null)) as { nif?: unknown } | null;
	const digitos = digitosDoNif(corpo?.nif);

	// Formato primeiro: o que não são nove dígitos não chega ao Odoo nem gasta uma tentativa.
	if (digitos === null) {
		return Response.json({ ok: false, erro: 'formato', mensagem: 'O NIF são nove dígitos.' }, { status: 400 });
	}

	// **Antes do interruptor**: um 429 que só aparecesse com a entrada aberta denunciava o estado dela.
	const origem = request.headers.get('CF-Connecting-IP') ?? 'desconhecida';
	if (excedeTentativas(origem, Date.now())) {
		return Response.json({ ok: false, erro: 'demasiadas_tentativas' }, { status: 429, headers: { 'Retry-After': '60' } });
	}

	if (env.ENTRADA_ABERTA !== ABERTA) return semFicha();

	const { cliente, empresas, nucleos } = await ligarAoOdoo(env);
	if (empresas.length === 0) return semFicha();

	const opcoes = {
		fields: ['id', 'name', 'full_name', 'company_id', 'barcode'],
		limit: LIMITE_FICHAS,
		order: 'id asc',
		lang: LINGUA,
		context: { allowed_company_ids: [...empresas] },
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

	const candidatas = fichas.filter((f) => ehVoluntario(f.barcode));
	const ficha = candidatas[0];
	if (!ficha) return semFicha();

	const empresa = many2oneId(ficha.company_id);
	if (empresa === null) return semFicha();

	/*
	 * **Fica com a primeira, e não diz que havia mais.**
	 *
	 * Em staging há 33 valores normalizados em mais do que uma ficha activa, e 14 atravessam
	 * núcleos. Mostrar a lista à pessoa era entregar o oráculo de uma vez — *este NIF é voluntário
	 * nestes núcleos* —, que é o que o interruptor existe para evitar. O desempate a sério é o
	 * código para o `hr_email`, e não existe ainda.
	 */
	await env.DB.prepare('INSERT INTO presencas_demo (employee_id, company_id, criado_em) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
		.bind(ficha.id, empresa, new Date().toISOString())
		.run();

	return Response.json({
		ok: true,
		nome: nomeCurto(ficha.full_name, ficha.name),
		nucleo: nucleos.get(empresa) ?? null,
	});
}
