/**
 * Consultas sobre os dispositivos emparelhados.
 *
 * Por agora só a numeração dos ecrãs de um núcleo, que é o que dá nome a um dispositivo sem
 * guardar texto livre no D1: o núcleo resolve-se contra o Odoo na altura de mostrar, e o número
 * sai daqui.
 */

import { deviceOrdinals, type LinhaDispositivo } from './auth';

export interface EnvDispositivos {
	DB: D1Database;
}

/**
 * As linhas de um núcleo para efeitos de numeração.
 *
 * **Sem `revogado = 0`, e isto não é esquecimento.** O ordinal é a ordem de emparelhamento dentro
 * do núcleo, contada sobre todas as linhas: esconder as revogadas puxa para trás os números de
 * todos os ecrãs que vieram depois, e um número de ecrã que muda sozinho — porque alguém revogou
 * um ecrã diferente, noutra sala — é pior do que não ter número nenhum. Os buracos ficam, e um
 * buraco é informação: ali houve uma revogação.
 *
 * O `idx_dispositivos_empresa` é parcial em `revogado = 0` e por isso **não serve esta query** —
 * e é essa a armadilha, porque acrescentar o filtro que faria o índice encaixar é precisamente o
 * bug. São dezenas de linhas por núcleo; a varredura é irrelevante e o índice não faz falta.
 *
 * A ordenação vem do SQL para que a lista chegue ao módulo já estável, mas quem numera é o
 * `deviceOrdinals` — aqui não se conta nada à mão.
 */
export async function linhasDoNucleo(db: D1Database, empresa: number): Promise<LinhaDispositivo[]> {
	const { results } = await db
		.prepare('SELECT id, company_id, criado_em FROM dispositivos WHERE company_id = ? ORDER BY criado_em ASC, id ASC')
		.bind(empresa)
		.all<LinhaDispositivo>();

	return results;
}

/**
 * O número de cada ecrã do núcleo, pela ordem em que foram emparelhados.
 *
 * `empresa` vem do token ou da sessão de quem chama. Nunca de um parâmetro do pedido.
 */
export async function ordinaisDoNucleo(db: D1Database, empresa: number): Promise<Map<string, number>> {
	return deviceOrdinals(await linhasDoNucleo(db, empresa), empresa);
}
