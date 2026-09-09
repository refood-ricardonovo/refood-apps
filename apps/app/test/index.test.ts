import { describe, expect, it } from 'vitest';
import worker from '../src/index';

/**
 * **Um `Env` vazio, e chega para o que este ficheiro testa.**
 *
 * O `env` entrou na assinatura quando a app ganhou o Odoo e o D1 — e este ficheiro deixou de
 * compilar, que era o sítio certo para se dar por isso. Os caminhos que aqui se exercitam — a sonda
 * de saúde e os 404 — não lhe tocam; quem depende de ligações a sério é testado em `entrar.test.ts`
 * e `mural.test.ts`, com um D1 verdadeiro por baixo.
 */
const ENV = {} as Env;

const pedir = (caminho: string, metodo = 'GET') =>
	worker.fetch(new Request(`https://app-staging.myrefood.pt${caminho}`, { method: metodo }), ENV);

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
