import { beforeAll, describe, expect, it } from 'vitest';
import { medirDegraus, type Degrau, type Leitura } from './medidas/banco';

/**
 * **Os degraus do painel prometem coisas que ninguém verificava.**
 *
 * Quatro vezes o mesmo defeito, cada vez com outra cara — uma medida a crescer contra um limite que
 * nada comparava, e a falhar sem deixar rasto:
 *
 * 1. **`--largura` abaixo do `min-content` do cartão.** O degrau `cheia` declarava um tecto de
 *    180px para um cartão que mede 186,5. A grelha não encolhe abaixo do conteúdo: transborda. E
 *    como é `justify-content: center` dentro de um `overflow: hidden`, transbordava para **os dois
 *    lados ao mesmo tempo**, com os cartões de fora simplesmente ausentes do ecrã.
 * 2. **`colunas × --largura` acima da largura da grelha.** As recolhas declaravam 5 colunas de
 *    372px numa faixa de 1872: 1908px de intenção em 1872px de ecrã. Nunca se viu porque as faixas
 *    encolhem até ao conteúdo primeiro — o tecto era só inalcançável, e um número inalcançável no
 *    CSS é um número que mente a quem o lê a seguir.
 * 3. **O degrau a servir mais cartões do que tem lugar.** O `apertada` das entregas apanhava até 72
 *    e só tinha 9 × 7 = 63 lugares. Nove famílias fora do ecrã em cada turno dessa dimensão.
 * 4. **Um limite tirado de uma medição que uma mudança posterior invalidou** — o 90 do `MAIOR_TURNO`
 *    aqui abaixo. É a mais difícil das quatro, porque o número estava certo quando foi escrito.
 *
 * Nenhuma dá erro, nenhuma pinta nada de vermelho, e todas se veem só numa cozinha. Este ficheiro
 * transforma-as em comparações com dois lados, medidas no painel a sério.
 *
 * **O que mede é o `painel.html`, não uma cópia dele** — ver `medidas/medir.html`. Uma versão
 * anterior desta verificação usava um cartão escrito à mão a imitar o do painel, e mediu um cartão
 * que não existe. O que lá está agora carrega o painel, o CSS dele e as funções dele.
 *
 * **E o último teste guarda a rede, não o desenho:** o painel passou a contar o que desenhou contra
 * o que está mesmo visível, e a dizê-lo no cabeçalho. É o que apanha a quinta vez.
 */

/**
 * **O cartão que o painel promete mostrar, e o critério deste teste.**
 *
 * Um tecto não pode ser verificado contra "um cartão": tem de ser contra um cartão **declarado**.
 * Este é o que o próprio `painel.html` documenta na nota da grelha — etiqueta de quatro caracteres
 * (`B912`), linha de baixo de onze (`19:30  3A 4C`), peso de dois dígitos.
 *
 * **Mas os degraus já vão todos além disto, e de propósito.** Cada um aguenta agora o **pior caso**
 * medido — etiqueta de cinco caracteres, peso de três dígitos e contagens de dois —, com a margem
 * que sobra na coluna:
 *
 * | degrau   | colunas | coluna | pior caso | margem |
 * | -------- | ------- | ------ | --------- | ------ |
 * | folgada  | 5       | 365px  | 358px     | 7px    |
 * | normal   | 6       | 302px  | 282px     | 20px   |
 * | apertada | 7       | 261px  | 245px     | 16px   |
 * | cheia    | 8       | 227px  | 224px     | 3px    |
 *
 * Foi por isso que as colunas desceram: a dez, nove e sete, um núcleo cuja numeração passasse dos
 * mil — já há 47 cartões assim na base, e o maior contador vai em 1574 — via a coluna da direita
 * serrada. O teste continua a verificar o cartão **declarado**, que é o contrato; o pior caso é
 * folga deliberada por cima dele, e quem a gastar num degrau fica a saber pela amostra em
 * `public/diagnostico-degraus.html`.
 */
const CARTAO_DECLARADO = 'documentado';

