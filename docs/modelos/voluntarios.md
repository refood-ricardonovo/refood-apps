# Voluntários

`hr.employee` e os modelos que lhe estão pendurados: `res.shift.log`, `hr.attendance`, `hr.job`,
`hr.employee.category`, `refood.custom.tags`, `res.functional.team`, `res.executive.team` e
`hr.employee.executive.line`. Índice e convenções transversais em
[`../modelos-odoo.md`](../modelos-odoo.md).

> **Levantado em `en_US` — não confiar nos nomes.** O `explorar.ts` corria sem `lang` no contexto,
> e nesse caso o Odoo **não** usa a língua do utilizador: cai no `en_US`. As etiquetas de campo e os
> valores de campos traduzidos que aqui aparecem são portanto os ingleses — onde este documento diz
> _Center_, quem trabalha no Odoo vê _Núcleo_. **A estrutura, os tipos, as relações e as contagens
> não são afectados.** O `explorar.ts` passou a ler em `pt_PT` e a imprimir a língua no cabeçalho
> (`--lingua`); quando este levantamento for repetido, os nomes passam a ser os que as pessoas vêem.

---

## `hr.employee` — o voluntário

Modelo standard do Odoo (`hr`), e o mais estendido da base: 142 campos, vindos de `hr`,
`hr_attendance`, `hr_gamification`, `hr_fleet`, `hr_org_chart`, `pos_hr`, `portal`, `sms`,
`refood`, `refood_custom_tags` e `refood_survey`.

**Na Refood um `hr.employee` é um voluntário, não um empregado.** A customização assume-o até na
etiqueta do campo `name`, que é _Volunteer Name_. Toda a estrutura de recursos humanos do Odoo —
salários, subordinados, veículos, picagem de ponto — continua lá por baixo, quase toda por usar.

Em staging (setembro de 2026) são **13 927 registos, dos quais só 5 772 ativos**: mais de metade
está arquivada e **não aparece nas pesquisas por omissão**.

### Identidade e nome

| Campo             | Tipo    | Módulo         | Notas                                                         |
| ----------------- | ------- | -------------- | ------------------------------------------------------------- |
| `name`            | char    | `hr`, `refood` | Nome **abreviado**. Não é obrigatório no Odoo                 |
| `full_name`       | char    | `refood`       | Nome completo. Vazio em cerca de 430 dos ativos               |
| `display_name`    | char    |                | Calculado, não armazenado — espelha o `name`                  |
| `barcode`         | char    | `hr`, `refood` | **O código único da ficha**; preenchido em praticamente todas |
| `sequence_prefix` | char    | `refood`       | País, núcleo e tipo de ficha                                  |
| `sequence_number` | integer | `refood`       | Contador dentro do prefixo                                    |

O `barcode` é o **código único da ficha**, e é a identificação a usar: o `id` do Odoo é interno e o
nome não é único. Compõe-se do `sequence_prefix` seguido do `sequence_number` a **seis dígitos com
zeros à esquerda**.

O prefixo tem três partes — `PT`, três letras do núcleo, e `_XX` para o **tipo de ficha**:

| Sufixo | Tipo de ficha       |
| ------ | ------------------- |
| `_VL`  | Voluntários         |
| `_BF`  | Beneficiários       |
| `_FA`  | Fontes de Alimentos |
| `_PA`  | Parceiros de Apoio  |

Os outros três tipos vivem noutros módulos, e não em `hr.employee`: aqui só aparecem fichas `_VL`
(uma única exceção em toda a base ativa). O sufixo é, ainda assim, a razão pela qual não se pode
assumir que um código com este formato é de um voluntário.

**O `name` não está garantidamente abreviado.** O `full_name` é posterior: no início existia só o
`name`, que era o nome completo, e a distinção entre nome completo e nome abreviado só apareceu
depois. Os registos criados antes ficaram como estavam, e por isso em muitos deles o `name` traz o
nome completo — por vezes exatamente igual ao `full_name`. Não é um dado corrompido, é a idade do
registo.

