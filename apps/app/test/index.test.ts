import { describe, expect, it } from 'vitest';
import worker from '../src/index';

/**
 * **O `fetch` recebe só o pedido, e o teste chama-o assim.**
 *
 * O `Env` desta app está vazio — sem Odoo, sem D1, sem KV — e o Worker não declara o parâmetro que
 * não usa. Não é economia de escrita: no dia em que houver uma ligação, o `env` entra na assinatura
 * e **este ficheiro deixa de compilar**, que é o sítio certo para se dar por isso. Um teste que
 * passasse um `{} as Env` a mais aceitava a mudança em silêncio.
 */
const pedir = (caminho: string, metodo = 'GET') =>
	worker.fetch(new Request(`https://app-staging.myrefood.pt${caminho}`, { method: metodo }));

describe('o Worker da PWA', () => {
	it('responde à sonda de saúde, e só com a hora', async () => {
		const resposta = await pedir('/api/health');
		expect(resposta.status).toBe(200);

		const corpo = (await resposta.json()) as { ok: boolean; agora: string };
		expect(corpo.ok).toBe(true);
		expect(Date.parse(corpo.agora)).not.toBeNaN();

		/*
		 * **Nada que descreva o que está por trás.** É o único ponto aberto, chamável por uma sonda
		 * externa, e a tentação de lhe pendurar a versão ou o estado das ligações é exactamente o
		 * que este teste existe para travar — foi a rota `/api/teste` da TV que ensinou isso.
		 */
		expect(Object.keys(corpo).sort()).toEqual(['agora', 'ok']);
	});

	it('recusa o método errado na saúde, e diz qual é', async () => {
		const resposta = await pedir('/api/health', 'POST');
		expect(resposta.status).toBe(405);
		expect(resposta.headers.get('Allow')).toBe('GET');
	});

	it('uma rota de API que não existe dá 404', async () => {
		const resposta = await pedir('/api/nao-existe');
		expect(resposta.status).toBe(404);
	});

	/**
	 * **Um endereço fora da app não devolve o `index.html`.** Em regime os assets são servidos antes
	 * deste `fetch` e o Worker nem chega a correr para `/`; o que aqui se prende é a ausência de
	 * encaminhamento do lado do cliente — se um dia a página passar a ter rotas próprias, isto tem
	 * de mudar em conjunto com o `not_found_handling` do `wrangler.jsonc`, e não sozinho.
	 */
	it('um caminho fora da app dá 404, e não a página', async () => {
		const resposta = await pedir('/qualquer-coisa');
		expect(resposta.status).toBe(404);
		expect(await resposta.text()).not.toContain('<html');
	});
});
