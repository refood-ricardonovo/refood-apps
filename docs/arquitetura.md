# Refood — Apps TV e PWA

Documento de arquitetura e registo de decisões.
Última atualização: setembro de 2026.

---

## 1. Contexto

A Refood tem 65 núcleos (centros de operação), cada um representado no Odoo como uma
empresa (`res.company`), e cerca de 7.200 voluntários. O Odoo v14 Community, alojado
on-premise na cloud, é o repositório de toda a informação.

Pretende-se construir duas aplicações distintas:

- **App TV** — dashboards num ecrã em cada núcleo, ativos ~5h por dia durante o período
  de operação. Mudança de dashboard apenas manual, pelo comando.
- **PWA voluntários** — consulta de turnos, registo de presença, gestão de escala e
  cartão de voluntário. O turno e a ficha lêem-se do Odoo; a presença é estado que o
  Odoo não tem e vive no D1.

Restrição fundamental: **a estrutura do Odoo não pode ser alterada**. Nada de módulos novos,
modelos novos ou campos personalizados — é gerido por um parceiro externo, e não se quer
vários intervenientes a mexer-lhe na estrutura. Toda a lógica adicional vive fora dele.

**A restrição é sobre estrutura, não sobre registos.** A PWA há-de escrever registos no Odoo,
rota a rota e com decisão escrita; a TV não escreve nada.

---

## 2. Arquitetura

```
tv.dominio.pt   → Worker refood-tv   (assets + /api/*)  ─┐
                                                          ├─ JSON-RPC → Odoo v14
app.dominio.pt  → Worker refood-app  (assets + /api/*)  ─┘
```

Cada app é um Cloudflare Worker que serve os seus próprios ficheiros estáticos **e** a
sua própria API na mesma origem. O frontend usa caminhos relativos (`/api/...`), o que
elimina CORS por completo e torna a app independente do domínio onde está publicada.

O Worker funciona como middleware: guarda as credenciais do Odoo, valida os pedidos,
normaliza os dados e faz cache. A PWA e a TV nunca falam diretamente com o Odoo.

### Armazenamento

| Recurso   | Uso                          | Notas                                                                                           |
| --------- | ---------------------------- | ----------------------------------------------------------------------------------------------- |
| Cache API | Dados do Odoo                | Sem quota; **partilhada pelos televisores do mesmo POP**, portanto a chave leva sempre o núcleo |
| D1        | Estado técnico e operacional | Dispositivos, tokens, sessões; e o que o Odoo não tem — presenças, notas, recados               |
| KV        | Configuração                 | Limite de 1.000 escritas/dia no plano gratuito                                                  |

**A fronteira que interessa é entre o D1 e o Odoo.** No Odoo fica tudo o que é ficha e histórico —
voluntários, turnos, beneficiários — e lê-se sempre de lá: não há segunda fonte de verdade. No D1
fica o estado técnico das apps e o estado operacional que o Odoo não modela, que é o que a PWA vai
produzir e a TV vai querer mostrar.

A Cache API não entra nesta conta. O que lá está é cópia do Odoo com prazo, que ninguém consulta
para decidir e que desaparece sozinha: é otimização de leitura, não um sítio onde se guarde alguma
coisa.

O que nunca entra no D1, e por que identificador se referencia lá uma pessoa, está no
[`CLAUDE.md`](../CLAUDE.md) da raiz — e é lá que se altera, não aqui.

---

## 3. Decisões e razões

**Web apps, não nativas.** Evita taxas de loja, revisões demoradas e reinstalações em 65
locais. Uma alteração chega a todos os ecrãs no ciclo seguinte.

**Um Worker por app, com assets incluídos.** Mesma origem para frontend e API, portanto
zero configuração de CORS e zero problemas de cookies.

**Middleware obrigatório.** O `/jsonrpc` do Odoo não devolve cabeçalhos CORS, e expor
credenciais no browser daria acesso total à base de dados. O Worker é a única peça que
conhece as credenciais.

**Cache API em vez de KV para dados.** O KV tem 1.000 escritas por dia no plano gratuito;
a monitorização dos 65 televisores esgotaria isso sozinha.

**D1 com jurisdição `eu`.** Decisão irreversível, tomada na criação. Documenta
conformidade com o RGPD para o pouco que é armazenado fora do Odoo.

