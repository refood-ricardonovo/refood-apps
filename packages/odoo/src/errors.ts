/** Corpo `error` devolvido pelo Odoo dentro de uma resposta JSON-RPC (HTTP 200). */
export interface OdooFault {
	code?: number;
	message?: string;
	data?: {
		name?: string;
		message?: string;
		debug?: string;
		arguments?: unknown[];
	};
}

export interface OdooErrorOptions extends ErrorOptions {
	/** Código JSON-RPC devolvido pelo Odoo. */
	code?: number;
	/** Nome da excepção Python, ex. `odoo.exceptions.AccessDenied`. */
	odooName?: string;
	/** Traceback devolvido em `error.data.debug`. Útil em logs, nunca para o utilizador final. */
	debug?: string;
}

/** Erro base de qualquer falha vinda do Odoo. */
export class OdooError extends Error {
	override readonly name: string = 'OdooError';
	readonly code?: number;
	readonly odooName?: string;
	readonly debug?: string;

	constructor(message: string, options: OdooErrorOptions = {}) {
		super(message, { cause: options.cause });
		this.code = options.code;
		this.odooName = options.odooName;
		this.debug = options.debug;
	}
}

/** Credenciais recusadas ou sessão sem permissões (`AccessDenied` / `AccessError`). */
export class OdooAuthError extends OdooError {
	override readonly name = 'OdooAuthError';
}

/** O pedido nem chegou a produzir uma resposta JSON-RPC válida: rede, timeout, HTML de erro. */
export class OdooTransportError extends OdooError {
	override readonly name = 'OdooTransportError';
}

/** Validação de negócio recusada pelo Odoo (`UserError`, `ValidationError`). */
export class OdooValidationError extends OdooError {
	override readonly name = 'OdooValidationError';
}

const AUTH_FAULTS = new Set(['odoo.exceptions.AccessDenied', 'odoo.exceptions.AccessError']);
const VALIDATION_FAULTS = new Set(['odoo.exceptions.UserError', 'odoo.exceptions.ValidationError', 'odoo.exceptions.RedirectWarning']);

/**
 * Converte o `error` de uma resposta JSON-RPC na subclasse de {@link OdooError} adequada.
 *
 * O Odoo responde sempre HTTP 200; a distinção entre "correu bem" e "rebentou" está
 * exclusivamente na presença deste objecto, e o tipo real da excepção vem em `data.name`.
 */
export function faultToError(fault: OdooFault): OdooError {
	const odooName = fault.data?.name;
	const message = fault.data?.message?.trim() || fault.message || 'Erro desconhecido devolvido pelo Odoo';
	const options: OdooErrorOptions = { code: fault.code, odooName, debug: fault.data?.debug };

	if (odooName && AUTH_FAULTS.has(odooName)) {
		return new OdooAuthError(message, options);
	}
	if (odooName && VALIDATION_FAULTS.has(odooName)) {
		return new OdooValidationError(message, options);
	}
	return new OdooError(message, options);
}
