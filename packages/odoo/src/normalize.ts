import type { OdooMany2One } from './types';

/**
 * Conversões puras entre os valores como o Odoo os serializa e os equivalentes idiomáticos em JS.
 *
 * O Odoo usa `false` — nunca `null` — para "sem valor", em qualquer tipo de campo, e serializa
 * datas como strings sem fuso, sempre em UTC. Estas funções isolam essas duas convenções para que
 * não se espalhem pelo código de negócio.
 */

/** `YYYY-MM-DD` com `HH:MM:SS` opcional (separado por espaço ou `T`) e fracção de segundo opcional. */
const ODOO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?)?$/;

/** Descompacta um many2one `[id, display_name]`. Devolve `null` quando o campo está vazio. */
export function many2one(valor: OdooMany2One): { id: number; nome: string } | null {
	return valor === false ? null : { id: valor[0], nome: valor[1] };
}

/** Só o id de um many2one — evita o objecto intermédio quando o `display_name` não interessa. */
export function many2oneId(valor: OdooMany2One): number | null {
	return valor === false ? null : valor[0];
}

/**
 * Troca o `false` de "campo vazio" do Odoo por `null`.
 *
 * Não usar em campos booleanos: aí `false` é um valor legítimo e seria apagado.
 */
export function nullable<T>(valor: T | false): T | null {
	return valor === false ? null : (valor as T);
}

/**
 * Converte uma data do Odoo em `Date`.
 *
 * O Odoo devolve `'2026-08-29 09:14:22'` para campos datetime e `'2026-08-29'` para campos date,
 * em ambos os casos **sem indicação de fuso**. Os datetime estão sempre em UTC; os date não têm
 * hora nenhuma e são interpretados como meia-noite UTC.
 *
 * A string é parseada explicitamente em vez de passada a `new Date(...)`, porque o formato do Odoo
 * (com espaço em vez de `T`) é interpretado como **hora local** pelos motores JS — o que daria
 * desvios de horas conforme o fuso de quem corre o código.
 *
 * Devolve `null` para campo vazio ou string que não corresponda a uma data real.
 */
export function odooDate(valor: string | false): Date | null {
	if (valor === false) return null;

	const partes = ODOO_DATE.exec(valor.trim());
	if (!partes) return null;

	const [ano, mes, dia, horas, minutos, segundos] = partes.slice(1).map((p) => (p === undefined ? 0 : Number(p)));
	const data = new Date(Date.UTC(ano!, mes! - 1, dia!, horas!, minutos!, segundos!));

	// `Date.UTC` normaliza silenciosamente valores fora de gama ('2026-13-45' viraria Janeiro de 2027).
	// Confirmar que o que saiu é o que entrou distingue uma data real de uma string bem formatada mas inválida.
	const igual =
		data.getUTCFullYear() === ano &&
		data.getUTCMonth() === mes! - 1 &&
		data.getUTCDate() === dia &&
		data.getUTCHours() === horas &&
		data.getUTCMinutes() === minutos &&
		data.getUTCSeconds() === segundos;

	return igual ? data : null;
}

/**
 * Formata um `Date` como datetime do Odoo, `'2026-08-29 09:14:22'`, em UTC.
 *
 * Construído a partir dos componentes UTC em vez de `toISOString().slice(...)`, que produz um
 * formato expandido (`'+275760-09-13T...'`) para anos fora de 0000–9999 e cortaria mal.
 */
export function toOdooDate(data: Date): string {
	const ms = data.getTime();
	if (Number.isNaN(ms)) {
		throw new TypeError('toOdooDate: Date inválido');
	}

	const p2 = (n: number) => String(n).padStart(2, '0');
	const ano = String(data.getUTCFullYear()).padStart(4, '0');

	return `${ano}-${p2(data.getUTCMonth() + 1)}-${p2(data.getUTCDate())} ${p2(data.getUTCHours())}:${p2(data.getUTCMinutes())}:${p2(data.getUTCSeconds())}`;
}
