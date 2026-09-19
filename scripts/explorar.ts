/**
 * Explorador da base Odoo — ferramenta de desenvolvimento, não faz parte de nenhum Worker.
 *
 * Mostra os campos de um modelo (`fields_get`) e uma amostra de registos, para perceber como é que
 * os dados estão realmente montados antes de escrever queries nas apps.
 *
 * ```bash
 * node --experimental-strip-types scripts/explorar.ts res.partner
 * node --experimental-strip-types scripts/explorar.ts res.partner --limite=3 --campos=name,email
 * node --experimental-strip-types scripts/explorar.ts sale.order --dominio='[["state","=","sale"]]'
 * node --experimental-strip-types scripts/explorar.ts --modelos=refood
 * ```
 *
 * Autentica com o utilizador de integração do `.dev.vars`, que **não** está limitado a um núcleo:
 * este script lê a base toda. Não é o caminho das apps — a TV lê sempre com o `company_id` do token
 * no domínio e `allowed_company_ids` no contexto.
 */

import type { OdooDomain, OdooMany2One, OdooRecord } from '@refood/odoo';

import { carregarEnv, createOdooClient, many2one } from './ligacao.ts';

/** Atributos pedidos ao `fields_get`. O default do cliente não traz `relation`, que é meia informação num many2one. */
const ATRIBUTOS = ['string', 'type', 'required', 'readonly', 'store', 'relation', 'selection'] as const;

/** Tipos que não vale a pena imprimir numa amostra — são megabytes de base64 ou de HTML. */
const TIPOS_VOLUMOSOS = new Set(['binary', 'image', 'html']);

const LARGURA_VALOR = 100;

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------

interface Opcoes {
	modelo: string | null;
	/** `null` = não pedido; `''` = pedido sem filtro. */
	modelos: string | null;
	/**
	 * A língua em que se lê. **Por omissão `pt_PT`, e impressa no cabeçalho de tudo o que sai.**
	 *
	 * Os rótulos do `fields_get` e o `name` de muitos modelos são traduzidos: o `company_id` da
	 * `res.food.source` é *Center* em `en_US` e *Núcleo* em `pt_PT`. Os dez documentos de
	 * `docs/modelos/` foram levantados sem `lang`, portanto **em `en_US`** — dizer sempre em que
	 * língua se leu é o que mantém os levantamentos comparáveis entre si.
	 */
	lingua: string;
	limite: number;
	dominio: OdooDomain;
	campos: string[] | null;
	todos: boolean;
	json: boolean;
}

function analisarArgumentos(argv: readonly string[]): Opcoes {
	const opcoes: Opcoes = { modelo: null, modelos: null, lingua: 'pt_PT', limite: 5, dominio: [], campos: null, todos: false, json: false };

	for (const arg of argv) {
		if (!arg.startsWith('--')) {
			if (opcoes.modelo !== null) throw new Error(`Só se inspeciona um modelo de cada vez; recebi '${opcoes.modelo}' e '${arg}'`);
			opcoes.modelo = arg;
			continue;
		}

		const igual = arg.indexOf('=');
		const nome = igual === -1 ? arg.slice(2) : arg.slice(2, igual);
		const valor = igual === -1 ? '' : arg.slice(igual + 1);

		switch (nome) {
			case 'modelos':
				opcoes.modelos = valor;
				break;
			case 'lingua':
				if (!/^[a-z]{2}_[A-Z]{2}$/.test(valor))
					throw new Error(`--lingua tem de ser um código Odoo como pt_PT ou en_US, recebi '${valor}'`);
				opcoes.lingua = valor;
				break;
			case 'limite':
				opcoes.limite = Number(valor);
				if (!Number.isInteger(opcoes.limite) || opcoes.limite < 0)
					throw new Error(`--limite tem de ser um inteiro >= 0, recebi '${valor}'`);
				break;
			case 'dominio':
				opcoes.dominio = analisarDominio(valor);
				break;
			case 'campos':
				opcoes.campos = valor
					.split(',')
					.map((campo) => campo.trim())
					.filter(Boolean);
				break;
			case 'todos':
				opcoes.todos = true;
				break;
			case 'json':
				opcoes.json = true;
				break;
			default:
				throw new Error(`Opção desconhecida: --${nome}`);
		}
	}
	return opcoes;
}

function analisarDominio(valor: string): OdooDomain {
	let analisado: unknown;
	try {
		analisado = JSON.parse(valor);
	} catch (causa) {
		throw new Error(`--dominio não é JSON válido: ${(causa as Error).message}. Ex.: --dominio='[["state","=","done"]]'`);
	}
	if (!Array.isArray(analisado)) throw new Error(`--dominio tem de ser um array. Ex.: --dominio='[["active","=",true]]'`);
	return analisado as OdooDomain;
}

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

