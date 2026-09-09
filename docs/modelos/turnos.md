# Turnos

`resource.calendar`, `resource.calendar.attendance`, `res.calendar.availability` e
`resource.calendar.leaves`. Índice e convenções transversais em [`../modelos-odoo.md`](../modelos-odoo.md).

> **Levantado em `en_US` — não confiar nos nomes.** O `explorar.ts` corria sem `lang` no contexto,
> e nesse caso o Odoo **não** usa a língua do utilizador: cai no `en_US`. As etiquetas de campo e os
> valores de campos traduzidos que aqui aparecem são portanto os ingleses — onde este documento diz
> _Center_, quem trabalha no Odoo vê _Núcleo_. **A estrutura, os tipos, as relações e as contagens
> não são afectados.** O `explorar.ts` passou a ler em `pt_PT` e a imprimir a língua no cabeçalho
> (`--lingua`); quando este levantamento for repetido, os nomes passam a ser os que as pessoas vêem.

---

## `resource.calendar` — o turno

Modelo standard do Odoo (`resource`), estendido pelos módulos `refood` e `refood_custom_views`.
É aqui que vivem os **turnos** da operação: os campos de voluntários e de gestor de turno foram
acrescentados a este modelo, em vez de num modelo `refood.*` próprio.

**Na realidade da Refood não existe o conceito de horário de trabalho.** Os calendários standard
que estão na base (uns 58, com nomes do género `Standard 40 hours/week`) vêm de uma interpretação
inicial que entretanto mudou, e ficaram — não são turnos, mas também não são lixo a limpar: fazem
parte do que lá está. Reconhecem-se por terem o `shift_name` vazio, campo que é calculado e não
armazenado e portanto **não serve para os excluir num domínio** — quem os quiser deixar de fora
precisa de outro critério (ver _Pontos em aberto_).

Um turno é, portanto, um `resource.calendar` — mas o horário concreto vive nas linhas
`attendance_ids`, não neste registo.

### Campos do módulo `resource` (standard)

| Campo                        | Tipo      | Relação                        | Notas                                                                          |
| ---------------------------- | --------- | ------------------------------ | ------------------------------------------------------------------------------ |
| `id`                         | integer   |                                |                                                                                |
| `name`                       | char      |                                | **Obrigatório**                                                                |
| `active`                     | boolean   |                                | Arquivamento: os registos com `false` ficam **fora das pesquisas por omissão** |
| `company_id`                 | many2one  | `res.company`                  | O núcleo. Não é obrigatório no Odoo — pode vir vazio                           |
| `tz`                         | selection |                                | **Obrigatório**; fuso em que as horas das linhas são interpretadas             |
| `hours_per_day`              | float     |                                | Média de horas por dia                                                         |
| `two_weeks_calendar`         | boolean   |                                | Calendário alternado em duas semanas                                           |
| `two_weeks_explanation`      | char      |                                | Calculado, não armazenado                                                      |
| `attendance_ids`             | one2many  | `resource.calendar.attendance` | As linhas de horário                                                           |
| `leave_ids`                  | one2many  | `resource.calendar.leaves`     | Ausências                                                                      |
| `global_leave_ids`           | one2many  | `resource.calendar.leaves`     | Ausências globais do calendário                                                |
| `create_uid` / `write_uid`   | many2one  | `res.users`                    | Auditoria, só leitura                                                          |
| `create_date` / `write_date` | datetime  |                                | Auditoria, só leitura                                                          |
| `display_name`               | char      |                                | Calculado, não armazenado — **não pesquisável nem ordenável**                  |

### Campos acrescentados pelos módulos `refood`

| Campo                      | Tipo      | Relação                     | Módulo                | Significado                                                                       |
| -------------------------- | --------- | --------------------------- | --------------------- | --------------------------------------------------------------------------------- |
| `show_shift`               | boolean   |                             | `refood`              | O turno aparece no formulário online onde o voluntário indica disponibilidade     |
| `shift_manager_id`         | many2one  | `hr.employee`               | `refood`              | Gestor do turno. Pode estar vazio; só voluntários com papel de gestor o podem ser |
| `employee_ids`             | many2many | `hr.employee`               | `refood`              | Voluntários inscritos no turno                                                    |
| `calendar_availability_id` | many2one  | `res.calendar.availability` | `refood`              | A disponibilidade correspondente a este turno                                     |
| `shift_name`               | char      |                             | `refood`              | Nome legível do turno, calculado da 1.ª linha de horário; não armazenado          |
| `ideal_volunteers`         | integer   |                             | `refood_custom_views` | Número ideal de voluntários no turno                                              |
| `min_volunteers`           | integer   |                             | `refood_custom_views` | Mínimo                                                                            |
| `max_volunteers`           | integer   |                             | `refood_custom_views` | Máximo                                                                            |

Nenhum destes campos tem texto de ajuda (`help`) no Odoo; os significados acima foram confirmados
com a Refood em setembro de 2026 e este documento é a única fonte deles.

Sobre os três `*_volunteers`: **zero — ou por definir, que na base é o mesmo — significa "sem
limite"**, não "nenhum voluntário". São parâmetros de dimensionamento do turno, para vir a montar
escalas a partir das inscrições e das disponibilidades; não contam ninguém e não representam
ocupação. Em staging estão por preencher na esmagadora maioria dos turnos.

