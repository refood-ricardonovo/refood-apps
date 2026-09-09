# Design — apps TV e PWA

Duas origens, e a diferença importa em cada linha deste documento:

- **Fixo** — vem do _Guia de Utilização da Marca REFOOD_, maio de 2019. Não se discute nem se
  ajusta sem falar com `nacionalcomunicacao@re-food.org`.
- **Proposta** — não existe no guia. Foi decidido aqui, para as apps, e pode mudar. Está marcado
  como tal em todas as secções onde aparece.

---

## Fixo — a marca

### As duas cores

|         | HEX       | RGB        | Pantone    | CMYK             |
| ------- | --------- | ---------- | ---------- | ---------------- |
| Amarelo | `#F5B72F` | 245 183 47 | 1235       | 0 / 32 / 100 / 0 |
| Preto   | `#000000` | 0 0 0      | Black 100% | 0 / 0 / 0 / 100  |

São estas as cores da marca. O guia não define mais nenhuma — nem cinzentos, nem cores de estado.

### Composição do logótipo

- A seta é sempre amarela ou branca.
- A palavra **FOOD** é sempre amarela ou branca.
- O prefixo **RE** é sempre preto ou branco.
- A mãozinha e a faca são sempre pretas ou brancas.
- Não alterar cores nem composição, não distorcer proporções, não acrescentar elementos.

Há uma variante principal (vertical) e uma secundária (horizontal), esta para quando não cabe a
vertical. Ambas existem com e sem assinatura. **No selo de parceiro — e só aí — as cores do nome
invertem-se**, para integrar no círculo.

### Núcleos

Existe uma composição oficial da marca para identificar um núcleo, com o nome do núcleo em
**Helvetica Bold**. É esta a que a TV deve usar no cabeçalho, não uma composição inventada.

### O nome escrito

`RE-FOOD` é a marca registada; o hífen existe para não colidir com outra marca. Em texto corrente,
**Refood** ou **REFOOD** — ambos corretos, sem hífen. Nas apps: **Refood**.

---

## A regra que decide todo o resto: o amarelo não é cor de texto

| Combinação             | Contraste    |
| ---------------------- | ------------ |
| `#F5B72F` sobre branco | **1,8 : 1**  |
| `#F5B72F` sobre preto  | **11,7 : 1** |
| Branco sobre `#F5B72F` | 1,8 : 1      |

O mínimo do WCAG AA é 4,5:1 para texto normal e 3:1 para texto grande. O amarelo sobre branco falha
os dois, em qualquer tamanho. Não é uma questão de gosto nem de tolerância: é ilegível para uma
parte real das pessoas que vão olhar para estes ecrãs.

Daqui saem três regras de aplicação, **proposta**, mas difíceis de contornar:

1. **O amarelo é fundo ou é acento sobre escuro.** Nunca texto sobre claro.
2. Sobre amarelo, o texto é **preto**. Nunca branco.
3. Um valor numérico grande pode ser amarelo **se o fundo for escuro** — aí tem 11,7:1 e é o
   destaque mais forte que a marca permite.

---

## Proposta — neutros

O guia não tem nenhum. Escala neutra pura, sem tom, para não competir com o amarelo:

| Token     | HEX       | Uso                                                   |
| --------- | --------- | ----------------------------------------------------- |
| `--n-950` | `#0F0F0F` | Fundo da TV                                           |
| `--n-900` | `#1A1A1A` | Superfície elevada sobre o fundo da TV                |
| `--n-800` | `#2B2B2B` | Divisórias e limites sobre escuro                     |
| `--n-600` | `#5A5A5A` | Texto desativado sobre claro                          |
| `--n-400` | `#9A9A9A` | Texto secundário sobre escuro — 6,2:1 sobre `--n-900` |
| `--n-200` | `#D6D6D6` | Divisórias sobre claro                                |
| `--n-100` | `#EDEDED` | Fundo da PWA                                          |
| `--n-000` | `#FFFFFF` | Superfície da PWA, texto sobre escuro                 |

O preto puro `#000000` fica reservado ao logótipo e a texto sobre amarelo, para que a marca não se
confunda com o chrome da interface.

---

## Proposta — cores de estado