**Plano pago dos Workers antes de produção.** Cerca de 55 €/ano. O plano gratuito corta
aos 100.000 pedidos/dia sem degradação suave: os 65 ecrãs ficariam em branco ao mesmo
tempo. Estimativa de uso: ~59.000 pedidos/dia.

**TypeScript.** Os browsers só executam JavaScript. O suporte a Python nos Workers
continua em beta e não eliminaria o frontend de qualquer forma.

**Cliente JSON-RPC próprio, sem dependências.** Só `fetch` e `AbortSignal`, para correr
inalterado dentro de um Worker. As bibliotecas de npm existentes assumem Node.

---

## 4. Autorização

As duas apps autorizam de formas diferentes e incompatíveis. Não há código partilhado
entre elas.

### TV

**O ecrã autentica-se com um segredo que gera e nunca mostra.** O código de 6 dígitos que
aparece no televisor coordena a aprovação com a sede; não é a credencial. É a decisão de
que decorre todo o resto, e está a seguir.

O token que daí sai **não expira**, porque um ecrã que pedisse login numa cozinha seria um
ecrã inútil. A saída é a revogação, imediata, do lado da sede.

Um token vale para **um único núcleo**, e a TV nunca escreve no Odoo. O `company_id` vem
sempre do token.

#### O código é público; quem autentica é um segredo do próprio ecrã

É desta decisão que decorre todo o desenho do emparelhamento. O código de 6 dígitos aparece
num televisor de uma cozinha por onde passa quem quiser — voluntários, fornecedores, quem
for buscar comida — e ninguém vai vigiar 65 salas. **Se o código fosse a credencial, quem
passasse por lá levava um ecrã.**

Portanto o televisor gera ele próprio 32 bytes aleatórios, guarda-os, e envia ao Worker
apenas o SHA-256 desse segredo. O código serve para a sede saber de que ecrã se trata:
identifica, não autoriza. O token só é entregue a quem apresentar o segredo em claro.

Daqui sai o resto sem ser preciso discutir caso a caso:

- o código pode ser dito ao telefone, escrito num papel ou fotografado sem consequência;
- a validade curta e o uso único do código não são proteção da credencial — são higiene de
  coordenação, porque o que interessa proteger já está do lado do ecrã e nunca viaja;
- quem tem o código e não o segredo é, por definição, alguém que leu um ecrã à distância. É
  a única tentativa que vale a pena registar, e distingue-se sem custo.

#### A atribuição do núcleo é humana, e é a única entrada por parâmetro

No momento da aprovação **não existe sujeito autenticado**: o ecrã ainda não tem token, e
o token é precisamente o que está a ser emitido. Não há de onde tirar o núcleo senão de
alguém que o escolha. É a única rota das duas apps que aceita uma empresa vinda do pedido,
e as condições em que isso é aceitável estão fixadas no `CLAUDE.md` da raiz.

Aprovar é um acto deliberado e não uma confirmação automática porque a alternativa —
deduzir o núcleo do IP, da rede ou do nome — é a mesma dedução que este projeto recusa em
todo o lado: nada infere o papel de uma empresa a partir de contexto.

#### A sede autentica-se com um segredo partilhado, sem identidades

São quatro pessoas com a mesma password. É uma decisão de proporção — montar contas para
um acto que acontece uma vez por dispositivo não se paga —, mas tem duas consequências que
se assumem: **não há registo de quem aprovou** (e não se inventa um a partir do que não
existe), e as tentativas falhadas têm de ser travadas, porque uma password partilhada por
quatro pessoas é uma password que anda escrita nalgum lado.

Passa a haver registo de autor no dia em que o admin tiver identidades a sério. Até lá, o
que se sabe é quando, não quem.

### PWA

Sessões de voluntário, com expiração. Cerca de 90% dos voluntários existem apenas como
`res.partner`, sem credenciais Odoo, portanto a autenticação não pode passar pelo Odoo.
A abordagem preferida é link mágico por email.

### Utilizador técnico

**Um único utilizador Odoo com acesso a todos os núcleos, e é assim de propósito.** A
alternativa — um utilizador por núcleo — daria 87 contas a criar, guardar, rodar e
revogar, e o Worker teria de escolher credenciais por pedido. Não compensa.

