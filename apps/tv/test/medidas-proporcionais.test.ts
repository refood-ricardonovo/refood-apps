import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * **As páginas que ficam num televisor não têm medidas em píxeis. Têm fracções do ecrã.**
 *
 * Uma Android TV reporta 960 × 540 px CSS com `devicePixelRatio: 2` — 1920 × 1080 físicos contados
 * em metade. Uma página escrita em píxeis absolutos aparece ali ao dobro do tamanho previsto, com
 * metade do espaço. Por isso tudo o que se vê numa cozinha é escrito em `--px`, que vale
 * `min(100vw / 1920, 100vh / 1080)`: a milésima parte de 1920 da largura do desenho.
 *
 * ---------------------------------------------------------------------------------------------
 *
 * **Este teste existe porque uma página ficou para trás, e ninguém deu por isso.**
 *
 * O `painel.html` foi convertido e o `index.html` não. O `index.html` é o ecrã de emparelhamento —
 * abre uma vez por televisor, quando alguém está ao telefone com a sede, e depois **nunca mais se
 * vê**. Medido no televisor antes da correcção: o conteúdo pedia 790px de altura numa janela de
 * 540, o logótipo enchia o ecrã e o código de seis dígitos ficava em 485–685, **inteiramente abaixo
 * da dobra**. Um ecrã cuja única razão de existir é mostrar seis dígitos não os mostrava. Com o
 * token já guardado acontecia o mesmo à confirmação do núcleo.
 *
 * Nada disto dá erro, e ninguém repara numa página que não muda. Daí a verificação ser sobre a
 * pasta inteira e não sobre uma lista: **uma página nova em `public/` tem de ser classificada**, e
 * enquanto não for, este teste fica vermelho. É a pergunta a ser feita em vez de esquecida.
 */

const PUBLICO = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** As páginas que ficam num televisor. Não podem ter uma única medida em píxeis. */
const PROPORCIONAIS = new Set(['index.html', 'painel.html', 'diagnostico-degraus.html']);

/**
 * As páginas isentas, **cada uma com a razão escrita**. Uma isenção sem motivo é uma lista de
 * excepções, que é como uma regra deixa de valer.
 */
const ISENTAS = new Map([
	[
		'admin.html',
		'A consola da sede. Vê-se num computador, a 60cm, e não num televisor 16:9 — a unidade do ' +
			'desenho de TV não lhe serve de nada e limitá-la-ia a uma proporção que ela não tem.',
	],
	[
		'diagnostico.html',
		'As réguas de overscan medem distâncias reais à borda em píxeis CSS, que é a unidade em que ' +
			'se lê o `innerWidth`. Uma régua que escalasse com a janela não media coisa nenhuma.',
	],
	[
		'diagnostico-1920.html',
		'Os cartões de amostra estão em píxeis fixos de propósito: são o tamanho que está em ' +
			'julgamento quando se testa se o televisor respeita o `meta viewport`.',
	],
]);

/** O CSS de uma página, sem comentários — que falam de píxeis em prosa e não são medidas. */
function estilosSemComentarios(html: string): string {
	const blocos = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
	return blocos.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('as páginas de televisor não medem em píxeis', () => {
	it('toda a página de public/ está classificada', async () => {
		const paginas = (await readdir(PUBLICO)).filter((f) => f.endsWith('.html'));

		for (const pagina of paginas) {
			expect(
				PROPORCIONAIS.has(pagina) || ISENTAS.has(pagina),
				`${pagina} é nova e ninguém disse se fica num televisor. Se fica, escreve-a em --px e ` +
					'acrescenta-a a PROPORCIONAIS; se não fica, põe-na em ISENTAS com a razão. ' +
					'O que não pode é ficar de fora da pergunta — foi assim que o index.html se perdeu.',
			).toBe(true);
		}

		/* E o contrário: uma página classificada que já não existe deixa a lista a mentir. */
		for (const pagina of [...PROPORCIONAIS, ...ISENTAS.keys()]) {
			expect(paginas, `${pagina} está classificada mas já não existe em public/.`).toContain(pagina);
		}
	});

	for (const pagina of PROPORCIONAIS) {
		it(`${pagina} não tem medidas absolutas`, async () => {
			const html = await readFile(join(PUBLICO, pagina), 'utf8');
			const css = estilosSemComentarios(html);

			expect(css.length, `${pagina} não tem <style> nenhum — o teste está a olhar para o sítio errado.`).toBeGreaterThan(0);
			expect(css, `${pagina} devia declarar o --px.`).toContain('--px');

			const absolutos = [...css.matchAll(/[^\w-](\d+(?:\.\d+)?px)\b/g)].map((m) => m[1]);
			expect(
				absolutos,
				`${pagina} tem ${absolutos.length} medida(s) em píxeis: ${[...new Set(absolutos)].join(', ')}. ` +
					'Num televisor a 960 × 540 px CSS ficam ao dobro do tamanho e empurram o resto para fora do ecrã. ' +
					'Escreve-as como calc(N * var(--px)).',
			).toEqual([]);
		});
	}

	it('cada isenção tem uma razão escrita', () => {
		for (const [pagina, razao] of ISENTAS) {
			expect(razao.length, `${pagina} está isenta sem explicar porquê.`).toBeGreaterThan(40);
		}
	});
});