/**
 * **O maior ecrã que existe na base, que é contra o que a capacidade do degrau mais denso se mede.**
 *
 * Um ecrã é núcleo × turno × dia da semana — a unidade que o painel desenha de cada vez, e não o
 * `resource.calendar` sozinho. Medido em **Setembro de 2026** com
 * `node --experimental-strip-types scripts/turnos-por-tamanho.ts`, sobre staging:
 *
 * - **entregas:** 178 ecrãs, mediana 14, p90 30, **máximo 65**. Só 1,1% passam dos 63.
 * - **recolhas:** 154 ecrãs, mediana 4, **máximo 26**. 94% têm 12 ou menos.
 *
 * ---------------------------------------------------------------------------------------------
 *
 * **Isto dizia 90, e o 90 estava errado de uma maneira que vale a pena deixar escrita.**
 *
 * Não era um número inventado: foi medido, e na altura estava certo. O que aconteceu foi que o
 * painel **deixou de desenhar fichas arquivadas** — decisão deliberada, 544 rotas em 3 252, porque
 * um televisor não mostra histórico — e ninguém refez a contagem. Contando rotas com fichas
 * arquivadas o maior ecrã tem 94; contando o que um ecrã mostra, tem 65. O degrau `cheia` ficou
 * dimensionado para 90 famílias que nunca chegariam a ser desenhadas, e foi esse 90 que impôs dez
 * colunas de 180px — estreitas de mais para um cartão com etiqueta de cinco caracteres.
 *
 * **Foi a quarta vez que o mesmo padrão apareceu neste painel**, e a mais difícil de apanhar: as
 * outras três eram um limite que ninguém comparava com nada, e esta era um limite tirado de uma
 * medição que uma mudança posterior invalidou. Um teste não apanha isso — o número estava certo
 * quando foi escrito. Só a data e a origem apanham.
 *
 * **Daí a regra que fica:** este valor leva sempre a data e o comando que o produziu, e refaz-se
 * depois de qualquer mudança no domínio das rotas ou em qualquer actualização do Odoo. Um número
 * aqui sem data é um número que já não se sabe se é verdade.
 */
const MAIOR_TURNO = { entregas: 65, recolhas: 26 } as const;

/**
 * Quanto é que uma medida pode fugir da metade exacta, ao comparar 1920 com 960.
 *
 * Não é folga a gosto: é o arredondamento com que o browser traça o texto. Uma linha de onze
 * caracteres cai meio píxel para um lado ou para o outro conforme a escala, e nunca mais do que
 * isso. **Uma medida absoluta esquecida engana-se por muito mais** — o menor valor em píxeis do
 * painel são 2px, que a meia escala erram por 1; a maioria erra por 4, 8 ou 20. Um píxel e meio
 * passa o arredondamento e não passa um defeito.
 */
const TOLERANCIA = 1.5;

/** Um rótulo legível para as mensagens de falha. */
function nome(d: Degrau): string {
	return `${d.area}/${d.densidade}`;
}

/** A largura mínima da amostra declarada, que é a que decide a faixa da grelha. */
function minimoDeclarado(d: Degrau): number {
	const medida = d.medidas.find((m) => m.chave === CARTAO_DECLARADO);
	if (!medida) throw new Error(`O degrau ${nome(d)} não tem a amostra '${CARTAO_DECLARADO}'.`);
	return medida.minimo;
}

/** Quantas linhas deste degrau cabem na altura que a grelha tem. */
function linhasQueCabem(d: Degrau, leitura: Leitura): number {
	return Math.floor((leitura.alturaDisponivel + d.folga) / (d.altura + d.folga));
}

