/**
 * A ligação ao Odoo desta app, e o âmbito com que ela lê.
 *
 * ## Esta app lê fora de um núcleo, e é a segunda do projecto a fazê-lo
 *
 * A regra da raiz diz que o `company_id` vem do sujeito autenticado e nunca de um parâmetro do
 * pedido — **sempre que esse sujeito exista.** Aqui não existe: o NIF que a pessoa escreve é a
 * entrada, não a credencial, e a pergunta que a rota faz é precisamente *«de que núcleo é esta
 * ficha?»*. Não há núcleo de onde partir, portanto procura-se em todos.
 *
 * É a mesma forma da aprovação de emparelhamento da sede, em `apps/tv` — a outra rota do projecto
 * sem sujeito — e, como ela, só se aguenta por estar cercada. As cercas desta estão em `entrar.ts`
 * e no `CLAUDE.md` desta app: o interruptor que a abre e fecha, e o facto de sair com o atalho.
 *
 * ## A lista de empresas vem do utilizador, nunca de `res.company`
 *
 * `allowed_company_ids` sai do `company_ids` do próprio utilizador de integração, lido de
 * `res.users`. Em staging a base tem 87 empresas e o utilizador tem 84: pedir uma das três de fora
 * devolve `AccessError` e rebenta o pedido inteiro, mesmo com as outras 84 certas. Uma lista que
 * saísse de `res.company` oferecia o que a app não consegue ler. Ver o `CLAUDE.md` da raiz.
 *
 * **Falha fechada**: sem utilizador, sem lista; com `company_ids` vazio, lista vazia. A tentação é
 * o contrário — "então mostra tudo" —, e é o bug.
 */

import { createOdooClient, type OdooClient } from '@refood/odoo';

/** A língua com que esta app lê o Odoo. Sem `lang` o Odoo lê `en_US` e nada na resposta o diz. */
export const LINGUA = 'pt_PT';

/** Quanto tempo se guarda a lista de núcleos. É catálogo: muda quando alguém cria uma empresa. */
const CACHE_NUCLEOS_S = 600;
const CHAVE_NUCLEOS = 'https://refood-app.interno/cache/nucleos';

const LIMITE_EMPRESAS = 200;

/**
 * `type` e não `interface`, e os campos sem `readonly`: o `searchRead` exige um `OdooRecord`, que é
 * um `Record<string, unknown>`, e uma interface não o satisfaz. Mesma razão que está no `nucleo.ts`
 * do `apps/tv`.
 */
type NucleoOdoo = { id: number; name: string };
type UtilizadorOdoo = { id: number; company_ids: number[] };

/**
 * As empresas que o utilizador de integração consegue mesmo ler.
 *
 * Não leva cache própria: é uma leitura pequena e o que se guarda é o resultado do
 * {@link lerNucleos}, que a inclui.
 */
export async function empresasPermitidas(cliente: OdooClient, login: string): Promise<number[]> {
	const [utilizador] = await cliente.searchRead<UtilizadorOdoo>('res.users', [['login', '=', login]], {
		fields: ['company_ids'],
		limit: 1,
		lang: LINGUA,
	});

	// Sem utilizador não se inventa uma lista: quem não é lido não lê.
	return utilizador?.company_ids ?? [];
}

/**
 * Os núcleos, pelo id e pelo nome, restritos ao que o utilizador consegue ler.
 *
 * O `res.company` é lido **para os ids que já saíram do `company_ids`** — a lista não nasce daqui,
 * só ganha nomes aqui. É a mesma distinção que o `listarNucleos` da sede faz.
 *
 * Cache partilhada por todos os pedidos deste POP: são nomes de empresas, e o mural pede-os de
 * cinco em cinco segundos.
 */
export async function lerNucleos(cliente: OdooClient, empresas: readonly number[]): Promise<Map<number, string>> {
	if (empresas.length === 0) return new Map();

	const cache = typeof caches !== 'undefined' ? caches.default : null;
	const chave = new Request(CHAVE_NUCLEOS);

	const guardada = await cache?.match(chave);
	if (guardada) return new Map(await guardada.json<[number, string][]>());

	const linhas = await cliente.searchRead<NucleoOdoo>('res.company', [['id', 'in', [...empresas]]], {
		fields: ['name'],
		limit: LIMITE_EMPRESAS,
		lang: LINGUA,
	});

	const porId: [number, string][] = linhas.map((n) => [n.id, n.name]);
	await cache?.put(chave, Response.json(porId, { headers: { 'cache-control': `max-age=${CACHE_NUCLEOS_S}` } }));

	return new Map(porId);
}

/** O cliente e o âmbito, juntos, porque nenhuma leitura desta app deve acontecer sem os dois. */
export interface LigacaoOdoo {
	readonly cliente: OdooClient;
	/** Para o `allowed_company_ids` de cada leitura. Vazio quer dizer "não lê nada", e não "lê tudo". */
	readonly empresas: readonly number[];
	readonly nucleos: ReadonlyMap<number, string>;
}

export async function ligarAoOdoo(env: Env): Promise<LigacaoOdoo> {
	const cliente = createOdooClient(env);
	const empresas = await empresasPermitidas(cliente, env.ODOO_USERNAME ?? '');
	const nucleos = await lerNucleos(cliente, empresas);

	return { cliente, empresas, nucleos };
}