A conta em uso vai ser trocada por uma dedicada, mas **a troca não muda nada disto**: a
nova terá igualmente acesso a todos os núcleos. O que muda é a titularidade, não o
âmbito.

Consequência, e é permanente: **o Odoo não filtra nada por si.** As regras de registo
avaliam-se contra o utilizador autenticado, e esse utilizador alcança todos os núcleos em
operação — o modelo de permissões da base (documentado em
[`modelos/permissoes.md`](modelos/permissoes.md)) é contexto útil, não uma proteção de que
as apps possam depender. **A segmentação por núcleo é inteiramente responsabilidade do
middleware**, e a forma exacta que isso toma em cada consulta está fixada no
[`CLAUDE.md`](../CLAUDE.md) da raiz, não aqui.

**"Vê tudo" não é literal, e a diferença morde.** O teto do utilizador é o seu
`company_ids`, que em staging são 84 das 87 empresas da base. Uma empresa fora dele não dá
erro numa consulta: responde exactamente como responderia uma empresa vazia. Daí a decisão
de a lista de núcleos oferecidos à sede sair sempre do `company_ids` do utilizador e nunca
de uma leitura de `res.company` — oferecer um núcleo que a app não consegue ler produz um
ecrã que só falha semanas depois, longe de quem o aprovou.

---

## 5. Estado atual

### Feito

**Base.** Ambiente local; identidades Git separadas por pasta (`includeIf`) e chaves SSH
por alias; conta Cloudflare; D1 em duas instâncias com jurisdição EU — `refood-db`
(produção) e `refood-db-staging`; monorepo com npm workspaces.

**`packages/odoo`.** Cliente JSON-RPC com erros tipados, normalização e `read_group`,
testado. Ligação ao Odoo validada em local e contra a base remota.

**Esquema do D1.** Três migrações — dispositivos, emparelhamentos e a trava de tentativas
da sede —, **aplicadas em staging e nenhuma em produção**. A separação entre o que
identifica um ecrã e o que o autentica está no esquema, não só no código: guardam-se
hashes, e as chaves de contagem não guardam o IP.

**Emparelhamento.** O núcleo de autenticação vive num módulo de funções puras — geração
de credenciais, hashing, transições de estado — que se testa sem base de dados nem
emulador. As rotas e o ecrã do televisor por cima disso.

**Sede.** Rotas `/api/admin/*` e página própria no mesmo Worker: aprovar, atribuir núcleo,
listar ecrãs e revogar. Ficaram aqui, e não numa aplicação à parte, porque aprovar acontece
uma vez por dispositivo — o que virá a justificar aplicação própria é a monitorização.

**Middleware e primeira rota de dados.** O token resolve-se em todos os pedidos e a
revogação passa a ter efeito imediato. O âmbito por núcleo deixou de ser convenção e passou
a ser garantido pelas assinaturas: uma rota de dados não recebe o pedido nem o ambiente, e
por isso não tem por onde ler outro núcleo. `GET /api/nucleo` existe para provar a cadeia
inteira — token, núcleo, Odoo, ecrã — com a menor superfície possível.

**Sinal de vida** de cinco em cinco minutos, com a escrita limitada pelo relógio e não pelo
tráfego. É o que dá conteúdo à futura monitorização e o que leva a revogação até ao ecrã.

**Rotas de diagnóstico fechadas.** A que lia utilizadores sem âmbito nenhum desapareceu; a
versão do Odoo passou para trás do segredo da sede.

**Publicado.** Staging serve em `https://tv-staging.myrefood.pt` (domínio próprio; o
endereço `workers.dev` fica desligado por haver `routes` na configuração). Produção não tem
nada publicado nem nenhuma migração aplicada.

**Carga sobre o Odoo, medida e reduzida.** Antes de acrescentar o segundo painel mediu-se o custo
do primeiro: **quatro a seis idas ao Odoo por refresh, por ecrã**, uma delas a reautenticar em todos
os pedidos. Com 65 ecrãs de trinta em trinta segundos dava cerca de **200 mil chamadas por dia** a
uma base on-premise. Quatro medidas, todas verificadas contra o Odoo de staging:

- **Cliente partilhado pelo isolate** — o `uid` deixa de morrer com o pedido, e desaparece uma
  chamada `common.authenticate` em cada quatro a seis.
- **Cache API ligada, finalmente** — estava prevista aqui desde o início e nunca tinha sido usada.
  Guarda o que é catálogo (rotas, turnos) e **nunca o estado do POS**, que é o que muda enquanto o
  turno decorre. A decisão é por leitura, não global: quem escreve a consulta é quem sabe qual das
  duas é.
- **A chave é por núcleo, com a empresa no caminho e em claro.** A Cache API é partilhada pelos
  televisores do mesmo POP; uma chave sem empresa devolvia os dados do núcleo ao lado. Há um teste
  que o prende.
- **Refresh de 30s para 60s** — o que muda durante um turno é o POS, e um minuto não se nota.

Resultado medido: **6 idas no primeiro refresh, 3 nos seguintes**, e um segundo núcleo com a cache
do primeiro quente não colhe nada dela. Com o intervalo dobrado, a carga fica em cerca de um quarto.

**O esquema é do monorepo, não da TV.** As migrações passaram para `migrations/` na raiz.
A base vai ser partilhada pelas duas apps e o D1 regista o que aplicou num livro-razão
único: duas pastas contra a mesma base é possível — dando a cada uma a sua tabela de
registo — e não tem ordem relativa entre elas, nem numeração que se leia como uma história
só. O preço, assumido, é o deploy da TV deixar de se descrever inteiro dentro de
`apps/tv`. A mudança não custou reaplicações: o livro-razão indexa pelo nome do ficheiro,
sem caminho nem checksum.

**Emparelhamento e middleware verificados num televisor real.** Deixaram de ser código com
testes verdes e passaram a ser um ecrã que emparelhou, recolheu o token e mostrou o núcleo.

**Marca e tipografia.** Logótipos ligados às duas páginas, com margem de proteção derivada
da altura do "F" de FOOD em vez de um número à mão. A variante para fundo escuro saiu da
que veio da sede trocando as partes pretas por brancas — é **escolher** uma variante que o
guia prevê, não recolorir. A Inter é **auto-alojada**, subset latino, 47 KiB: sem chamada
ao Google Fonts, que é menos uma dependência externa numa box que arranca sozinha e menos
uma discussão de RGPD.

**Fronteira entre o D1 e o Odoo, redecidida.** O D1 passa a poder guardar estado
operacional que o Odoo não modela — presenças, notas, recados —, porque a PWA vai produzi-lo
e a TV vai querer mostrá-lo. A regra inteira está no [`CLAUDE.md`](../CLAUDE.md) da raiz. A
razão para não o pôr no Odoo é a mesma do resto do projeto: a estrutura é gerida por um
parceiro externo e não se lhe acrescentam modelos.

**Painel das recolhas (FA).** O segundo conteúdo da TV, com a mesma forma do primeiro: grelha
estável ordenada por número, densidade adaptativa, navegação manual, e o OK do comando a alternar
entre os dois. As diferenças vêm da operação — não há faltas, a hora é a recomendada e não o início
do intervalo, e o **nome da fonte aparece ao lado do número, do mesmo tamanho**, porque há quem
conheça a fonte pelo número e quem a conheça só pelo nome.

O nome mais comprido da base tem 55 caracteres e **nunca se corta**: sete fontes começam por
"Continente Bom Dia…" e o que as distingue está no fim. Quando não cabe, o que cede é o corpo da
letra. As notas cortam-se com reticências — lêem-se do princípio, ao contrário de um nome. **Só a
área visível refresca**: alternar é que vai buscar a outra.

**`hr.attendance` levantado, e é o que sustenta a decisão anterior.** O módulo standard de
picagem de ponto está instalado — o voluntário é um `hr.employee` — mas **não está em uso**;
as 824 linhas que tem são testes. Ver [`modelos/voluntarios.md`](modelos/voluntarios.md). O
risco de o parceiro vir a usá-lo, e de ficarem duas verdades sobre a mesma coisa, está
aceite por escrito em vez de ignorado.

**Os quilos nos ecrãs, e as observações que ninguém sabia que existiam.** Os dois painéis
mostram agora o peso no lugar do visto verde. O que decidiu a forma foi a medição:

- **O estado nunca vem dos quilos.** A regra inicial — "soma > 0 ⇒ feito" — quebrava em 92
  encomendas (0,9%) que são entregas reais com zero quilos, quase todas cabazes registados em
  unidades. Os quilos são etiqueta; quem decide a cor é a existência da encomenda e a observação.
- **Custa zero pedidos.** O `total_in_kg` está armazenado na `pos.order` e entrou nos `fields` de
  leituras que já corriam: medido, 111 ms contra 113 ms.
- **A `res.collection.route` passou a ler linhas, e não foi pelos quilos.** As Recolhas tinham
  faltas desde **2024-10-31** — 25 encomendas, 4 núcleos, 33 fontes — e o painel mostrava-as com o
  visto verde, porque este ficheiro afirmava que "não há faltas nas recolhas". A causa é o
  `limit_categories` estar a `false` nas 166 caixas: os produtos de falta sempre estiveram
  disponíveis na caixa de Recolhas. É essa correcção que custa **+1 ida ao Odoo por refresh**, o
  painel a passar de uma para duas em regime.
- **Três observações, e uma delas é positiva.** O `OBS-SEM-EXC` — "sem excedente" — significa que a
  recolha foi feita e a fonte não tinha nada: 47 encomendas, mais do dobro das faltas. Classifica-se
  pelo `default_code`, **nunca pelo nome**: em `en_US` esse produto chama-se _Falta Justificada
  (cópia)_, e uma regra por nome dava-lhe ✕ em silêncio. Lê-se a categoria toda e o desconhecido
  vale falta, para errar para o lado visível.
- **Tecto de plausibilidade por superfície, simétrico em `|kg|`:** 300 kg nas entregas, 1 500 kg nas
  recolhas. Os números saem da base — o p99 de um cartão de entrega é 113 kg; nas recolhas há um
  intervalo limpo entre 1 105 kg, o maior plausível, e 64 508 kg, o primeiro absurdo. Apanha 0,71% e
  0,05% dos cartões, e o cabeçalho passa a ter máximo de 1 136 kg e 2 293 kg em vez de 149 164.
  **O que passa do tecto é contado e dito no cabeçalho**, não escondido: um valor absurdo em
  silêncio é um erro que ninguém corrige.
- **O cabeçalho é a soma exacta dos cartões.** Arredonda-se cada valor e soma-se depois — o inverso
  fazia o ecrã discordar de quem o somasse à mão. Apanhado no primeiro turno real que se olhou:
  357 kg no cabeçalho contra 357,3 nos cartões.
- **O catálogo de POS obrigou a uma excepção no âmbito.** Os 24 produtos são globais e sem
  `company_id`: com a cláusula estrita a leitura devolve **zero de 24**. O `product.product` passa a
  usar a forma `in [empresa, false]` — a `ir.rule` que o próprio Odoo usa no `res.partner` —, com
  um teste que prende a excepção a esse modelo. É mais fraca que a estrita, e vale só porque ali não
  há nada para separar: dois núcleos recebem as mesmas 24 linhas.

**Fichas arquivadas deixaram de fazer cartão, e é regra transversal.** Um televisor mostra o
trabalho de hoje; informação histórica não aparece ali. Arquivar uma ficha apaga hoje as rotas dela,
mas antes era um processo manual e ficaram rotas penduradas em fichas que já não são da operação:
**28 rotas de 801 nas recolhas (3,5%)** e **544 de 3 252 nas entregas (16,7%)**, até **37 cartões num
único turno** em Benfica.

Nas fontes o defeito era visível — cartão com nome e com `—` no lugar do número, porque o nome vem
da rota e o número da ficha, e a ficha arquivada não voltava da leitura. **Nas famílias não era
visível de maneira nenhuma:** o número vem do `related_beneficiary_number` da própria rota, portanto
o cartão aparecia completo e indistinguível de uma família real. Foi o sintoma das fontes que
denunciou o problema das duas.

