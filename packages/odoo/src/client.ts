import { OdooAuthError, OdooTransportError, faultToError } from './errors';
import type { JsonRpcResponse, OdooConfig, OdooContext, OdooDomain, OdooReadGroupOptions, OdooRecord, OdooSearchOptions, OdooService } from './types';

const JSONRPC_PATH = '/jsonrpc';
const DEFAULT_TIMEOUT_MS = 15_000;

let requestId = 0;

/**
 * Cliente JSON-RPC do Odoo, escrito contra APIs standard da Web (`fetch`, `AbortSignal`)
 * para correr dentro de um Worker da Cloudflare.
 *
 * O protocolo é stateless: cada chamada a `object.execute_kw` reenvia db + uid + password.
 * O `uid` é obtido uma vez via `common.authenticate` e reutilizado enquanto a instância viver
 * (o isolate do Worker), poupando um round-trip por pedido.
 *
 * **Não existe atalho para `unlink` — de propósito.** As apps não apagam registos no Odoo, e um
 * método público seria fácil de ligar a uma rota por acidente. Se algum dia for mesmo preciso,
 * `call(model, 'unlink', [ids])` continua a funcionar: a omissão é para obrigar a decidir, não
 * para bloquear.
 */
export class OdooClient {
	private readonly endpoint: string;
	private readonly db: string;
	private readonly username: string;
	private readonly password: string;
	private readonly context: OdooContext;
	private readonly timeoutMs: number;
	private readonly fetchImpl: typeof fetch;

	/** Promessa do uid em curso ou já resolvida. Partilhada para não autenticar N vezes em paralelo. */
	private uid: Promise<number> | null = null;

	constructor(config: OdooConfig) {
		const missing = (['url', 'db', 'username', 'password'] as const).filter((key) => !config[key]);
		if (missing.length > 0) {
			throw new TypeError(`OdooClient: configuração incompleta, falta ${missing.join(', ')}`);
		}

		this.endpoint = `${config.url.replace(/\/+$/, '')}${JSONRPC_PATH}`;
		this.db = config.db;
		this.username = config.username;
		this.password = config.password;
		this.context = config.context ?? {};
		this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
	}

	/**
	 * Chamada JSON-RPC crua. Só é precisa para serviços/métodos sem atalho neste cliente;
	 * para operações sobre modelos usa {@link call} ou os métodos de conveniência.
	 */
	async rpc<T>(service: OdooService, method: string, args: readonly unknown[]): Promise<T> {
		const body = JSON.stringify({
			jsonrpc: '2.0',
			method: 'call',
			id: ++requestId,
			params: { service, method, args },
		});

		let response: Response;
		try {
			response = await this.fetchImpl(this.endpoint, {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: 'application/json' },
				body,
				signal: AbortSignal.timeout(this.timeoutMs),
			});
		} catch (cause) {
			const timedOut = cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
			const detalhe = timedOut ? `excedeu ${this.timeoutMs}ms` : 'falha de rede';
			throw new OdooTransportError(`Pedido a ${this.endpoint} ${detalhe}`, { cause });
		}

		if (!response.ok) {
			throw new OdooTransportError(`Odoo respondeu HTTP ${response.status} em ${this.endpoint}`, { code: response.status });
		}

		let payload: JsonRpcResponse<T>;
		try {
			payload = (await response.json()) as JsonRpcResponse<T>;
		} catch (cause) {
			// Tipicamente uma página de erro HTML de um proxy à frente do Odoo.
			throw new OdooTransportError(`Resposta de ${this.endpoint} não é JSON válido`, { cause });
		}