Consequência: **nenhuma app pode assumir que o `name` já vem abreviado.** Quem precise de um nome
curto tem de o derivar, e o `full_name` — quando está preenchido — é a fonte mais fiável para isso.

### Âmbito, estado e datas

| Campo                                                           | Tipo                           | Módulo   | Notas                                                              |
| --------------------------------------------------------------- | ------------------------------ | -------- | ------------------------------------------------------------------ |
| `company_id`                                                    | many2one → `res.company`       | `hr`     | O núcleo. **Obrigatório**, ao contrário do que acontece nos turnos |
| `active`                                                        | boolean                        | `hr`     | Arquivamento. **8 155 registos arquivados** em staging             |
| `signup_date`                                                   | date                           | `refood` | Data de inscrição; preenchida em toda a base ativa                 |
| `departure_date` / `departure_reason` / `departure_description` | date, selection, text          | `hr`     | Saída. Praticamente por usar: 22 registos, todos arquivados        |
| `date`                                                          | date                           | `refood` | **Abandonado.** Deixou de ser usado; zero registos preenchidos     |
| `create_date` / `write_date`                                    | datetime                       | `hr`     | Auditoria                                                          |
| `resource_id`                                                   | many2one → `resource.resource` | `hr`     | **Obrigatório**; o recurso que o Odoo cria com cada ficha          |

Arquivar não é o mesmo que registar uma saída: os 8 155 arquivados quase não têm `departure_date`.
Quem quiser saber se alguém deixou de ser voluntário olha para o `active`, não para as datas de
saída.

### Turnos e disponibilidade

Os dois vínculos descritos em [`turnos.md`](turnos.md) vivem aqui, e há ainda um campo que se
parece com eles e não é:

| Campo                       | Tipo                                    | Módulo   | Significado                                                                                                                                      |
| --------------------------- | --------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `resource_calendar_ids`     | many2many → `resource.calendar`         | `refood` | **Inscrição** nos turnos. É o outro lado do `employee_ids` do turno — a mesma relação, vista da ficha                                            |
| `calendar_availability_ids` | many2many → `res.calendar.availability` | `refood` | **Disponibilidade** declarada no formulário online. Não aponta para o turno, mas para o registo espelho                                          |
| `shift_ids`                 | one2many → `res.shift.log`              | `refood` | Histórico das inscrições, com datas                                                                                                              |
| `resource_calendar_id`      | many2one → `resource.calendar`          | `hr`     | **Horário de trabalho standard do Odoo — não é um turno.** Aponta para os calendários `Standard 40 hours/week` e não tem significado na operação |

Cerca de 3 960 dos ativos têm pelo menos uma inscrição, 1 880 pelo menos uma disponibilidade
declarada e 4 100 pelo menos uma linha de histórico.

O `resource_calendar_id` no singular é a armadilha desta secção: tem quase o mesmo nome do campo
das inscrições, está preenchido em toda a base porque o Odoo lhe dá um valor por omissão, e não
quer dizer nada.

### Contactos e dados pessoais

A Refood acrescentou campos de contacto **em vez de** usar os do Odoo, e ambos coexistem:

| Campo                                        | Tipo                     | Módulo   | Notas                                                                 |
| -------------------------------------------- | ------------------------ | -------- | --------------------------------------------------------------------- |
| `hr_email`                                   | char                     | `refood` | O email que a operação usa; preenchido em cerca de 5 365 ativos       |
| `hr_phone` / `hr_mobile`                     | char                     | `refood` | Telefone e telemóvel usados                                           |
| `work_email` / `work_phone` / `mobile_phone` | char                     | `hr`     | Equivalentes standard, quase vazios (uns 386)                         |
| `private_email` / `phone`                    | char                     | `hr`     | Standard, **calculados e não armazenados** — vêm do `address_home_id` |
| `address_home_id` / `address_id`             | many2one → `res.partner` | `hr`     | Morada pessoal e morada de trabalho                                   |
| `emergency_contact` / `emergency_phone`      | char                     | `hr`     | Contacto de emergência                                                |