O filtro é **uma cláusula no domínio das rotas** — `['beneficiary_id.active', '=', true]` e
`['source_food_id.active', '=', true]` —, para o cartão nunca nascer. As `res.delivery.route` e
`res.collection.route` **não têm `active`**, portanto a travessia é a única forma; verificada contra
a base, as contagens fecham exactamente. As leituras de ficha passaram a pedir
`active in [true, false]` pela razão inversa: cobrem a janela entre as duas caches — rotas 5 minutos,
fichas 15 —, em que a lista em cache ainda traz uma ficha arquivada há minutos, e nesse intervalo
vale mais um cartão completo do que meio cartão.

**A língua deixou de ser propriedade do processo.** O cliente não punha `lang` no contexto e o Odoo,
nesse caso, lê em `en_US` — não na língua do utilizador. A app lia a base inteira em inglês. Agora
`lang` é **parâmetro obrigatório de cada leitura**, recusado na configuração do cliente e dentro do
`context`, porque o cliente é partilhado pelo isolate: uma língua fixada na construção seria
indiferente na TV e errada na PWA, com voluntários de línguas diferentes ao mesmo tempo. Vai também
na chave de cache. **Nas leituras que a app já fazia não mudou nada** — o único campo diferente é o
`shift_name`, de onde só se extrai a hora por regex, e a hora é idêntica nos 500 calendários.

**Os extras, e a grelha a ganhar uma segunda origem.** Entregas e recolhas podem ser feitas fora do
previsto — uma entrega extra a um beneficiário ou a um **parceiro de apoio**, uma recolha extra a
uma fonte. Até aqui **um cartão nascia sempre de uma rota** e o POS só lhe pintava o estado por
cima; um extra nasce de uma `pos.order` que não corresponde a rota nenhuma do dia. A grelha passa a
ter duas origens, e é o que já estava escrito em [`modelos/beneficiarios.md`](modelos/beneficiarios.md)
como decisão de desenho e não como consulta a mais.

Quatro coisas que a base não dá, e como se resolveram:

- **Uma encomenda não tem turno.** Tem `date_order` e mais nada — não é campo que falte, é ligação
  que o modelo não tem. O extra cai no **turno mais tardio que já tinha começado** quando foi
  registado, comparado no fuso de Lisboa. Num núcleo com um turno de entregas por dia é exacto; há
  núcleos com seis, e aí é aproximação. A alternativa — mostrar os extras do dia em todos os turnos —
  punha os mesmos quilos em dois cabeçalhos, e o total de um painel tem de ser a soma exacta do que
  está no ecrã.
- **O que é extra decide-se contra as rotas do dia inteiro**, nunca contra o turno visível: senão
  uma família servida no turno das 18:00 aparecia lá a verde e no das 20:00 como extra. A
  consequência aceite é que uma segunda entrega não combinada a quem _tem_ rota hoje soma no cartão
  dela em vez de ganhar cartão próprio — distinguir as duas encomendas exigiria saber qual
  correspondeu à rota, e nada na base o diz.
- **As entregas a parceiros de apoio deixaram de desaparecer.** São **1 220 encomendas em 10 215
  Entregas (12%)**, por 19 parceiros distintos, que até aqui não casavam com nada porque os
  parceiros de apoio não têm rotas. Passam a ter cartão, e **os quilos deles passam a contar no
  total do turno** — decisão tomada com o número à frente, não um efeito lateral.
- **Um extra não é um estado.** Está sempre _entregue_/_recolhido_ ou _falta_, nunca _por
  entregar_ — é a encomenda que o faz existir. Viaja como campo à parte do cartão, mantém a cor do
  estado, e o que o marca no ecrã é **a barra ponteada da esquerda**: a barra grossa já se lê de
  longe em qualquer cartão, e a textura distingue sem gastar cor nem espaço. Não leva hora — não
  estava na escala —, e a linha que sobra é a que o nome do parceiro de apoio ocupa.

**O nome de um parceiro de apoio aparece no televisor, e é uma excepção sobre a espécie do dado.**
Um `res.support.partner` é uma instituição que recebe alimentos — da mesma espécie que a fonte de
alimento cujo nome o painel do lado já mostra —, não uma pessoa. Sai do `name` da ficha, nunca do
`client_name` da encomenda nem do `res.partner`, e **só as duas primeiras palavras**: chega para
identificar e é o que sobra se algum dia alguém criar um parceiro que seja uma pessoa singular,
coisa que nada no modelo impede (651 dos 1 014 nem têm tipo, e o campo por onde um beneficiário
aponta ao parceiro que o acompanha diz "tipicamente a assistente social"). Vai ao lado do número
`P12`, porque duas palavras podem colidir — dois "Centro Social" lêem-se como um cartão repetido.

