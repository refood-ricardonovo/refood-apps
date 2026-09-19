/**
 * A ligação ao Odoo partilhada pelas ferramentas de `scripts/`.
 *
 * Estava tudo dentro do `explorar.ts` e saiu para aqui quando apareceu o segundo script: o hook do
 * resolvedor, a leitura do `.dev.vars` e das `vars` do `wrangler.jsonc`, e a lista de empresas que o
 * utilizador de integração consegue mesmo ler.
 *
 * **Isto não é o caminho das apps.** Autentica com o utilizador de integração, que não está limitado
 * a núcleo nenhum, e serve para levantamentos sobre a base toda. Uma app lê sempre com o
 * `company_id` do sujeito autenticado no domínio e `allowed_company_ids` no contexto.
 */

import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * O `@refood/odoo` é distribuído como TypeScript e importa-se por dentro sem extensão (`./client`),
 * porque quem o compila é o esbuild do Wrangler. O resolvedor de ESM do Node exige a extensão, por
 * isso completa-se aqui: quando um caminho relativo não existe, tenta-se o mesmo com `.ts`.
 *
 * Fica no topo deste módulo, e é por isso que o `import` do pacote lá em baixo é dinâmico: importar
 * este ficheiro tem de deixar o hook registado antes de o pacote ser resolvido.
 */
registerHooks({
	resolve(especificador, contexto, seguinte) {
		try {
			return seguinte(especificador, contexto);
		} catch (erro) {
			if (!especificador.startsWith('.') || (erro as NodeJS.ErrnoException).code !== 'ERR_MODULE_NOT_FOUND') throw erro;
			return seguinte(`${especificador}.ts`, contexto);
		}
	},
});

export const { createOdooClient, many2one, many2oneId } = await import('@refood/odoo');

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEV_VARS = resolve(RAIZ, 'apps/tv/.dev.vars');
const WRANGLER = resolve(RAIZ, 'apps/tv/wrangler.jsonc');

/** Lê um ficheiro `CHAVE=valor` no formato do `.dev.vars`. Ficheiro ausente não é erro — pode vir tudo do ambiente. */
function lerDevVars(caminho: string): Record<string, string> {
	let conteudo: string;
	try {
		conteudo = readFileSync(caminho, 'utf8');
	} catch {
		return {};
	}

	const vars: Record<string, string> = {};
	for (const linha of conteudo.split(/\r?\n/)) {
		const limpa = linha.trim();
		if (!limpa || limpa.startsWith('#')) continue;

		const igual = limpa.indexOf('=');
		if (igual === -1) continue;

		const chave = limpa.slice(0, igual).trim();
		const valor = limpa.slice(igual + 1).trim();
		vars[chave] = valor.replace(/^(['"])([\s\S]*)\1$/, '$2');
	}
	return vars;
}

/**
 * Remove comentários de JSONC, ignorando os que estão dentro de strings — senão o `//` de
 * `"https://staging.onrefood.com"` levava metade do valor à frente.
 */
function despirJsonc(texto: string): string {
	let saida = '';
	let emString = false;
	let escapado = false;

	for (let i = 0; i < texto.length; i++) {
		const c = texto[i] as string;

		if (emString) {
			saida += c;
			if (escapado) escapado = false;
			else if (c === '\\') escapado = true;
			else if (c === '"') emString = false;
			continue;
		}

		if (c === '"') {
			emString = true;
			saida += c;
		} else if (c === '/' && texto[i + 1] === '/') {
			while (i < texto.length && texto[i] !== '\n') i++;
			saida += '\n';
		} else if (c === '/' && texto[i + 1] === '*') {
			i += 2;
			while (i < texto.length && !(texto[i] === '*' && texto[i + 1] === '/')) i++;
			i++;
		} else {
			saida += c;
		}
	}
	return saida;
}

/** `ODOO_URL` e `ODOO_DB` vivem nas `vars` do wrangler.jsonc; só as credenciais é que são secrets. */
function lerVarsWrangler(caminho: string): Record<string, string> {
	try {
		const config = JSON.parse(despirJsonc(readFileSync(caminho, 'utf8'))) as { vars?: Record<string, string> };
		return config.vars ?? {};
	} catch {
		return {};
	}
}

/** Ambiente para o cliente, por precedência crescente: wrangler.jsonc, .dev.vars, variáveis de ambiente. */
export function carregarEnv(): Record<string, string | undefined> {
	const doAmbiente: Record<string, string> = {};
	for (const chave of ['ODOO_URL', 'ODOO_DB', 'ODOO_USERNAME', 'ODOO_PASSWORD'] as const) {
		const valor = process.env[chave];
		if (valor) doAmbiente[chave] = valor;
	}
	return { ...lerVarsWrangler(WRANGLER), ...lerDevVars(DEV_VARS), ...doAmbiente };
}

/**
 * As empresas que este utilizador consegue **mesmo** ler, para pôr em `allowed_company_ids`.
 *
 * **Sai do `company_ids` do próprio utilizador, nunca de uma leitura de `res.company`.** Em staging
 * a base tem 87 empresas e o utilizador tem 84; pedir uma das três de fora devolve
 * `AccessError: Access to unauthorized or invalid companies` e leva o levantamento inteiro com ela.
 * É a mesma regra das apps, e vale aqui pela mesma razão.
 *
 * E é preciso para mais do que os modelos que a documentação já marca: **qualquer domínio que
 * atravesse para a `res.beneficiary` ou a `res.food.source`** — um `beneficiary_id.active`, por
 * exemplo — passa pelas regras desses modelos e devolve zero sem isto. Zero que se lê como "não há",
 * que é a pior forma de um levantamento estar errado.
 */
export async function empresasLegiveis(cliente: ReturnType<typeof createOdooClient>, lingua: string): Promise<number[]> {
	const uid = await cliente.authenticate();
	const [utilizador] = await cliente.read<{ company_ids: number[] }>('res.users', [uid], ['company_ids'], { lang: lingua });

	const empresas = utilizador?.company_ids ?? [];
	if (empresas.length === 0) throw new Error('O utilizador de integração não tem company_ids. Sem isso não há levantamento possível.');

	return empresas;
}