describe('os degraus do painel', () => {
	/*
	 * **As duas medições fazem-se uma vez, aqui, e com prazo próprio.**
	 *
	 * Arrancar o Chrome custa segundos, e a primeira chamada gasta mais uma corrida a calibrar a
	 * janela — bem dentro dos 5s por omissão do Vitest numa máquina à vontade, e fora deles numa
	 * máquina ocupada. Partilhadas por um `beforeAll` com prazo largo, o custo paga-se uma vez e
	 * nenhum teste falha por uma razão que não tem nada a ver com o que ele verifica.
	 */
	let largo: Leitura;
	let estreito: Leitura;

	beforeAll(async () => {
		largo = await medirDegraus(1920, 1080);
		estreito = await medirDegraus(960, 540);
	}, 120_000);

	it('mede o painel a sério, e não uma página meio montada', () => {
		const leitura = largo;

		/*
		 * **Isto é a verificação mais importante do ficheiro**, por pouco que pareça. Sem ela, uma
		 * folha de estilos que não chegou dá medidas plausíveis e todas erradas — foi o que aconteceu
		 * na primeira versão desta página, que mediu uma janela sem margens, sem Inter e sem nenhum
		 * dos `--e-*`, e passou. Um teste que mede a coisa errada é pior do que nenhum, porque dá
		 * licença.
		 */
		expect(leitura.montagem.temConstrutores, 'as funções do painel não chegaram a definir-se').toBe(true);
		expect(leitura.montagem.temGrelha, 'o corpo do painel não foi montado').toBe(true);
		expect(leitura.montagem.inter, 'a Inter não carregou, e estas medidas são larguras de texto').toBe(true);
		expect(leitura.montagem.folhas, 'falta uma folha de estilos — o tokens.css ou o do próprio painel').toBeGreaterThanOrEqual(2);
		expect(leitura.montagem.margemDoCorpo, 'o body ficou sem a margem do painel: os --e-* não resolveram').toBe('24px');

		/* E a janela é mesmo a que se pediu, senão as larguras abaixo são de outro ecrã. */
		expect(leitura.janela.largura).toBe(1920);
		expect(leitura.janela.altura).toBe(1080);
		expect(leitura.disponivel).toBe(1872);
		expect(leitura.alturaDisponivel).toBe(804);
	});

	it('nenhum degrau declara um tecto abaixo da largura mínima do cartão', () => {
		const leitura = largo;

		for (const d of leitura.degraus) {
			const minimo = minimoDeclarado(d);

			expect(
				minimo,
				`${nome(d)}: o cartão declarado mede ${minimo.toFixed(1)}px e o degrau dá-lhe um tecto de ${d.tecto}px. ` +
					'A faixa da grelha não encolhe abaixo do conteúdo — transborda, para os dois lados, dentro de um ' +
					'overflow:hidden. Sobe o --largura, ou tira largura ao cartão (--barra, --entre, --respiro-h).',
			).toBeLessThanOrEqual(d.tecto);
		}
	});

	it('nenhuma grelha declara mais colunas do que a largura do ecrã comporta', () => {
		const leitura = largo;

		for (const d of leitura.degraus) {
			const precisa = d.colunas * d.tecto + (d.colunas - 1) * d.folga;

			expect(
				precisa,
				`${nome(d)}: ${d.colunas} colunas de ${d.tecto}px com ${d.folga}px de folga pedem ${precisa}px, ` +
					`e a grelha tem ${leitura.disponivel}px. Um tecto que a linha não comporta é um número que nunca ` +
					'chega a acontecer — e quem o ler a seguir vai dimensionar outra coisa a partir dele.',
			).toBeLessThanOrEqual(leitura.disponivel);
		}
	});

	it('nenhum degrau serve mais cartões do que tem lugar para mostrar', () => {
		const leitura = largo;

		for (const d of leitura.degraus) {
			const lugares = d.colunas * linhasQueCabem(d, leitura);
			/* O último degrau não tem tecto de contagem: o que tem de aguentar é o maior turno da base. */
			const precisaDe = d.ate ?? MAIOR_TURNO[d.area];

			expect(
				lugares,
				`${nome(d)}: serve até ${precisaDe} cartões e tem ${d.colunas} × ${linhasQueCabem(d, leitura)} = ${lugares} lugares. ` +
					`Os ${precisaDe - lugares} que sobram não aparecem em lado nenhum e nada no ecrã o diz. ` +
					'Ou o degrau acaba mais cedo — o corte está na função densidade() — ou o cartão tem de encolher.',
			).toBeGreaterThanOrEqual(precisaDe);
		}
	});

	/**
	 * **A rede por baixo da rede.**
	 *
	 * Tudo o que está acima guarda os números de hoje. Isto guarda o dia em que eles ficarem velhos
	 * — que já aconteceu uma vez, quando o painel deixou de desenhar fichas arquivadas e o máximo
	 * passou de 90 para 65 sem ninguém refazer a conta.
	 *
	 * O painel compara agora o que desenhou com o que está mesmo dentro da banda entre o cabeçalho e
	 * o rodapé, e di-lo no cabeçalho. Um contador que deixasse de contar seria este mesmo defeito
	 * outra vez, uma camada acima — por isso exerce-se: à capacidade exacta tem de estar calado, e
	 * um cartão acima dela tem de falar, com o número certo.
	 */
	it('o painel dá por si quando esconde cartões', () => {
		const leitura = largo;
		const [naMedida, acima] = leitura.aviso;

		expect(naMedida.pedidos, 'a prova de baixo tem de ser exactamente a capacidade do degrau').toBe(leitura.lugares);
		expect(naMedida.contador, `${naMedida.pedidos} cartões cabem em ${leitura.lugares} lugares e o painel diz que ficaram de fora`).toBe(0);
		expect(
			naMedida.escondido,
			'à capacidade exacta o contador tem de estar escondido — um aviso que aparece sempre não avisa de nada',
		).toBe(true);

		const esperados = acima.pedidos - leitura.lugares;
		expect(
			acima.contador,
			`com ${acima.pedidos} cartões num degrau de ${leitura.lugares} lugares deviam sobrar ${esperados}, e o painel conta ${acima.contador}. ` +
				'Se conta zero, o aviso deixou de funcionar e os cartões voltaram a desaparecer em silêncio.',
		).toBe(esperados);
		expect(acima.escondido, 'há cartões fora do ecrã e o contador está escondido').toBe(false);
	});

	/**
	 * A rede que apanha a regressão de que tudo isto veio: uma medida em píxeis absolutos a
	 * reaparecer no meio do CSS.
	 *
	 * O painel está escrito em `--px`, uma fracção do ecrã, e por isso **tudo tem de escalar junto**.
	 * Se alguém escrever `40px` outra vez, essa medida deixa de acompanhar e a proporção parte-se —
	 * numa Android TV, que reporta 960 × 540 com `devicePixelRatio: 2`, fica ao dobro do tamanho de
	 * tudo o resto. O sinal é este: **a metade da janela, tudo mede metade.**
	 */
	it('tudo escala com a janela: a 960 × 540 todas as medidas valem metade', () => {
		expect(estreito.janela.largura).toBe(960);
		expect(estreito.disponivel).toBe(largo.disponivel / 2);
		expect(estreito.alturaDisponivel).toBe(largo.alturaDisponivel / 2);

		for (const [i, d] of estreito.degraus.entries()) {
			const gemeo = largo.degraus[i];
			expect(nome(d)).toBe(nome(gemeo));

			const esperado = gemeo.minimo / 2;
			expect(
				Math.abs(d.minimo - esperado),
				`${nome(d)}: a 1920 o cartão mede ${gemeo.minimo.toFixed(1)}px e a 960 mede ${d.minimo.toFixed(1)}px, ` +
					`quando devia medir ${esperado.toFixed(1)}. Há uma medida em píxeis absolutos no CSS do cartão — ` +
					'procura um valor sem `var(--px)`.',
			).toBeLessThanOrEqual(TOLERANCIA);

			expect(Math.abs(d.tecto - gemeo.tecto / 2), `${nome(d)}: o --largura não escalou com o --px.`).toBeLessThanOrEqual(TOLERANCIA);
		}
	});
});
