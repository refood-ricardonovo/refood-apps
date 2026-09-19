/**
 * Os painéis que um televisor sabe mostrar.
 *
 * Existe para haver **um sítio** onde a lista está escrita do lado do Worker: a rota do admin
 * valida contra ela antes de guardar um `painel_inicial`, e nada mais precisa de a conhecer.
 *
 * **Há uma segunda cópia, no `public/painel.html`, e é assumida.** Os assets são servidos
 * estáticos, sem passo de compilação que pudesse importar este módulo — é a mesma razão pela qual
 * o `index.html` repete o SHA-256 do `auth.ts`. A cópia lá chama-se `AREAS`, e o
 * `test/paineis.test.ts` compara as duas: se alguém acrescentar um painel de um lado só, fica
 * vermelho em vez de ficar meio feito.
 *
 * ## Acrescentar um painel
 *
 * 1. a chave entra aqui;
 * 2. entra no `AREAS` do `painel.html`, com o caminho e os rótulos;
 * 3. a rota de dados entra no `TV` do `index.ts`.
 *
 * Não há migração para fazer: o `painel_inicial` é `TEXT` sem `CHECK`, de propósito. Um `CHECK`
 * punha o passo 0 desta lista numa alteração de esquema, e o que se ganhava — recusar um valor que
 * a rota do admin já recusa — não paga o que se perdia.
 */

/**
 * As chaves, pela ordem em que aparecem ao escolher.
 *
 * São as mesmas que as rotas de dados: `/api/entregas`, `/api/recolhas`. A igualdade não é
 * imposta por nada — é o `index.ts` que mapeia caminhos a funções —, mas mantê-la poupa uma tabela
 * de tradução a quem vier a seguir.
 */
export const PAINEIS = ['entregas', 'recolhas'] as const;

export type Painel = (typeof PAINEIS)[number];

/**
 * Com que painel arranca um ecrã que não tenha escolha guardada.
 *
 * As entregas, porque são o painel de todos os núcleos: há núcleos sem recolhas nenhumas, e nunca
 * um com recolhas e sem entregas.
 */
export const PAINEL_POR_OMISSAO: Painel = 'entregas';

/**
 * Valida o que vem do admin. `null` limpa a escolha e volta ao painel por omissão.
 *
 * Devolve `undefined` para o que não reconhece, que quem chama distingue de `null` — um é "tira a
 * escolha", o outro é "isto não é um painel".
 */
export function painelValido(valor: unknown): Painel | null | undefined {
	if (valor === null) return null;
	return typeof valor === 'string' && (PAINEIS as readonly string[]).includes(valor) ? (valor as Painel) : undefined;
}
