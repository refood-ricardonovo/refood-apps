import { describe, expect, it } from 'vitest';
import { entradaAberta, rotaEstado } from '../src/interruptor';

const envCom = (valor?: string) => ({ ENTRADA_ABERTA: valor }) as unknown as Env;

describe('o interruptor', () => {
	/**
	 * **Fecha por omissão, e só um valor exacto abre.** Uma configuração que não carrega nunca pode
	 * ser a coisa que abre a porta — a mesma regra do `ADMIN_SECRET` do `apps/tv`. É também o que
	 * permite implantar em produção sem segredo nenhum e servir a página certa.
	 */
	it('só abre com o valor exacto', () => {
		expect(entradaAberta(envCom('aberta'))).toBe(true);
	});

	it('fecha com o segredo ausente, vazio, ou com outro valor qualquer', () => {
		expect(entradaAberta(envCom(undefined))).toBe(false);
		expect(entradaAberta(envCom(''))).toBe(false);
		expect(entradaAberta(envCom('sim'))).toBe(false);
		expect(entradaAberta(envCom('true'))).toBe(false);
		expect(entradaAberta(envCom('Aberta'))).toBe(false);
		expect(entradaAberta(envCom(' aberta '))).toBe(false);
	});
});

describe('GET /api/estado', () => {
	/**
	 * **Publica um bit, e só esse.** *A porta está aberta.* Não diz quantas pessoas entraram, nem que
	 * núcleos estão na sala, nem nada sobre pessoa nenhuma — é isso que torna aceitável tornar
	 * público um estado que, antes de a página de entrada ter duas versões, se guardava.
	 */
	it('diz se está aberta, e mais nada', async () => {
		const corpo = (await rotaEstado(envCom('aberta')).json()) as Record<string, unknown>;

		expect(corpo).toEqual({ ok: true, aberta: true });
		expect(Object.keys(corpo).sort()).toEqual(['aberta', 'ok']);
	});

	it('fechada, diz que está fechada', async () => {
		const corpo = (await rotaEstado(envCom(undefined)).json()) as { aberta: boolean };
		expect(corpo.aberta).toBe(false);
	});
});