function truncar(texto: string, largura = LARGURA_VALOR): string {
	const numaLinha = texto.replace(/\s+/g, ' ').trim();
	return numaLinha.length > largura ? `${numaLinha.slice(0, largura - 1)}…` : numaLinha;
}

/** Um many2one chega como `[id, display_name]`; um x2many como um array de ids. */
function ehMany2One(valor: readonly unknown[]): valor is [number, string] {
	return valor.length === 2 && typeof valor[0] === 'number' && typeof valor[1] === 'string';
}

/** Um valor do Odoo em texto legível. `false` é "sem valor" em qualquer tipo de campo — menos em boolean. */
function formatarValor(valor: unknown, tipo?: string): string {
	if (valor === false) return tipo === 'boolean' ? 'false' : '—';
	if (valor === true) return 'true';
	if (valor === null || valor === undefined) return '—';

	if (Array.isArray(valor)) {
		if (valor.length === 0) return '—';
		if (ehMany2One(valor)) {
			const relacao = many2one(valor as OdooMany2One);
			return relacao === null ? '—' : `[${relacao.id}] ${truncar(relacao.nome, 60)}`;
		}
		return `${valor.length} ids: ${truncar(valor.join(', '), 60)}`;
	}

	if (typeof valor === 'object') return truncar(JSON.stringify(valor));
	return truncar(String(valor));
}

/** Tabela alinhada, sem dependências. */
function imprimirTabela(cabecalhos: readonly string[], linhas: readonly (readonly string[])[]): void {
	const larguras = cabecalhos.map((cabecalho, i) => Math.max(cabecalho.length, ...linhas.map((linha) => (linha[i] ?? '').length)));
	const alinhar = (celulas: readonly string[]) =>
		celulas
			.map((celula, i) => (celula ?? '').padEnd(larguras[i] ?? 0))
			.join('  ')
			.trimEnd();

	console.log(alinhar(cabecalhos));
	console.log(larguras.map((largura) => '─'.repeat(largura)).join('  '));
	for (const linha of linhas) console.log(alinhar(linha));
}

function titulo(texto: string): void {
	console.log(`\n${texto}\n${'═'.repeat(texto.length)}`);
}

// ---------------------------------------------------------------------------
// Comandos
// ---------------------------------------------------------------------------

type Campos = Record<string, Record<string, unknown>>;

/** Descrição curta de um campo: o alvo da relação, ou as chaves possíveis de uma selecção. */
function detalheCampo(campo: Record<string, unknown>): string {
	if (typeof campo.relation === 'string' && campo.relation) return `→ ${campo.relation}`;
	if (Array.isArray(campo.selection)) {
		return truncar(campo.selection.map((par) => (Array.isArray(par) ? String(par[0]) : String(par))).join(' | '), 60);
	}
	return '';
}

function mostrarCampos(modelo: string, campos: Campos, todos: boolean): void {
	const nomes = Object.keys(campos).sort();
	const visiveis = todos ? nomes : nomes.filter((nome) => campos[nome]?.store !== false);

	titulo(`Campos de ${modelo} (${visiveis.length}${todos ? '' : ` de ${nomes.length}, só armazenados`})`);
	imprimirTabela(
		['CAMPO', 'TIPO', 'OBR', 'ETIQUETA', 'DETALHE'],
		visiveis.map((nome) => {
			const campo = (campos[nome] ?? {}) as Record<string, unknown>;
			return [nome, String(campo.type ?? '?'), campo.required ? 'sim' : '', truncar(String(campo.string ?? ''), 40), detalheCampo(campo)];
		}),
	);

	if (!todos && visiveis.length < nomes.length) {
		console.log(`\n(${nomes.length - visiveis.length} campos calculados não-armazenados omitidos — usa --todos para os ver.)`);
	}
}

/** Campos a ler na amostra: os pedidos, ou todos os armazenados tirando os volumosos. */
function camposDaAmostra(campos: Campos, pedidos: string[] | null): string[] {
	if (pedidos) return pedidos;
	return Object.keys(campos).filter((nome) => {
		const campo = (campos[nome] ?? {}) as Record<string, unknown>;
		return campo.store !== false && !TIPOS_VOLUMOSOS.has(String(campo.type));
	});
}

