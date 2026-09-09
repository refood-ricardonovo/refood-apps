import { OdooClient } from '@refood/odoo';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { criarLeitor, esquecerClientePartilhado, LINGUA_DA_TV, type EnvTv } from '../src/sessao';

/**
 * A cache das leituras ao Odoo.
 *
 * O que estes testes protegem não é a poupança — é a **separação por núcleo**. A Cache API de um
 * Worker é partilhada pelos televisores do mesmo POP: dois ecrãs de núcleos diferentes na mesma
 * cidade batem na mesma cache. Uma chave sem empresa não devolveria dados a mais, devolveria **os
 * do outro núcleo**.
 */

const ENV: EnvTv = {
	DB: null as never,
	ODOO_URL: 'https://odoo.test',
	ODOO_DB: 'teste',
	ODOO_USERNAME: 'u',
	ODOO_PASSWORD: 'p',
};

/** Uma Cache API mínima, que guarda o que lhe põem e regista as chaves usadas. */
function cacheFalsa() {
	const guardado = new Map<string, string>();
	const chaves: string[] = [];

	return {
		chaves,
		guardado,
		default: {
			async match(pedido: Request) {
				chaves.push(pedido.url);
				const corpo = guardado.get(pedido.url);
				return corpo === undefined ? undefined : new Response(corpo);
			},
			async put(pedido: Request, resposta: Response) {
				guardado.set(pedido.url, await resposta.text());
			},
		},
	};
}

let cache: ReturnType<typeof cacheFalsa>;