Além destes, a ficha guarda **dados pessoais sensíveis** que nenhuma app tem razão para ler:
`birthday`, `gender`, `marital` e `marital_status_id`, `children`, `spouse_complete_name`,
`spouse_birthdate`, `place_of_birth`, `country_of_birth`, `country_id`, `identification_id` e
`identification_expiration_date`, `passport_id` e `passport_expiration_date`, `vat`, `ssnid`,
`sinid`, `permit_no`, `visa_no`, `visa_expire`, `bank_account_id`, `km_home_work`, `study_school`,
`study_field`, `certificate`, `pin`, `mobility_card`, e as cinco resoluções de `image_*`.

Um `search_read` sem `fields` explícito traz isto tudo. Que campos é que cada app pode ler, e o que
pode mostrar, é decisão de cada app — aqui fica só o aviso de que estão na mesma tabela que o resto.

Dois destes campos não são acessórios, ao contrário do que o nome standard sugere:

- **`vat` — o NIF — é obrigatório na prática**, por causa do seguro de voluntário, e é o campo que
  serve para **detetar registos duplicados**. O Odoo não o marca como obrigatório (está preenchido
  em 5 389 fichas ativas), mas uma ficha sem ele é uma ficha incompleta.
- **`mobility_card` é o número da carta de condução** e `fleet_expiration_date` a sua validade,
  apesar de o primeiro vir do módulo de frota do Odoo e o segundo se chamar
  _M. Card expiration Date_. Não têm nada a ver com cartões de transporte.

### Consentimentos da inscrição

Cinco booleans da Refood, à volta de metade da base ativa em cada um. **Não são vinculativos para
nenhuma app**: são a prova de que, na inscrição online, o voluntário tomou conhecimento das regras.
Nenhuma app tem de os consultar antes de fazer o que quer que seja — não são um interruptor de
permissões.

| Campo                   | O que o voluntário declara ou autoriza                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `privacy_policy`        | Que lhe foi entregue a Política de Privacidade do núcleo, que leu e compreendeu as condições para integrar o projeto, e que concorda com ela    |
| `rgpd_data_policy`      | O tratamento dos seus dados pessoais na qualidade de voluntário, ao abrigo do artigo 13.º do RGPD                                               |
| `image_policy`          | A publicação, nas redes sociais e na comunicação social, de fotografias e imagens das atividades em que participe e onde apareça                |
| `email_policy`          | O uso do seu email para a Refood lhe enviar informação sobre as atividades e projetos                                                           |
| `rgpd_volunteer_rights` | Que foi informado dos artigos 13.º a 22.º do RGPD — cancelar o consentimento, opor-se ao tratamento, acesso, oposição, retificação e apagamento |

São **booleans**: `false` quer dizer "não assinalou" e é um valor legítimo, não "sem valor" — não
passar pelo `nullable` do `packages/odoo`.

### Papéis, equipas e etiquetas

| Campo                                  | Tipo                                    | Módulo               | Notas                                                      |
| -------------------------------------- | --------------------------------------- | -------------------- | ---------------------------------------------------------- |
| `job_id`                               | many2one → `hr.job`                     | `hr`                 | O papel do voluntário. Preenchido em cerca de 4 960 ativos |
| `department_id`                        | many2one → `hr.department`              | `hr`                 | Standard, por usar                                         |
| `functional_team_ids`                  | many2many → `res.functional.team`       | `refood`             | Equipas funcionais; uns 670 ativos                         |
| `executive_team_ids`                   | many2many → `res.executive.team`        | `refood`             | Equipas executivas; uns 24 ativos                          |
| `hr_executive_line_ids`                | one2many → `hr.employee.executive.line` | `refood`             | Linhas que ligam voluntário a equipa executiva             |
| `category_ids`                         | many2many → `hr.employee.category`      | `hr`, `refood`       | Etiquetas standard do Odoo; uns 1 530 ativos               |
| `refood_tag_ids`                       | many2many → `refood.custom.tags`        | `refood_custom_tags` | Etiquetas por empresa; uns 10 ativos                       |
| `parent_id` / `coach_id` / `child_ids` | many2one, one2many → `hr.employee`      | `hr`                 | Hierarquia standard, por usar                              |

