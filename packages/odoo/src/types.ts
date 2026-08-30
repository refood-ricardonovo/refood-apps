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

export interface OdooSearchOptions {
	fields?: readonly string[];
	limit?: number;
	offset?: number;
	/** Ex.: `'create_date desc, name asc'`. */
	order?: string;
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
	/** Contexto aplicado a todas as chamadas; sobreponível por chamada. */
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