### Consequências para quem lê estes dados

- **`company_id` é o núcleo.** O Odoo não o marca como obrigatório, embora em staging esteja
  sempre preenchido — um turno sem empresa ficaria de fora de `['company_id', '=', X]`, o que é
  o comportamento certo, mas é uma explicação possível para dados em falta.
- `display_name`, `shift_name` e `two_weeks_explanation` são calculados e não armazenados: podem
  ser lidos, mas não servem para filtrar nem para ordenar no `search_read`.
- **Um turno que passa da meia-noite são duas linhas de horário**, em dias consecutivos — 22:30
  às 23:59 na segunda e 00:00 às 00:30 na terça. Quem mostrar horários tem de as voltar a juntar.
- **Turnos arquivados existem** (`active = false`) e ficam fora das pesquisas por omissão. Isso é
  o que se quer; é preciso é não confundir "desapareceu" com "não existe".
- `shift_manager_id` vazio é normal, não é dados corrompidos: há núcleos ainda em implementação.
- **Só um subconjunto dos voluntários pode ser gestor de turno.** A lista de escolha do
  `shift_manager_id` são os que têm um `job_id` com `is_manager` — _Voluntário Gestor_ e _Voluntário
  Gestor de Turno_ (ver [`voluntarios.md`](voluntarios.md)). Nada na base impede que se escreva lá
  outro voluntário; a restrição é da vista.

---

## `resource.calendar.attendance` — as linhas de horário

O horário de cada turno. Standard do Odoo, sem campos acrescentados pelos módulos `refood`.

| Campo                   | Tipo      | Relação             | Notas                                                                             |
| ----------------------- | --------- | ------------------- | --------------------------------------------------------------------------------- |
| `calendar_id`           | many2one  | `resource.calendar` | **Obrigatório**                                                                   |
| `name`                  | char      |                     | **Obrigatório**                                                                   |
| `dayofweek`             | selection |                     | **Obrigatório**; `'0'`–`'6'`, segunda a domingo, **como string**                  |
| `hour_from` / `hour_to` | float     |                     | **Obrigatórios**; horas decimais — `22.5` são 22:30                               |
| `day_period`            | selection |                     | **Obrigatório**; `morning`, `afternoon`, `night`                                  |
| `date_from` / `date_to` | date      |                     | Validade da linha; vazias = sem limite                                            |
| `week_type`             | selection |                     | `'0'` semana par, `'1'` semana ímpar; só tem significado com `two_weeks_calendar` |
| `display_type`          | selection |                     | `line_section` marca uma linha de **separador**, sem horário real                 |
| `resource_id`           | many2one  | `resource.resource` | Linha específica de um recurso                                                    |
| `sequence`              | integer   |                     | Ordenação                                                                         |

Armadilhas ao ler estas linhas:

- **As horas não têm fuso próprio.** São interpretadas no `tz` do `resource.calendar` a que
  pertencem — não em UTC, ao contrário dos campos datetime do Odoo.
- **`dayofweek` e `week_type` são strings**, não inteiros: comparar com `'0'` e não com `0`.
- **Filtrar as linhas com `display_type` preenchido**, que existem só para dar títulos na vista
  e não representam horário nenhum.

---

## `res.calendar.availability` — a disponibilidade declarada

Há dois vínculos distintos entre um voluntário e um turno, e ambos vivem na ficha do voluntário
(`hr.employee`, ver [`voluntarios.md`](voluntarios.md)):

- **Inscrição** — o voluntário está escalado naquele turno. Do lado do turno vê-se em
  `employee_ids`; a inscrição é feita na ficha do voluntário, não aqui.
- **Disponibilidade** — o que o voluntário declarou poder fazer, através do formulário online.
  Não aponta para o turno, mas para o registo espelho em `res.calendar.availability`.

`res.calendar.availability` é uma **cópia dos turnos**: um registo com o mesmo nome, por turno.
A duplicação não seria necessária — foi a abordagem inicial e ficou. Consequência prática: para
cruzar disponibilidade com turno é preciso passar pelo `calendar_availability_id`, e nem todos os
turnos têm um.

Estrutura do modelo, que é mínima:

| Campo                                                     | Tipo     | Relação       | Notas           |
| --------------------------------------------------------- | -------- | ------------- | --------------- |
| `name`                                                    | char     |               | **Obrigatório** |
| `company_id`                                              | many2one | `res.company` | O núcleo        |
| `create_uid` / `write_uid` / `create_date` / `write_date` |          |               | Auditoria       |

---

## `resource.calendar.leaves` — ausências

Alcançado por `leave_ids` e `global_leave_ids`. **Por documentar.**

---

## Pontos em aberto

- **Que critério armazenado separa um turno de um calendário standard.** O `shift_name`
  identifica-os, mas é calculado e não armazenado, logo não entra num domínio. É uma decisão de
  cada app que os queira filtrar, não da base. Há também turnos sem nenhuma linha de horário, que
  são um caso diferente deste.
- **`two_weeks_calendar`** está no modelo mas não é usado em staging; se algum núcleo o vier a
  ligar, o `week_type` das linhas passa a contar e as apps têm de o respeitar.
- **`resource.calendar.leaves`** — o que as ausências significam do lado do turno.