Há **dois sistemas de etiquetas** em paralelo, e não são o mesmo: as `category_ids` são as do
Odoo, globais; as `refood_tag_ids` são da Refood e têm `company_id` obrigatório.

#### Os três papéis

O `job_id` aponta para `hr.job`, que na base toda tem **três registos**, sem `company_id` — os
papéis são nacionais, não por núcleo:

| Papel                      | `is_manager` |
| -------------------------- | ------------ |
| Voluntário                 | `false`      |
| Voluntário Gestor          | `true`       |
| Voluntário Gestor de Turno | `true`       |

O `is_manager` é o que separa os dois níveis, e é ele que decide duas coisas:

- **Quem pode ser gestor de um turno.** Os dois papéis com `is_manager` são os que aparecem na
  lista de escolha do `shift_manager_id` do turno (ver [`turnos.md`](turnos.md)).
- **A quem se pode atribuir uma equipa.** Só o _Voluntário Gestor_ — o gestor que não é de turno —
  é que recebe equipas funcionais ou executivas.

#### As duas equipas

`res.functional.team` e `res.executive.team` são **equipas de trabalho**, e a diferença entre elas é
de alcance:

- **Funcionais** — ao nível do núcleo local.
- **Executivas** — nacionais.

Em ambas, o responsável é o `manager_id` da equipa, e os membros o `member_ids`; do lado da ficha
vêem-se em `functional_team_ids` e `executive_team_ids`.

### Sócio, veículos, carta de condução e observações

| Campo                   | Tipo    | Módulo     | Significado                                                                                                                                                          |
| ----------------------- | ------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `has_membership`        | boolean | `refood`   | **O voluntário é sócio da associação.** É para isso que serve, mas a gestão de sócios ainda não está a ser feita por aqui: `true` em um único registo de toda a base |
| `own_vehicle`           | boolean | `refood`   | Tem veículo próprio, para o caso de ser preciso usá-lo. 1 430 ativos                                                                                                 |
| `refood_vehicle`        | boolean | `refood`   | Está disponível para conduzir o carro do núcleo. 1 159 ativos                                                                                                        |
| `mobility_card`         | char    | `hr_fleet` | **Número da carta de condução.** 2 165 ativos                                                                                                                        |
| `fleet_expiration_date` | date    | `refood`   | Validade da carta de condução                                                                                                                                        |
| `employee_notes`        | char    | `refood`   | Observações. 1 533 ativos                                                                                                                                            |

Os dois campos de veículo respondem a perguntas diferentes — _tem carro_ e _conduz o do núcleo_ — e
não se substituem um ao outro.

O `employee_notes` é o campo de observações que está a ser usado. Os dois standard do Odoo com a
mesma vocação — `notes` (text) e `additional_note` (text) — estão **a zero em toda a base**.

### Campos de módulos que não pertencem ao domínio

