import { OdooClient } from './client';
import type { OdooConfig } from './types';

export { OdooClient } from './client';
export { OdooError, OdooAuthError, OdooTransportError, OdooValidationError, faultToError } from './errors';
export type { OdooFault, OdooErrorOptions } from './errors';
export type {
	JsonRpcResponse,
	OdooConfig,
	OdooContext,
	OdooDomain,
	OdooDomainCondition,
	OdooDomainOperator,
	OdooMany2One,
	OdooRecord,
	OdooSearchOptions,
	OdooService,
} from './types';

/** Variáveis que o cliente lê do `Env` do Worker. URL e DB vêm de `vars`, as credenciais de secrets. */
export interface OdooEnv {
	ODOO_URL: string;
	ODOO_DB: string;
	ODOO_USERNAME: string;
	ODOO_PASSWORD: string;
}

/**
 * Constrói um {@link OdooClient} a partir do `Env` do Worker.
 *
 * Cria uma instância por pedido: o `Env` só existe dentro do `fetch`, e o custo é nulo —
 * a autenticação só acontece na primeira chamada RPC que a instância fizer.
 */
export function createOdooClient(env: Partial<OdooEnv>, overrides: Partial<OdooConfig> = {}): OdooClient {
	const missing = (['ODOO_URL', 'ODOO_DB', 'ODOO_USERNAME', 'ODOO_PASSWORD'] as const).filter((key) => !env[key]);
	if (missing.length > 0) {
		throw new TypeError(`Odoo: variáveis em falta no Env: ${missing.join(', ')}. Define-as em .dev.vars ou com 'wrangler secret put'.`);
	}

	return new OdooClient({
		url: env.ODOO_URL as string,
		db: env.ODOO_DB as string,
		username: env.ODOO_USERNAME as string,
		password: env.ODOO_PASSWORD as string,
		...overrides,
	});
}