**A excepção do traço**, encontrada num televisor: há nomes na forma `SIGLA - Nome por extenso`, e
o corte a duas palavras dava _"ARPILF -"_ — um traço pendurado no lugar da informação. Quando a
segunda palavra é só um traço entra a terceira, e o limite de exposição aguenta-o: **o nome de uma
pessoa não leva um traço isolado em segundo lugar**, portanto a palavra a mais só se ganha em nomes
que já eram de entidade.

**Custo medido:** as recolhas ganham os extras **sem leitura nenhuma a mais** — a `res.food.source`
já era lida e a mesma consulta passou a responder às duas perguntas, com um `|` no domínio. As
entregas ganham **uma**, a `res.support.partner`, com cache longa. Nos dois painéis a ficha passou a
depender das encomendas — é o `partner_id` delas que diz quem procurar —, portanto deixou de correr
ao lado da `pos.order` e passou a correr ao lado da `pos.order.line`: **a conta dos round-trips não
muda**.

**E o que não se consegue atribuir é contado e dito no cabeçalho**, pela mesma regra do fora de
escala: são quase sempre encomendas a fichas arquivadas — que um televisor nunca mostra — e uns
quilos que desaparecem em silêncio são um erro que ninguém corrige.

### Armadilhas do Odoo já tratadas no cliente

- Responde HTTP 200 mesmo quando falha; o erro vem no corpo em `error.data.name`
- `common.authenticate` devolve `false`, não um erro, quando as credenciais falham
- Campos many2one vêm como `[id, nome]`; campos vazios como `false`, não `null`
- Datas em UTC sem indicação de fuso
- `read_group` com mais de um `groupby` exige `lazy: false` na v14

### Em aberto