beforeEach(() => {
	esquecerClientePartilhado();
	cache = cacheFalsa();
	vi.stubGlobal('caches', cache);
	vi.spyOn(OdooClient.prototype, 'searchRead').mockResolvedValue([{ id: 1 }] as never);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const OPCOES = { fields: ['name'], limit: 10, cache: 60 } as const;

describe('a chave de cache', () => {
	it('leva o núcleo no caminho, em claro', async () => {
		await criarLeitor(ENV, 75, LINGUA_DA_TV).searchRead('res.delivery.route', [], OPCOES);

		expect(cache.chaves).toHaveLength(1);
		expect(cache.chaves[0]).toContain('/nucleo/75/');
		expect(cache.chaves[0]).toContain('/res.delivery.route/');
	});

	/**
	 * O teste que interessa: a mesma leitura, em dois núcleos, **nunca** pode cair na mesma entrada.
	 * Se este ficar verde por engano — porque alguém tirou a empresa da chave —, um televisor de
	 * Almada passa a mostrar as famílias de Aveiro.
	 */
	it('nunca colide entre dois núcleos, com a mesma leitura', async () => {
		await criarLeitor(ENV, 7, LINGUA_DA_TV).searchRead('res.delivery.route', [['week_day', '=', '3']], OPCOES);
		await criarLeitor(ENV, 12, LINGUA_DA_TV).searchRead('res.delivery.route', [['week_day', '=', '3']], OPCOES);

		expect(cache.chaves[0]).not.toBe(cache.chaves[1]);
		expect(cache.chaves[0]).toContain('/nucleo/7/');
		expect(cache.chaves[1]).toContain('/nucleo/12/');
		// E as duas leituras foram mesmo ao Odoo: a segunda não foi servida pela primeira.
		expect(OdooClient.prototype.searchRead).toHaveBeenCalledTimes(2);
	});

	/**
	 * **A língua vai na chave, e por uma razão parecida com a do núcleo.** Uma resposta guardada
	 * numa língua continuaria a ser servida depois de a língua mudar — e na PWA, onde a língua é de
	 * cada voluntário, duas pessoas de línguas diferentes cairiam na mesma entrada.
	 */
	it('leva a língua no caminho, em claro, e nunca colide entre duas línguas', async () => {
		await criarLeitor(ENV, 7, 'pt_PT').searchRead('res.delivery.route', [], OPCOES);
		await criarLeitor(ENV, 7, 'en_US').searchRead('res.delivery.route', [], OPCOES);

		expect(cache.chaves[0]).toContain('/nucleo/7/pt_PT/');
		expect(cache.chaves[1]).toContain('/nucleo/7/en_US/');
		expect(cache.chaves[0]).not.toBe(cache.chaves[1]);
		// E a segunda foi mesmo ao Odoo: não foi servida pela resposta em português.
		expect(OdooClient.prototype.searchRead).toHaveBeenCalledTimes(2);
	});

	it('separa leituras diferentes do mesmo núcleo', async () => {
		const leitor = criarLeitor(ENV, 7, LINGUA_DA_TV);
		await leitor.searchRead('res.delivery.route', [['week_day', '=', '3']], OPCOES);
		await leitor.searchRead('res.delivery.route', [['week_day', '=', '4']], OPCOES);
		await leitor.searchRead('resource.calendar', [['week_day', '=', '3']], OPCOES);

		expect(new Set(cache.chaves).size).toBe(3);
	});
});

describe('o que se guarda e o que não se guarda', () => {
	it('serve da cache à segunda leitura igual, sem ir ao Odoo', async () => {
		const leitor = criarLeitor(ENV, 7, LINGUA_DA_TV);
		const primeira = await leitor.searchRead('res.delivery.route', [], OPCOES);
		const segunda = await leitor.searchRead('res.delivery.route', [], OPCOES);

		expect(segunda).toEqual(primeira);
		expect(OdooClient.prototype.searchRead).toHaveBeenCalledTimes(1);
	});

	/**
	 * Sem `cache` nas opções não se toca na Cache API. É o caso do `pos.order`: o estado de uma
	 * família tem de mudar de cor no refresh seguinte, e servir dois minutos de atraso é dizer a
	 * quem está na cozinha que alguém já foi servido quando não foi.
	 */
	it('não toca na cache quando a leitura não pede cache', async () => {
		const leitor = criarLeitor(ENV, 7, LINGUA_DA_TV);
		await leitor.searchRead('pos.order', [], { fields: ['name'], limit: 10 });
		await leitor.searchRead('pos.order', [], { fields: ['name'], limit: 10 });

		expect(cache.chaves).toHaveLength(0);
		expect(cache.guardado.size).toBe(0);
		expect(OdooClient.prototype.searchRead).toHaveBeenCalledTimes(2);
	});

	it('guarda com o prazo que a leitura pediu', async () => {
		await criarLeitor(ENV, 7, LINGUA_DA_TV).searchRead('res.delivery.route', [], { fields: ['name'], limit: 10, cache: 120 });

		// A resposta guardada leva o `max-age`; é o que faz a Cache API deitá-la fora ao fim do prazo.
		expect(cache.guardado.size).toBe(1);
	});

	it('o âmbito por núcleo continua no domínio, com cache ou sem ela', async () => {
		await criarLeitor(ENV, 75, LINGUA_DA_TV).searchRead('res.delivery.route', [['week_day', '=', '3']], OPCOES);

		expect(OdooClient.prototype.searchRead).toHaveBeenCalledWith(
			'res.delivery.route',
			[
				['company_id', '=', 75],
				['week_day', '=', '3'],
			],
			expect.objectContaining({ context: { allowed_company_ids: [75] }, lang: LINGUA_DA_TV }),
		);
	});

	/**
	 * Sem `lang` no contexto o Odoo lê em `en_US` — não na língua do utilizador. É a falha que não
	 * se vê: os valores vêm todos, plausíveis, na língua errada. Uma leitura da TV sem língua era
	 * um painel português a mostrar nomes ingleses.
	 */
	it('toda a leitura leva a língua até ao cliente', async () => {
		await criarLeitor(ENV, 75, LINGUA_DA_TV).searchRead('pos.order', [], { fields: ['name'], limit: 1 });

		expect(OdooClient.prototype.searchRead).toHaveBeenCalledWith(
			'pos.order',
			expect.anything(),
			expect.objectContaining({ lang: 'pt_PT' }),
		);
	});
});
