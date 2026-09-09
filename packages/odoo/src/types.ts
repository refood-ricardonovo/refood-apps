/** Serviços JSON-RPC expostos em `/jsonrpc`. */
export type OdooService = 'common' | 'object' | 'db';

/** Operadores prefixos de um domínio Odoo (notação polaca). */
export type OdooDomainOperator = '&' | '|' | '!';

/** Condição `[campo, operador, valor]`. */
export type OdooDomainCondition = readonly [field: string, operator: string, value: unknown];

/**
 * Domínio de pesquisa Odoo, ex.: `[['active', '=', true], ['name', 'ilike', 'refood']]`.
 * Sem operador explícito os termos são combinados com `&`.
 */
export type OdooDomain = ReadonlyArray<OdooDomainCondition | OdooDomainOperator>;

/** Contexto Odoo (`lang`, `tz`, flags de negócio, ...). */
export type OdooContext = Record<string, unknown>;

/** Registo devolvido pelo Odoo. `id` está sempre presente salvo se excluído dos `fields`. */
export type OdooRecord = Record<string, unknown> & { id?: number };

/**
 * Campo many2one: `[id, display_name]` quando preenchido, `false` quando vazio.
 * O Odoo usa `false` — não `null` — para qualquer campo sem valor.
 */
export type OdooMany2One = readonly [id: number, displayName: string] | false;

/**
 * A língua de uma leitura, e é **obrigatória em todas**.
 *
 * ## Porque é parâmetro e não configuração do cliente
 *
 * A língua não é propriedade do cliente — é propriedade de **quem pede**, e entra no contexto de
 * cada chamada, tal como o `allowed_company_ids`. O cliente é partilhado pelo isolate do Worker
 * (para não reautenticar em cada pedido), portanto uma língua fixada na construção passaria a ser
 * propriedade do *processo*: indiferente na TV, que é sempre `pt_PT`, e errado na PWA, onde podem
 * estar dois voluntários de línguas diferentes servidos pelo mesmo isolate ao mesmo tempo.
 *
 * ## Porque é obrigatória
 *
 * Sem `lang` no contexto o Odoo **não usa a língua do utilizador** — cai no `en_US`. Não é uma
 * omissão que se note: os valores vêm todos, plausíveis, e traduzidos para a língua errada. Medido
 * em staging, o produto 37 chama-se *Sem excedente* em `pt_PT` e *Falta Justificada (cópia)* em
 * `en_US` — nomes sem relação nenhuma, para o mesmo registo.
 *
 * Sendo exigida pelo compilador, não há rotas que se lembrem e outras que se esqueçam. É a mesma
 * escolha que faz `fields` e `limit` obrigatórios no leitor da TV.
 */
export interface OdooLangOptions {
	/** Código de língua Odoo — `'pt_PT'`, `'en_US'`. Vai no `lang` do contexto da chamada. */
	lang: string;
}

/** Opções de uma chamada que só leva contexto (`read`, `search_count`, `create`, `write`). */
export interface OdooCallOptions extends OdooLangOptions {
	/** Contexto adicional. **Não pode conter `lang`** — para isso existe o campo próprio. */
	context?: OdooContext;
}

export interface OdooSearchOptions extends OdooCallOptions {
	fields?: readonly string[];
	limit?: number;
	offset?: number;
	/** Ex.: `'create_date desc, name asc'`. */
	order?: string;
}

export interface OdooFieldsGetOptions extends OdooCallOptions {
	/** Atributos pedidos por campo. Por omissão `string`, `type`, `required`, `selection`. */
	attributes?: readonly string[];
}

export interface OdooReadGroupOptions extends OdooLangOptions {
	limit?: number;
	offset?: number;
	/** Ex.: `'quantidade desc'`. Atenção: o `read_group` usa `orderby`, não `order`. */
	orderby?: string;
	/**
	 * Por omissão o Odoo usa `true`, e nesse modo **só agrupa pelo primeiro `groupby`** —
	 * os restantes ficam por expandir e a contagem vem em `<primeiro_groupby>_count`.
	 * Para agrupar por todos os campos de uma vez, passa `false`.
	 */
	lazy?: boolean;
	/** Contexto adicional. **Não pode conter `lang`** — para isso existe o campo próprio. */
	context?: OdooContext;
}

export interface OdooConfig {
	/** URL base da instância, sem `/jsonrpc`. Ex.: `https://odoo.myrefood.pt`. */
	url: string;
	/** Nome da base de dados Odoo. */
	db: string;
	/** Login do utilizador de integração. */
	username: string;
	/** Password ou API key desse utilizador. */
	password: string;
	/**
	 * Contexto aplicado a todas as chamadas; sobreponível por chamada.
	 *
	 * **Não aceita `lang`** — o construtor rejeita-o. A língua é de quem pede, não do cliente: ver
	 * {@link OdooLangOptions}. `tz` e flags de negócio, sim.
	 */
	context?: OdooContext;
	/** Timeout por pedido, em milissegundos. Por omissão 15000. */
	timeoutMs?: number;
	/** `fetch` alternativo — útil em testes. Por omissão o global. */
	fetch?: typeof fetch;
}

/** Envelope de uma resposta JSON-RPC 2.0. */
export interface JsonRpcResponse<T> {
	jsonrpc?: string;
	id?: number | string | null;
	result?: T;
	error?: import('./errors').OdooFault;
}