Ficam aqui nomeados só para se saberem ignorar: `attendance_ids`, `attendance_state`,
`last_check_in`, `last_check_out`, `hours_today`, `hours_last_month*` e `last_attendance_id` são do
`hr_attendance` — picagem de ponto, módulo instalado mas **fora de uso**, com 824 linhas de teste,
levantadas em [`hr.attendance`](#hrattendance--picagem-de-ponto-standard-e-fora-de-uso) mais abaixo; `badge_ids`, `direct_badge_ids`, `goal_ids` e
`has_badges` são gamificação; `employee_cars_count` é frota; `certifications_count` é do
`refood_survey`; e todo o bloco `message_*`, `activity_*` e `website_message_ids` é o chatter do
Odoo.

**Estado civil está duplicado, e o campo a ler é o `marital_status_id`** (many2one →
`res.marital.status`, `refood`, 693 preenchidos): é esse que está no formulário. O `marital`
standard do Odoo (selection, `hr`) tem mais registos preenchidos — 3 928 — mas o mais provável é
ter sido duplicado por engano, quando o campo pareceu estar em falta.

### Consequências para quem lê estes dados

- **Mais de metade da base está arquivada.** Isso é o que se quer por omissão, mas contar
  voluntários sem perceber que `active = false` os exclui dá números errados sem nenhum aviso.
- **O `name` pode ser o nome completo** — ver acima. Um nome curto tem de ser derivado, não lido.
- **Pedir sempre `fields` explícito.** Um registo completo traz dados pessoais sensíveis e cinco
  resoluções de imagem em base64, que pesam megabytes por registo.
- **Não filtrar nem ordenar por campos não armazenados**: `display_name`, `private_email`, `phone`,
  `tz`, `is_address_home_a_company`, `hr_presence_state`, `hr_icon_display` e todos os contadores
  do chatter.
- **`company_id` é obrigatório aqui**, ao contrário do `resource.calendar`: uma ficha sem núcleo não
  existe.
- **É a maior tabela que as apps vão ler.** Qualquer listagem precisa de domínio apertado e `limit`.
- **O email da operação é o `hr_email`, não o `work_email`**: o campo standard está vazio em
  praticamente toda a base.

---

## `res.shift.log` — histórico de inscrição em turnos

Modelo da Refood, alcançado por `shift_ids`. Uma linha por cada vez que um voluntário entrou num
turno, com as datas. 10 655 registos em staging.

| Campo                                                     | Tipo     | Relação             | Notas                                                              |
| --------------------------------------------------------- | -------- | ------------------- | ------------------------------------------------------------------ |
| `employee_id`                                             | many2one | `hr.employee`       | O voluntário                                                       |
| `resource_calendar_id`                                    | many2one | `resource.calendar` | O turno                                                            |
| `start_date`                                              | date     |                     | Data em que começou a fazer aquele turno                           |
| `end_date`                                                | date     |                     | Data em que **deixou de fazer aquele turno**; vazio enquanto o faz |
| `name`                                                    | char     |                     | Vazio em toda a amostra                                            |
| `create_uid` / `write_uid` / `create_date` / `write_date` |          |                     | Auditoria                                                          |

**O `end_date` é por turno, não pela pessoa.** Um voluntário com `end_date` preenchido numa linha
pode continuar noutros turnos, e pode continuar voluntário sem ter turno nenhum atribuído. Quem
quiser saber se alguém ainda é voluntário olha para o `active` da ficha — nunca para este histórico.

**Não tem `company_id`.** O âmbito por núcleo tem de vir do `employee_id` ou do
`resource_calendar_id`: quem precisar de o restringir parte do voluntário ou do turno, e não deste
modelo.

Nenhum dos dois many2one é obrigatório, e nada na base garante que o voluntário e o turno de uma
linha pertençam ao mesmo núcleo.

---

## `hr.attendance` — picagem de ponto, standard, e fora de uso

Modelo standard do módulo `hr_attendance`, instalado porque o voluntário é um `hr.employee`.
Levantado em setembro de 2026 para responder a uma pergunta concreta: **existe no Odoo o registo
de comparência de um voluntário num dia?** O `res.shift.log` acima não serve — é inscrição no
turno, não presença.

**A resposta curta: o modelo existe, está instalado e não está em uso.** As 824 linhas que tem são
testes. O detalhe está abaixo, porque a diferença entre "não existe" e "existe e ninguém usa" muda
o que se pode construir por cima — e porque a forma como as linhas se distribuem é o que sustenta a
conclusão, em vez de a fazer depender de quem a escreveu.

### Estrutura

Doze campos, **todos do módulo `hr_attendance`**. Zero customização da Refood — o contraste com o
`hr.employee` ao lado, que tem 142 campos vindos de dez módulos, diz sozinho que ninguém pegou
nisto para o adaptar à operação.

| Campo                                                     | Tipo                       | Obr.    | Armazenado | Notas                                                            |
| --------------------------------------------------------- | -------------------------- | ------- | ---------- | ---------------------------------------------------------------- |
| `employee_id`                                             | many2one → `hr.employee`   | **sim** | sim        | O voluntário. É por aqui que se chega ao núcleo                  |
| `check_in`                                                | datetime                   | **sim** | sim        | Entrada                                                          |
| `check_out`                                               | datetime                   |         | sim        | Saída. Vazio enquanto a sessão está aberta                       |
| `worked_hours`                                            | float                      |         | **sim**    | Calculado do par, mas armazenado — entra em domínio e em `order` |
| `department_id`                                           | many2one → `hr.department` |         | **não**    | Relacionado, não armazenado: ler, sim; filtrar ou ordenar, não   |
| `display_name`, `__last_update`                           |                            |         | não        | Calculados                                                       |
| `create_uid` / `write_uid` / `create_date` / `write_date` |                            |         | sim        | Auditoria                                                        |

**Não tem `company_id`** — a mesma armadilha do `res.shift.log`. O âmbito por núcleo só pode vir do
`employee_id`, e nada na base garante coerência entre os dois.

### O que está lá dentro

824 registos, de janeiro de 2022 a janeiro de 2026. A distribuição é a de um módulo que ninguém
adotou — gente a experimentar, em sítios e alturas diferentes:

- **654 (79%) pertencem a um único núcleo**, num bloco de onze meses — maio de 2024 a março de
  2025 — e foram **todos criados pelo mesmo utilizador**. A partir de abril de 2025 esse núcleo tem
  4 linhas ao todo.
- **As outras 170 espalham-se por 38 núcleos**, com mediana de 2 linhas cada; onze desses núcleos
  têm uma linha só.
- **184 voluntários distintos** de cerca de 7 200 — 2,5%. Quarenta e cinco dessas fichas já estão
  arquivadas.
- **São mesmo voluntários**, não pessoal: 183 das 184 fichas têm o sufixo `_VL` no
  `sequence_prefix`.

### E os números não são de confiança

Só 417 das 824 linhas caem entre as 2 e as 4 horas, que é a duração plausível de um turno. O resto:

| `worked_hours`  | Linhas |
| --------------- | ------ |
| 0               | 56     |
| < 2 h           | 331    |
| 2 – 4 h         | 417    |
| 4 – 8 h         | 1      |
| 8 – 24 h        | 3      |
| 24 h – 1 semana | 6      |
| > 1 semana      | 10     |

**52 linhas nunca tiveram `check_out`** — sessões abertas, algumas há anos, e são essas que dão a
maioria dos zeros. E as dez acima de uma semana carregam sozinhas quase todo o total de 23 604
horas do modelo. Somar, mediar ou representar isto num gráfico é publicar ruído.

### Não está fechado por contexto — mas a verificação tem uma armadilha própria

Respondeu 824 com e sem `allowed_company_ids`, portanto **não é um caso como o `res.beneficiary`**:
o que se vê é o que lá está.

A armadilha apareceu na própria verificação. Passar em `allowed_company_ids` **os 87 ids de
`res.company`** devolve `AccessError: Access to unauthorized or invalid companies` — o utilizador
de integração tem **84 das 87** empresas no seu `company_ids`. O contexto tem de se construir a
partir do `company_ids` do utilizador, nunca de uma leitura de `res.company`. Quais são as três, e
se são núcleos ou entidades de outra natureza, ficou por apurar.

### O que isto significa para quem vai construir

- **Não há série histórica de presenças que valha a pena ler.** O módulo não está em uso e o que
  lá está são testes, com os valores no estado acima.
- **Mas o modelo existe e está instalado**, e é onde uma presença naturalmente cairia se alguém do
  lado do Odoo decidisse retomá-la. Quem escrever presenças fora do Odoo assume esse risco de
  divergência de propósito, e a decisão deve ficar escrita.
- **Se um dia se ler daqui**, o âmbito vem do `employee_id`, o `department_id` não entra num
  domínio, e nenhum total sai deste modelo sem proteção contra as sessões por fechar.

---

## Satélites

Modelos pequenos, alcançados a partir da ficha. Estrutura essencial; nenhum deles está a ser usado
a fundo em staging.

### `hr.job` — o papel

Standard do `hr`, com `job_abreviation` e `is_manager` acrescentados. Tem `name` (obrigatório),
`state` (`recruit` / `open`, obrigatório), `company_id`, `department_id`, `employee_ids`, e os
contadores de recrutamento do Odoo (`no_of_employee`, `expected_employees`, …), que aqui não
querem dizer nada.

São **três registos, globais** (`company_id` vazio) — os três papéis descritos acima. O campo que
conta é o `is_manager`; o `state` está `recruit` num deles e `open` nos outros dois, sem que isso
signifique nada na operação.

### `hr.employee.category` — etiquetas standard

`name` (obrigatório), `color`, `employee_ids`, e um `is_signup` acrescentado pela Refood. São 18
etiquetas, **sem `company_id`**: estas são globais. O `is_signup` está a `true` numa única delas e
não aparece nas vistas — provavelmente marca a etiqueta atribuída na inscrição online, mas isso
está por confirmar.

### `refood.custom.tags` — etiquetas da Refood

`name`, `color`, **`company_id` obrigatório**, e `model_name` / `model_table_id` (→
`refood.custom.tags.model.table`), que dizem a que modelo a etiqueta se aplica — o modelo é
genérico, não é só de voluntários.

### `res.functional.team` e `res.executive.team` — equipas de trabalho

Dois modelos com a mesma estrutura: `name` (obrigatório), `complete_name`, `parent_id` /
`child_ids` (hierarquia), `manager_id` e `member_ids` (→ `hr.employee`), `jobs_ids` (→ `hr.job`),
`company_id`, `email`, `note`, `active` e `color`. As funcionais são do núcleo local, as executivas
são nacionais; o responsável de qualquer delas é o `manager_id`.

O funcional tem ainda dois campos que o executivo não tem, `is_volunteer` e `is_beneficiary`:
**não estão nas vistas e não são necessários.** Ignorar.

### `hr.employee.executive.line`

Liga voluntário a equipa executiva: `volunteer_id` (→ `hr.employee`), `executive_team_id` (→
`res.executive.team`), `is_representative`, `company_id`, e os dois campos de nome desnormalizados
`volunteer_name` e `executive_team_name`.

O `is_representative` **parece ser código morto**: quem representa a equipa é o `manager_id` da
própria equipa, e não há nada que aponte para este campo ser usado.

---

## Pontos em aberto

Nenhum dos campos acrescentados pela Refood tem texto de ajuda no Odoo: os significados escritos
acima foram confirmados com a equipa em setembro de 2026, e este documento é a única fonte deles.
Ficou por confirmar o seguinte.

- **`is_signup` em `hr.employee.category`** — existe no modelo (módulo `refood`, boolean) e está a
  `true` numa das 18 etiquetas, mas **não aparece nas vistas**, o que explica não se dar por ele.
  Saber se é o que marca a etiqueta atribuída na inscrição online, ou se é código morto.
- **`is_representative` em `hr.employee.executive.line`** — provavelmente já não usado, uma vez que
  o representante da equipa é o `manager_id` dela. Confirmar antes de assumir isso.
- **O `name` do `res.shift.log`** está vazio em toda a amostra — saber se é para preencher.
- **`res.shift.log` não tem `company_id`** — confirmar se se pode assumir que o voluntário e o turno
  de uma linha são sempre do mesmo núcleo, ou se quem lê tem de validar os dois.
- **As três empresas fora do `company_ids` do utilizador de integração** — são 84 das 87 em
  `res.company`. Saber quais são as três e se alguma é núcleo: se for, há dados que nenhuma app
  consegue ler.
- **`refood_survey`** — o `certifications_count` aponta para um módulo de inquéritos e certificações
  que ainda não foi levantado.
- **`identification_expiration_date`** — campo da Refood ao lado do `identification_id` standard;
  confirmar se é a validade do documento de identificação, por analogia com o par da carta de
  condução.

E dois campos standard do Odoo que ficaram a apanhar dados sem que a operação os tenha pedido, e
que convém decidir se são para manter: o `marital` (duplicado pelo `marital_status_id`) e o
`resource_calendar_id` (o horário de trabalho, que o Odoo preenche por omissão).