O problema aqui é que o amarelo, que noutra interface seria o "aviso", é a cor da marca. Se o
alerta for amarelo, deixa de haver diferença entre "isto é a Refood" e "isto está mal".

Portanto: **nenhum estado usa amarelo**, e há dois estados, não três.

| Estado     | Sobre escuro | Sobre claro | Contraste sobre `--n-900` |
| ---------- | ------------ | ----------- | ------------------------- |
| Erro       | `#FF7A6E`    | `#C5342A`   | 6,9 : 1                   |
| Sucesso    | `#5CD68A`    | `#1E7A44`   | 9,5 : 1                   |
| Informação | `#5AA9FF`    | `#1A5FB4`   | 7,1 : 1                   |

A cor nunca é o único portador do significado — leva sempre texto ou ícone ao lado. Numa TV, é
provável que quem olha esteja a três metros e de lado.

---

## Decidido — tipografia: Inter

**Helvetica não é uma fonte web.** Escrita em CSS cai em Arial na maioria dos dispositivos, e num
televisor Android cai em Roboto. O guia é de 2019 e feito para impressão; cumpri-lo à letra num
browser não é possível.

A substituta é a **Inter**, variável e **auto-alojada** — servida pelo Worker de cada app, na mesma
origem, sem chamada ao Google Fonts. Menos uma dependência externa numa box que arranca sozinha, e
menos uma discussão de RGPD.

A Inter é desenhada para ecrã: altura-x generosa e aberturas mais abertas no `a`, `c`, `e` e `s`,
que é onde a Helvetica fecha quando se afasta. Mantém a estrutura de grotesca neutra que a marca
espera.

```
--fonte: Inter, Helvetica, Arial, sans-serif;
```

Ligar **`font-variant-numeric: tabular-nums`** em tudo o que mostre números. Sem isso, os quilos
saltam de posição a cada atualização do dashboard.

### Pesos

| Onde                                 | Peso    |
| ------------------------------------ | ------- |
| Corrente na PWA                      | 400     |
| **Corrente na TV**                   | **500** |
| Ênfase                               | 600     |
| Números de destaque e nome do núcleo | 700     |

**O 500 na TV não é decoração.** Texto claro sobre fundo escuro parece opticamente mais fino do que
é — o mesmo peso 400 que assenta na PWA esvai-se num televisor a três metros. A regra vale para
qualquer texto sobre `--n-950` ou `--n-900`, nas duas apps.

---

## Proposta — a TV é uma superfície própria

Não herda os tamanhos da PWA. É um ecrã visto de três a quatro metros, numa cozinha com luz de teto,
e ninguém se aproxima para ler.

A conta, para se poder refazer: num televisor de 43" a 1080p, a altura útil são uns 535 mm, ou seja
**0,5 mm por pixel**. A regra prática para leitura confortável é a altura do caráter ≈ distância
÷ 200. A quatro metros dá 20 mm, e 20 mm são **40 px**.

|                     | Tamanho    | Notas                                      |
| ------------------- | ---------- | ------------------------------------------ |
| Números de destaque | 120–200 px | O que se lê de relance                     |
| Título              | 64 px      |                                            |
| Corrente            | 40 px      | **Mínimo absoluto**                        |
| Secundário          | 32 px      | Só para etiquetas curtas, nunca para dados |

Fundo `--n-950`, texto `--n-000`, amarelo como acento. Nada abaixo de 32 px vai para um televisor.

**Isto é aritmética, não medição.** Confirmar num núcleo, com o televisor real e alguém a olhar da
porta, antes de assentar. É o teste mais barato de todo o projeto e o único que responde de verdade.

---

## Proposta — a PWA

Telemóvel, na mão, muitas vezes à pressa e à porta de uma cozinha.

- Base 16 px, mínimo 14 px.
- Alvo de toque mínimo 44 × 44 px.
- Fundo `--n-100`, superfícies `--n-000`, texto `#1A1A1A`.
- O amarelo aparece em cabeçalhos e ações primárias — como fundo, com texto preto por cima.

---

## Espaçamento

Escala de base 4, a mesma nas duas apps; muda a densidade, não os degraus.

`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96`

Na TV o degrau de partida é o 24; na PWA é o 8.

---

## Proposta — uso do logótipo

O guia não define margem de proteção nem tamanho mínimo. Até haver resposta da sede:

- **Margem de proteção:** igual à altura da letra "F" de FOOD, em toda a volta.
- **Tamanho mínimo:** 96 px de largura na versão horizontal (PWA), 240 px na TV.
- **Fundo amarelo:** o lettering é **RE a preto e FOOD a branco**. O guia só descreve esta inversão
  das cores do nome para o selo de parceiro — estendê-la ao fundo amarelo das apps é decisão tomada
  aqui, não é o guia a dizê-lo. O branco sobre `#F5B72F` são 1,8:1, e passa porque isto é a marca e
  não texto: o WCAG isenta logótipos e nomes de marca do requisito de contraste. Não abre precedente
  para mais nada nesta interface — a regra 2 lá de cima continua inteira.
- **Fundo escuro:** a variante a branco, ou a versão a cores se houver espaço para ela respirar.
- **O símbolo isolado** — a seta com a mãozinha e a faca, sem o lettering — **não existe no guia**,
  que só descreve as variantes vertical e horizontal, com e sem assinatura, e o selo de parceiro.
  Usá-lo sozinho é decisão tomada aqui, para o cabeçalho do painel da TV: o ecrã já diz o nome do
  núcleo em texto, e o lockup horizontal repetia a palavra REFOOD ao lado disso a ocupar 240px de
  largura que os cartões usam. O ficheiro é `refood_simbolo_fundo_escuro.svg`, recortado do lockup
  para fundo escuro sem tocar nos traços — mesmas coordenadas, mesmas cores, só o `viewBox` muda.
  **O mínimo de 240px não se aplica ao símbolo:** essa regra é da variante horizontal, e esta não é
  uma variante. Dimensiona-se pela altura.
- Nunca redesenhar, recolorir, esticar nem compor com outros elementos.

---

## Tokens

Ficheiro único, partilhado pelas duas apps. Se a TV e a PWA tiverem cada uma o seu `#F5B72F`
escrito à mão, divergem em três meses.

```css
:root {
	/* Marca — fixo */
	--marca-amarelo: #f5b72f;
	--marca-preto: #000000;

	/* Neutros */
	--n-950: #0f0f0f;
	--n-900: #1a1a1a;
	--n-800: #2b2b2b;
	--n-600: #5a5a5a;
	--n-400: #9a9a9a;
	--n-200: #d6d6d6;
	--n-100: #ededed;
	--n-000: #ffffff;

	/* Estados */
	--erro-claro: #ff7a6e;
	--erro-escuro: #c5342a;
	--ok-claro: #5cd68a;
	--ok-escuro: #1e7a44;
	--info-claro: #5aa9ff;
	--info-escuro: #1a5fb4;

	/* Tipo */
	--fonte: Inter, Helvetica, Arial, sans-serif;
	--peso-corrente: 400; /* 500 sobre fundo escuro */
	--peso-enfase: 600;
	--peso-destaque: 700;

	/* Espaço */
	--e-1: 4px;
	--e-2: 8px;
	--e-3: 12px;
	--e-4: 16px;
	--e-6: 24px;
	--e-8: 32px;
	--e-12: 48px;
	--e-16: 64px;
	--e-24: 96px;
}
```

---

## A pedir à sede

- **Ficheiros vetoriais do logótipo** — SVG das variantes principal e secundária, com e sem
  assinatura, e do selo de parceiro. Os do PDF são rasterizados e não servem para uma app.
- **A composição oficial do núcleo** em vetor, que é a que a TV vai usar.
- **Margem de proteção e tamanho mínimo**, se existirem em algum lado.
- **Se há paleta digital posterior a este guia.** Ele é de maio de 2019 e é feito para impressão —
  fala em Pantone, CMYK e gramagem de cartolina, não em ecrãs.

---

## A decidir aqui

- **Confirmar os tamanhos da TV no local.** Nada nesta secção foi medido.
- **O que fazer se um núcleo pedir cor própria.** O `res.company` do Odoo tem `primary_color` e
  `secondary_color`, preenchidos em duas empresas de 87. **Não são identidade de núcleo** — são um
  campo de relatórios que ninguém usa. As apps não os leem.
- ~~Modo claro na TV.~~ **Não existe.** A TV é escura sempre — é o que aguenta a luz de teto e o
  que deixa o amarelo funcionar como acento com 11,7:1.
