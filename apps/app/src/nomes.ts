/**
 * Os nomes como saem daqui para um ecrã, e nunca mais do que isso.
 *
 * **Duas formas, e a diferença é de superfície.** O ecrã de entrada é o telemóvel de quem acabou de
 * escrever o seu próprio NIF, e ali um primeiro nome com a inicial do apelido confirma que a app
 * encontrou a pessoa certa. O mural é um projector numa sala com gente que não é dali: leva **só o
 * primeiro nome**.
 *
 * **Deriva-se do `full_name`, não do `name`.** O `name` da ficha não vem abreviado — a regra da raiz
 * di-lo, e o levantamento mostra porquê: em muitos registos antigos o `name` traz o nome completo na
 * mesma. O `full_name` está vazio em cerca de 430 fichas activas, e por isso há recurso ao `name`;
 * o que não há é assumir que qualquer um dos dois já vem curto.
 */

/** As partículas que não são apelido e que, sozinhas, não identificam ninguém. */
const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'du', 'del', 'della', 'van', 'von', 'la', 'le', 'di']);

/** As palavras de um nome, com o espaço colapsado. Há fichas com espaço duplo e com espaço nas pontas. */
function palavras(valor: unknown): string[] {
	if (typeof valor !== 'string') return [];
	return valor.trim().split(/\s+/).filter(Boolean);
}

/**
 * O primeiro nome, e mais nada. É o que vai para o mural.
 *
 * `null` quando não há nome nenhum de que o tirar — e um cartão sem nome é melhor do que um cartão
 * com o nome errado.
 */
export function primeiroNome(fullName: unknown, name?: unknown): string | null {
	const partes = palavras(fullName);
	const usadas = partes.length > 0 ? partes : palavras(name);
	return usadas[0] ?? null;
}

/**
 * Primeiro nome e inicial do apelido — `Maria F.` — para o ecrã de quem se acabou de identificar.
 *
 * **A inicial sai do último apelido, saltando as partículas.** *Maria Fernanda da Costa* dá
 * `Maria C.` e não `Maria d.`, que não diria nada. Um nome de uma palavra só fica na palavra: não se
 * inventa uma inicial que não existe.
 */
export function nomeCurto(fullName: unknown, name?: unknown): string | null {
	const partes = palavras(fullName);
	const usadas = partes.length > 0 ? partes : palavras(name);

	const primeiro = usadas[0];
	if (primeiro === undefined) return null;

	for (let i = usadas.length - 1; i >= 1; i--) {
		const candidata = usadas[i] as string;
		if (PARTICULAS.has(candidata.toLowerCase())) continue;
		return `${primeiro} ${candidata.charAt(0).toUpperCase()}.`;
	}

	return primeiro;
}