/** Cada registo como um bloco campo/valor. Esconder os vazios é o que revela onde há mesmo dados. */
function mostrarRegistos(registos: readonly OdooRecord[], campos: Campos, todos: boolean): void {
	registos.forEach((registo, indice) => {
		console.log(`\n── registo ${indice + 1}/${registos.length}${registo.id === undefined ? '' : ` (id ${registo.id})`} ──`);

		const linhas: string[][] = [];
		for (const [nome, valor] of Object.entries(registo)) {
			const tipo = campos[nome]?.type as string | undefined;
			const texto = formatarValor(valor, tipo);
			if (!todos && texto === '—') continue;
			linhas.push([nome, tipo ?? '', texto]);
		}

		if (linhas.length === 0) console.log('  (todos os campos vazios)');
		else imprimirTabela(['CAMPO', 'TIPO', 'VALOR'], linhas);
	});
}

async function listarModelos(cliente: ReturnType<typeof createOdooClient>, filtro: string, lingua: string): Promise<void> {
	const dominio: OdooDomain = filtro ? ['|', ['model', 'ilike', filtro], ['name', 'ilike', filtro]] : [];
	const modelos = await cliente.searchRead('ir.model', dominio, {
		fields: ['model', 'name', 'transient'],
		order: 'model asc',
		limit: 500,
		lang: lingua,
	});

	titulo(`Modelos${filtro ? ` que casam com '${filtro}'` : ''} (${modelos.length})`);
	if (modelos.length === 0) {
		console.log('(nenhum)');
		return;
	}
	imprimirTabela(
		['MODELO', 'NOME', ''],
		modelos.map((modelo) => [String(modelo.model), truncar(String(modelo.name), 60), modelo.transient ? 'transient' : '']),
	);
}

function uso(): void {
	console.log(`Explorador da base Odoo.

  node --experimental-strip-types scripts/explorar.ts <modelo> [opções]
  node --experimental-strip-types scripts/explorar.ts --modelos[=filtro]

Opções
  --lingua=pt_PT      língua da leitura (por omissão pt_PT; os rótulos do Odoo são traduzidos)
  --limite=N          registos na amostra (por omissão 5; 0 salta a amostra)
  --dominio=JSON      domínio Odoo, ex.: --dominio='[["state","=","done"]]'
  --campos=a,b,c      lê só estes campos na amostra
  --todos             inclui os campos não-armazenados e os valores vazios
  --json              despeja campos e amostra em JSON, para tratar com jq
  --modelos[=filtro]  lista os modelos da base, em vez de inspecionar um

Credenciais em apps/tv/.dev.vars, URL e base nas vars de apps/tv/wrangler.jsonc;
qualquer uma delas pode ser sobreposta por variável de ambiente.`);
}

// ---------------------------------------------------------------------------

async function main(): Promise<number> {
	const opcoes = analisarArgumentos(process.argv.slice(2));
	if (opcoes.modelo === null && opcoes.modelos === null) {
		uso();
		return 1;
	}

	const env = carregarEnv();
	const cliente = createOdooClient(env);

	if (opcoes.modelos !== null) {
		console.log(`Base: ${env.ODOO_DB} em ${env.ODOO_URL} — lingua ${opcoes.lingua}`);
		await listarModelos(cliente, opcoes.modelos, opcoes.lingua);
		return 0;
	}

	const modelo = opcoes.modelo as string;
	const campos = await cliente.fieldsGet(modelo, { attributes: ATRIBUTOS, lang: opcoes.lingua });
	const total = await cliente.searchCount(modelo, opcoes.dominio, { lang: opcoes.lingua });
	const registos =
		opcoes.limite > 0
			? await cliente.searchRead(modelo, opcoes.dominio, {
					fields: camposDaAmostra(campos, opcoes.campos),
					limit: opcoes.limite,
					order: 'id desc',
					lang: opcoes.lingua,
				})
			: [];

	if (opcoes.json) {
		console.log(JSON.stringify({ modelo, lingua: opcoes.lingua, total, campos, registos }, null, 2));
		return 0;
	}

	console.log(`Base: ${env.ODOO_DB} em ${env.ODOO_URL} — modelo ${modelo} — lingua ${opcoes.lingua}`);
	mostrarCampos(modelo, campos, opcoes.todos);

	titulo(`Amostra: ${registos.length} de ${total} registo(s)${opcoes.dominio.length > 0 ? ' no domínio' : ''}`);
	if (registos.length === 0) console.log('(nenhum registo)');
	else mostrarRegistos(registos, campos, opcoes.todos);

	return 0;
}

main()
	.then((codigo) => {
		process.exitCode = codigo;
	})
	.catch((erro: unknown) => {
		console.error(`\nErro: ${erro instanceof Error ? erro.message : String(erro)}`);
		if (erro instanceof Error && erro.cause !== undefined) console.error(`Causa: ${erro.cause}`);
		process.exitCode = 1;
	});