		if (payload.error) {
			throw faultToError(payload.error);
		}
		return payload.result as T;
	}

	/** Devolve o uid autenticado, autenticando na primeira utilização. */
	async authenticate(): Promise<number> {
		this.uid ??= this.requestUid();
		try {
			return await this.uid;
		} catch (error) {
			this.uid = null; // não deixar uma promessa rejeitada em cache
			throw error;
		}
	}

	private async requestUid(): Promise<number> {
		// `authenticate` devolve `false` — e não um erro JSON-RPC — quando as credenciais falham.
		const uid = await this.rpc<number | false>('common', 'authenticate', [this.db, this.username, this.password, {}]);
		if (typeof uid !== 'number' || uid === 0) {
			throw new OdooAuthError(`Odoo recusou as credenciais de '${this.username}' na base '${this.db}'`);
		}
		return uid;
	}

	/** Esquece o uid em cache; a próxima chamada volta a autenticar. */
	resetSession(): void {
		this.uid = null;
	}

	/**
	 * Invoca `method` no `model` via `object.execute_kw`.
	 * Se o uid em cache tiver deixado de ser válido, reautentica e tenta uma segunda vez.
	 */
	async call<T>(model: string, method: string, args: readonly unknown[] = [], kwargs: Record<string, unknown> = {}): Promise<T> {
		const params = { ...kwargs, context: { ...this.context, ...(kwargs.context as OdooContext | undefined) } };
		const uid = await this.authenticate();

		try {
			return await this.rpc<T>('object', 'execute_kw', [this.db, uid, this.password, model, method, args, params]);
		} catch (error) {
			if (!(error instanceof OdooAuthError)) throw error;

			this.resetSession();
			const freshUid = await this.authenticate();
			// Mesmo uid: o problema é de permissões, não de sessão obsoleta. Repetir só duplicaria o erro.
			if (freshUid === uid) throw error;

			return await this.rpc<T>('object', 'execute_kw', [this.db, freshUid, this.password, model, method, args, params]);
		}
	}

	/** Versão do servidor. Não requer autenticação — bom para health checks. */
	version(): Promise<Record<string, unknown>> {
		return this.rpc('common', 'version', []);
	}

	/** Ids que correspondem ao domínio. */
	search(model: string, domain: OdooDomain = [], options: Omit<OdooSearchOptions, 'fields'> = {}): Promise<number[]> {
		return this.call<number[]>(model, 'search', [domain], searchKwargs(options));
	}

	/** Registos que correspondem ao domínio, numa só chamada. */
	searchRead<T extends OdooRecord = OdooRecord>(model: string, domain: OdooDomain = [], options: OdooSearchOptions = {}): Promise<T[]> {
		return this.call<T[]>(model, 'search_read', [domain], searchKwargs(options));
	}

	/** Número de registos que correspondem ao domínio. */
	searchCount(model: string, domain: OdooDomain = [], options: Pick<OdooSearchOptions, 'context'> = {}): Promise<number> {
		return this.call<number>(model, 'search_count', [domain], searchKwargs(options));
	}

	/** Lê campos de ids conhecidos. */
	read<T extends OdooRecord = OdooRecord>(
		model: string,
		ids: readonly number[],
		fields: readonly string[] = [],
		options: Pick<OdooSearchOptions, 'context'> = {},
	): Promise<T[]> {
		return this.call<T[]>(model, 'read', [ids, fields], searchKwargs(options));
	}

	/** Cria um registo e devolve o seu id. */
	create(model: string, values: Record<string, unknown>, options: Pick<OdooSearchOptions, 'context'> = {}): Promise<number> {
		return this.call<number>(model, 'create', [values], searchKwargs(options));
	}

	/** Actualiza registos. O Odoo devolve `true` ou levanta excepção. */
	write(
		model: string,
		ids: readonly number[],
		values: Record<string, unknown>,
		options: Pick<OdooSearchOptions, 'context'> = {},
	): Promise<boolean> {
		return this.call<boolean>(model, 'write', [ids, values], searchKwargs(options));
	}

	/**
	 * Agrega registos com `read_group`.
	 *
	 * `fields` leva os agregados na notação do Odoo (`'id:count'`, `'quantidade:sum'`) e `groupby`
	 * os campos de agrupamento, opcionalmente com granularidade temporal (`'create_date:day'`).
	 *
	 * Cada grupo devolvido traz, além dos campos pedidos, as chaves internas do Odoo:
	 * `__domain` (domínio que isola o grupo, pronto para um drill-down), `__count` com `lazy: false`
	 * — ou `<primeiro_groupby>_count` com o `lazy: true` que o Odoo assume por omissão — e `__range`
	 * quando se agrupa por data.
	 *
	 * ```ts
	 * const porLocal = await odoo.readGroup(
	 * 	'refood.entrega',
	 * 	[['state', '=', 'done']],
	 * 	['id:count', 'quantidade:sum'],
	 * 	['local_id'],
	 * 	{ orderby: 'quantidade desc', limit: 10, lazy: false },
	 * );
	 * ```
	 */
	readGroup<T extends OdooRecord = OdooRecord>(
		model: string,
		domain: OdooDomain,
		fields: readonly string[],
		groupby: readonly string[],
		options: OdooReadGroupOptions = {},
	): Promise<T[]> {
		const kwargs: Record<string, unknown> = {};
		if (options.limit !== undefined) kwargs.limit = options.limit;
		if (options.offset !== undefined) kwargs.offset = options.offset;
		if (options.orderby !== undefined) kwargs.orderby = options.orderby;
		if (options.lazy !== undefined) kwargs.lazy = options.lazy; // `false` é significativo: não usar truthiness
		if (options.context) kwargs.context = options.context;

		return this.call<T[]>(model, 'read_group', [domain, fields, groupby], kwargs);
	}

	/** Metadados dos campos de um modelo — tipos, labels, selecções. */
	fieldsGet(
		model: string,
		attributes: readonly string[] = ['string', 'type', 'required', 'selection'],
	): Promise<Record<string, Record<string, unknown>>> {
		return this.call(model, 'fields_get', [[], attributes]);
	}
}

/** Converte as opções para os kwargs que o execute_kw espera, omitindo o que não foi pedido. */
function searchKwargs(options: OdooSearchOptions): Record<string, unknown> {
	const kwargs: Record<string, unknown> = {};
	if (options.fields) kwargs.fields = options.fields;
	if (options.limit !== undefined) kwargs.limit = options.limit;
	if (options.offset !== undefined) kwargs.offset = options.offset;
	if (options.order !== undefined) kwargs.order = options.order;
	if (options.context) kwargs.context = options.context;
	return kwargs;
}