| Item                                              | Notas                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conteúdo dos dashboards                           | Dois painéis feitos — entregas (BF, com os extras a BF e a PA) e recolhas (FA, com os extras a FA). O que falta decidir é se há mais para além destes dois                                                                                                                                                                                                                                                                                                                            |
| Turno de um extra em núcleos com muitos turnos    | A atribuição é pela hora do registo, e num núcleo com seis turnos no mesmo dia um registo feito depois de o seguinte abrir aparece no turno errado. Só se resolve com uma ligação encomenda→turno que a base não tem; medir se acontece antes de inventar uma                                                                                                                                                                                                                         |
| Colisão de nomes curtos de parceiros de apoio     | Duas palavras podem dar dois "Centro Social" no mesmo ecrã. O número `P12` ao lado desfaz a dúvida, e um quinto dos parceiros não tem número. São 19 parceiros em toda a base das Entregas, portanto é raro — mas não impossível                                                                                                                                                                                                                                                      |
| Utilizador técnico dedicado — **agora com prazo** | Devia ser o `apps@re-food.org`, que **ainda não existe**; em uso está a conta pessoal. Deixou de ser dívida sem consequência: a PWA vai para produção em `myrefood.pt` e lê o Odoo de produção com esta conta. A conta nova tem de nascer com o `company_ids` completo, ou passa a haver núcleos que nenhuma app lê                                                                                                                                                                   |
| Três empresas fora do `company_ids`               | Nenhuma é núcleo em operação, mas uma segue a convenção de nome e está pendurada na empresa-mãe. Saber se é uma casca a provisionar — e nesse dia entra no `company_ids` antes de entrar em serviço                                                                                                                                                                                                                                                                                   |
| Retenção do estado operacional no D1              | Presenças, notas e recados são registos sobre pessoas, mesmo referenciadas por código. Falta decidir quanto tempo vivem, quem os apaga, e o que acontece quando a ficha passa a `active = false` no Odoo                                                                                                                                                                                                                                                                              |
| Retenção dos quilos fora de escala                | O ecrã diz que existem e não os soma, mas ninguém é avisado fora do ecrã. Corrigir um registo absurdo depende de alguém estar à frente do televisor naquele dia — a vista de monitorização é o sítio natural para isto                                                                                                                                                                                                                                                                |
| Densidade do cartão com o peso                    | `15 kg` é ~4× mais largo que o `✓` que substituiu, e nas densidades cheias rouba largura ao nome. A grelha transborda em vez de cortar, portanto vê-se num ecrã de teste — mas os degraus não foram reavaliados num televisor real                                                                                                                                                                                                                                                    |
| Voluntário sem `barcode`                          | A regra manda referenciar uma pessoa por ele, e está preenchido em praticamente todas as fichas — não em todas                                                                                                                                                                                                                                                                                                                                                                        |
| Nº do KIT do beneficiário                         | **Decidido: vai para o D1**, com `company_id` e o `id` da ficha — nem todos os beneficiários têm, e quem não tem não tem linha. Por fazer. O Odoo não modela um identificador de conjunto (o que o `refood_pos` tem são contagens de caixas por entrega, no `res.partner`), e os campos vazios da ficha que serviriam — `website`, `comment` — não estão livres, estão só por preencher                                                                                               |
| Logótipo sem assinatura                           | O ficheiro que a sede deu é a variante **com** assinatura, e a 480px ela mede uns 21px de altura, abaixo do chão de 32px de um televisor. Está pedida no [`design.md`](design.md)                                                                                                                                                                                                                                                                                                     |
| Segredo da sede em staging                        | O `ADMIN_SECRET` ainda não está posto, portanto a página de aprovação está publicada e ninguém entra nela                                                                                                                                                                                                                                                                                                                                                                             |
| Domínio de produção                               | **Decidido para a PWA:** o apex `myrefood.pt`, com `custom_domain` — o apex está vazio, a zona tem só o `tv-staging`, e o wrangler cria registo e certificado no primeiro deploy. Fica lá em permanência. Para a **TV**, `myrefood.pt` continua a ser staging permanente e o endereço definitivo continua por decidir, dependente de terceiros                                                                                                                                        |
| Autenticação dos voluntários                      | Link mágico por email é a via preferida                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Vista de monitorização                            | O sinal de vida já é escrito; falta a vista com semáforo por núcleo — e é ela que há-de revogar sozinha os dispositivos que nunca deram sinal                                                                                                                                                                                                                                                                                                                                         |
| Escolha do núcleo na sede                         | Resolvido o que era grave — a lista já não oferece empresas que a app não lê. Fica o resto: o estado "aberto" de um `<select>` nativo não é observável pelo JavaScript, a proteção actual é por sinais indirectos, e se não chegar a saída é um componente próprio, ao preço da acessibilidade que o nativo dá de graça                                                                                                                                                               |
| Levantamento feito noutra base                    | O levantamento todo — modelos, campos, armadilhas e contagens — é da base de staging (`refoodteste`), e a PWA em produção lê a `refood`, no `erp.onrefood.com`. Nenhuma das duas apps depende de uma contagem para funcionar, mas os números escritos nos documentos descrevem staging e não a base que os voluntários têm à frente: o "um em catorze sem NIF utilizável" é dali, não daqui. Repetir o levantamento contra produção antes de dimensionar o que quer que seja com eles |
| Primeira ida a produção                           | Nenhuma migração aplicada e nada publicado. É decisão à parte, não consequência de staging estar verde                                                                                                                                                                                                                                                                                                                                                                                |

---

## 6. Notas operacionais

**Instalação nos 65 locais** é o maior custo do projeto, e é de logística, não técnico.
O emparelhamento por código curto foi desenhado para que alguém sem formação técnica
consiga instalar com uma chamada telefónica.

**Monitorização.** Com 65 ecrãs, ninguém repara que um morreu. Cada televisor deve enviar
um sinal de vida periódico, e a sede deve ter uma vista com semáforo por núcleo.

**Arranque automático.** Os ecrãs desligam-se todas as noites, portanto a app tem de
arrancar sozinha com o sistema. Sem isto, alguém tem de ir a cada sala.

**URL configurável.** Mesmo conhecendo o domínio final, o endereço da API deve ser
alterável no dispositivo, para permitir apontar uma box a staging sem reinstalar o APK.

**Nomes nos ecrãs.** Os televisores são o ponto mais exposto do sistema. Primeiro nome e
inicial do apelido chegam para reconhecer alguém e reduzem o que um token comprometido
revela.
