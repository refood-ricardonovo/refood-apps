/**
 * A ligação ao Odoo desta app, e por que razão ela não leva âmbito.
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
 * ## Não se constrói `allowed_company_ids`, e o tecto não desapareceu por isso
 *
 * Havia aqui uma lista de empresas permitidas, lida do `company_ids` do utilizador de integração, e
 * ia no contexto de cada leitura. **Saiu**, porque nesta app ela não protegia nada e escondia
 * fichas: o núcleo do voluntário é o `company_id` da ficha dele, e uma rota que existe para o
 * descobrir não pode restringir-se a uma lista antes de o conhecer.
 *
 * **O tecto continua a existir, e é do Odoo, não nosso.** As `ir.rule` de multi-empresa avaliam
 * contra o `company_ids` da conta autenticada, e um `allowed_company_ids` no contexto só podia
 * **estreitar** dentro dele — nunca alargar. Consequência prática, e vale a pena tê-la escrita: uma
 * ficha num núcleo que a conta não tem responde exactamente como uma ficha que não existe. Se a
 * demonstração não encontrar gente de um núcleo inteiro, o que falta é esse núcleo na conta — e é a
 * dívida do `apps@re-food.org`, não uma linha de código.
 *
 * **Nada disto vale para a app da TV**, onde há token, há um núcleo, e a regra da raiz aplica-se
 * inteira: domínio com `company_id` **e** `allowed_company_ids` no contexto.
 */

import { type OdooClient } from '@refood/odoo';

/** A língua com que esta app lê o Odoo. Sem `lang` o Odoo lê `en_US` e nada na resposta o diz. */
export const LINGUA = 'pt_PT';

/** Quanto tempo se guardam os nomes dos núcleos. É catálogo: muda quando alguém cria uma empresa. */
const CACHE_NUCLEOS_S = 600;

const LIMITE_EMPRESAS = 200;

/**
 * `type` e não `interface`, e os campos sem `readonly`: o `searchRead` exige um `OdooRecord`, que é
 * um `Record<string, unknown>`, e uma interface não o satisfaz. Mesma razão que está no `nucleo.ts`
 * do `apps/tv`.
 */
type NucleoOdoo = { id: number; name: string };

/**
 * Os nomes dos núcleos, para ids que **já são nossos**.
 *
 * Quem chama passa os `company_id` que saíram das fichas gravadas no D1: a lista não nasce de uma
 * leitura de `res.company`, só ganha nomes aqui. É a distinção que a regra da raiz faz — o que ela
 * proíbe é **oferecer** um núcleo saído de `res.company`, não pôr um nome num id que já se tem.
 *
 * Cache partilhada por todos os pedidos deste POP, com os ids na chave: o mural pede isto de cinco
 * em cinco segundos e a resposta só muda quando aparece um núcleo novo na sala.
 */
export async function nomesDosNucleos(cliente: OdooClient, ids: readonly number[]): Promise<Map<number, string>> {
	if (ids.length === 0) return new Map();

	const unicos = [...new Set(ids)].sort((a, b) => a - b);

	const cache = typeof caches !== 'undefined' ? caches.default : null;
	const chave = new Request(`https://refood-app.interno/cache/nucleos?ids=${unicos.join(',')}`);

	const guardada = await cache?.match(chave);
	if (guardada) return new Map(await guardada.json<[number, string][]>());

	const linhas = await cliente.searchRead<NucleoOdoo>('res.company', [['id', 'in', unicos]], {
		fields: ['name'],
		limit: LIMITE_EMPRESAS,
		lang: LINGUA,
	});

	const porId: [number, string][] = linhas.map((n) => [n.id, n.name]);
	await cache?.put(chave, Response.json(porId, { headers: { 'cache-control': `max-age=${CACHE_NUCLEOS_S}` } }));

	return new Map(porId);
}
