# Núcleos

`res.company`. Índice e convenções transversais em [`../modelos-odoo.md`](../modelos-odoo.md).

> **Levantado em `en_US` — não confiar nos nomes.** O `explorar.ts` corria sem `lang` no contexto,
> e nesse caso o Odoo **não** usa a língua do utilizador: cai no `en_US`. As etiquetas de campo e os
> valores de campos traduzidos que aqui aparecem são portanto os ingleses — onde este documento diz
> *Center*, quem trabalha no Odoo vê *Núcleo*. **A estrutura, os tipos, as relações e as contagens
> não são afectados.** O `explorar.ts` passou a ler em `pt_PT` e a imprimir a língua no cabeçalho
> (`--lingua`); quando este levantamento for repetido, os nomes passam a ser os que as pessoas vêem.

---

## `res.company` — o núcleo

Modelo standard do Odoo (`base`), praticamente por customizar: dos 120 campos, **dois** vêm dos
módulos da Refood. Os restantes são o que o Odoo lhe pendura por ter os módulos de contabilidade,
stock, POS e website instalados — dezenas de contas por omissão, journals, estados de onboarding e
opções de faturação que a operação não usa.

**Um núcleo é uma `res.company`.** É este o modelo para onde aponta o `company_id` de tudo o resto,
e é por ele que passa a separação entre núcleos em toda a base. Em staging (setembro de 2026) são
**87 empresas**, criadas sobretudo em 2021 (62) e depois a conta-gotas até hoje.

### Campos que interessam (standard)

| Campo | Tipo | Relação | Notas |
|---|---|---|---|
| `id` | integer | | Interno. A identificação legível do núcleo é o `center_prefix` |
| `name` | char | | **Obrigatório** |
| `partner_id` | many2one | `res.partner` | **Obrigatório**; o contacto onde vive a morada e a identificação fiscal |
| `parent_id` | many2one | `res.company` | Empresa-mãe. **Não separa núcleo de nacional** — ver abaixo |
| `child_ids` | one2many | `res.company` | O inverso |
| `currency_id` | many2one | `res.currency` | **Obrigatório**; EUR nas 87 |
| `sequence` | integer | | Ordenação na lista de empresas |
| `resource_calendar_ids` | one2many | `resource.calendar` | Os turnos do núcleo (ver [`turnos.md`](turnos.md)) |
| `resource_calendar_id` | many2one | `resource.calendar` | *Default Working Hours* do Odoo. Preenchido nas 87, mas é o horário por omissão de RH, não um turno |
| `user_ids` | many2many | `res.users` | Utilizadores com acesso à empresa |
| `email` / `phone` | char | | Vindos do `partner_id`, mas **armazenados** — dá para filtrar e ordenar |
| `primary_color` / `secondary_color` | char | | Cor da empresa nos relatórios. Preenchidos em **2 das 87** — não servem para distinguir núcleos |
| `create_uid` / `write_uid` / `create_date` / `write_date` | | | Auditoria |
| `display_name` | char | | Calculado, não armazenado |

### Campos acrescentados pelos módulos `refood`

| Campo | Tipo | Módulo | Significado |
|---|---|---|---|
| `center_prefix` | char | `refood` | As três letras do núcleo, que entram na numeração das fichas |
| `pos_validation_code` | integer | `refood_pos` | Código para ações especiais no POS. **Não é usado** |

**`center_prefix` é a identificação do núcleo.** É a peça do meio no código único de todas as
fichas da operação — voluntários, beneficiários, fontes de alimento e parceiros de apoio —, que se
compõe de `PT`, do prefixo do núcleo, de `_XX` para o tipo de ficha e do número sequencial a seis
dígitos. Os tipos e o formato completo estão em
[`voluntarios.md`](voluntarios.md#identidade-e-nome), onde se vê o mesmo prefixo do lado do
`hr.employee` (`sequence_prefix` + `sequence_number`).

Está preenchido nas 87 empresas e é **distinto em todas** — é, portanto, o identificador estável e
legível do núcleo, ao contrário do `id`, que é interno. Nada na base impõe as três letras nem a
unicidade: há uma empresa de teste com um prefixo de cinco caracteres.

### Morada e identificação fiscal vivem no `res.partner`

Uma boa parte do que parece ser da empresa é, na verdade, do `partner_id` — o Odoo espelha esses
campos em `res.company` como **calculados e não armazenados**:

`vat`, `company_registry`, `street`, `street2`, `city`, `zip`, `state_id`, `country_id`, `logo`,
`catchall_email`.

Consequência prática: **podem ser lidos, mas não entram num domínio nem numa ordenação**. Quem
precise de filtrar por morada ou por NIF tem de o fazer do lado do `res.partner`. Os únicos campos
de contacto realmente armazenados na empresa são o `email` e o `phone`.

Em staging: `country_id` preenchido em 86 das 87 (Portugal em todas as que têm), `vat` em 84,
`city` em 77, `street` em 66, `phone` em 48. `company_registry` e `report_header` estão vazios em
toda a base.

### Consequências para quem lê estes dados

- **`res.company` não tem `active`.** É a exceção à convenção transversal: empresas não se
  arquivam. Um núcleo que feche continua a aparecer em todas as pesquisas, e **não há campo na base
  que diga que já não opera**.
- **`parent_id` não distingue núcleo de nacional.** Em staging há 5 empresas sem pai e 82
  penduradas numa delas. As sem pai são a empresa principal e empresas criadas para testes —
  algumas destas nomeadas como se fossem núcleos, e com NIF preenchido. Estamos a olhar para a base
  de teste, mas a conclusão para as apps mantém-se: **nenhuma app deve inferir o papel de uma
  empresa a partir da hierarquia**. O âmbito vem do token ou da sessão, não de uma dedução sobre a
  árvore.
- **Empresas de teste não estão marcadas.** Não há campo que as separe das reais, e sem `active`
  também não estão arquivadas. Quem contar núcleos em staging conta-as.
- **`resource_calendar_ids` não são só turnos.** São 1 249 no total, mas uma única empresa acumula
  89 — os calendários standard herdados do arranque, descritos em [`turnos.md`](turnos.md). Duas
  empresas não têm nenhum.

---

## Pontos em aberto

- **Como saber que um núcleo deixou de operar.** Sem `active` e sem estado, não há resposta na
  base. Se vier a ser preciso, é campo novo ou convenção acordada — não é dedução.
- **Como separar empresas reais de empresas de teste** na base de staging, se alguma vez interessar
  para um levantamento. Em produção o problema não deve existir; convém confirmar.
- **`pos_validation_code`** — está no modelo e não é usado. Fica documentado para que ninguém o
  interprete como configuração ativa.
