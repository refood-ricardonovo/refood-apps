/**
 * O dia Refood, e a aritmética de datas do painel.
 *
 * Tudo aqui é função pura sobre strings `YYYY-MM-DD` e `Date`. Não fala com o Odoo nem com o D1, e
 * é por isso que se testa sem emulador — o que interessa, porque é a parte do painel onde um erro
 * não dá erro: dá um ecrã a mostrar o dia errado, e ninguém repara até faltar comida a uma família.
 *
 * **O dia Refood acaba às 3h, não à meia-noite.** Às 2:59 de quinta-feira o dia de trabalho ainda é
 * quarta: o turno da noite acabou de fechar e o ecrã tem de continuar a mostrar as entregas de
 * quarta. Um televisor que mudasse de dia à meia-noite mudava-o a meio do turno.
 *
 * **E calcula-se sempre no fuso de Lisboa, nunca em UTC.** No horário de verão as 23h de Lisboa já
 * são o dia seguinte em UTC — um corte feito em UTC trocava o dia uma hora antes da meia-noite,
 * exactamente durante o turno das entregas. O `Intl` é a única fonte de verdade sobre o desvio, que
 * muda duas vezes por ano e não se deduz de aritmética.
 */

import { odooDate } from '@refood/odoo';

/** O fuso da operação. Não é configurável: a Refood opera em Portugal continental. */
export const FUSO = 'Europe/Lisbon';

/** A hora a que o dia Refood vira, no fuso de Lisboa. Depois de qualquer turno, antes de qualquer preparação. */
export const HORA_DE_CORTE = 3;

/** Quantos dias para a frente a navegação alcança, para além de hoje. */
export const DIAS_PARA_A_FRENTE = 7;

/**
 * Os dias da semana pela convenção do Odoo: `'0'` é segunda-feira.
 *
 * Escrito à mão, e não tirado do `Intl`, por duas razões: o `week_day` do `res.delivery.route` usa
 * esta ordem — que não é a do JavaScript, onde `getDay()` devolve 0 ao domingo —, e a tradução tem
 * de ser estável sem depender dos dados de locale que a runtime tiver.
 */
const NOMES_DOS_DIAS = ['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'domingo'] as const;

const FORMATADOR = new Intl.DateTimeFormat('en-CA', {
	timeZone: FUSO,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit',
	hour12: false,
});

function partesEmLisboa(instante: Date): Record<string, number> {
	const partes: Record<string, number> = {};
	for (const { type, value } of FORMATADOR.formatToParts(instante)) {
		if (type !== 'literal') partes[type] = Number(value);
	}
	// À meia-noite algumas runtimes escrevem 24 em vez de 0.
	partes.hour = (partes.hour ?? 0) % 24;
	return partes;
}

/** Quanto é que Lisboa está à frente de UTC, em milissegundos, no instante dado. */
function desvioDeLisboa(instante: Date): number {
	const p = partesEmLisboa(instante);
	const comoSeFosseUtc = Date.UTC(
		p.year as number,
		(p.month as number) - 1,
		p.day as number,
		p.hour as number,
		p.minute as number,
		p.second as number,
	);
	return comoSeFosseUtc - instante.getTime();
}

/**
 * O instante UTC em que dá uma certa hora de parede em Lisboa.
 *
 * Duas passagens, e a segunda não é zelo: para saber o desvio é preciso um instante, e para ter o
 * instante é preciso o desvio. Estima-se com o desvio do palpite e corrige-se. Nas duas horas por
 * ano em que o relógio salta, a hora pedida pode não existir ou existir duas vezes — mas às 3h de
 * um domingo de mudança de hora não há turno a decorrer, e o pior que acontece é o dia Refood ter
 * 23 ou 25 horas.
 */
function instanteEmLisboa(dia: string, hora: number): Date {
	const [ano, mes, d] = dia.split('-').map(Number) as [number, number, number];
	const palpite = Date.UTC(ano, mes - 1, d, hora, 0, 0);
	const primeiro = new Date(palpite - desvioDeLisboa(new Date(palpite)));
	return new Date(palpite - desvioDeLisboa(primeiro));
}

function comoTexto(ano: number, mes: number, dia: number): string {
	return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Aceita só o formato exacto, e só datas que existem — `2026-02-30` não passa. */
export function diaValido(valor: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;

	const [ano, mes, dia] = valor.split('-').map(Number) as [number, number, number];
	const d = new Date(Date.UTC(ano, mes - 1, dia));
	return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

/** O dia Refood a que um instante pertence: o dia de parede em Lisboa, menos um antes das 3h. */
export function diaRefood(instante: Date): string {
	const p = partesEmLisboa(instante);
	const base = Date.UTC(p.year as number, (p.month as number) - 1, p.day as number);
	const ajustado = new Date((p.hour as number) < HORA_DE_CORTE ? base - 86_400_000 : base);

	return comoTexto(ajustado.getUTCFullYear(), ajustado.getUTCMonth() + 1, ajustado.getUTCDate());
}

/**
 * A janela UTC de um dia Refood: das 3h de Lisboa desse dia às 3h do dia seguinte.
 *
 * Meio aberta — `inicio <= x < fim` —, para que uma encomenda às 3h em ponto caia num dia só.
 */
export function janelaDoDia(dia: string): { inicio: Date; fim: Date } {
	return { inicio: instanteEmLisboa(dia, HORA_DE_CORTE), fim: instanteEmLisboa(somarDias(dia, 1), HORA_DE_CORTE) };
}

/** Soma dias de calendário, sem passar por fusos: a data é uma etiqueta, não um instante. */
export function somarDias(dia: string, quantos: number): string {
	const [ano, mes, d] = dia.split('-').map(Number) as [number, number, number];
	const somado = new Date(Date.UTC(ano, mes - 1, d + quantos));

	return comoTexto(somado.getUTCFullYear(), somado.getUTCMonth() + 1, somado.getUTCDate());
}

/** Quantos dias de calendário separam dois dias. Positivo quando `outro` é mais tarde. */
export function diferencaEmDias(dia: string, outro: string): number {
	const emMs = (valor: string) => {
		const [ano, mes, d] = valor.split('-').map(Number) as [number, number, number];
		return Date.UTC(ano, mes - 1, d);
	};
	return Math.round((emMs(outro) - emMs(dia)) / 86_400_000);
}

/**
 * O dia da semana como o Odoo o escreve: `'0'` na segunda-feira, string e não número.
 *
 * Os campos `selection` do Odoo são strings mesmo quando parecem números. Comparar o `week_day` com
 * `0` em vez de `'0'` devolve lista vazia, sem erro nenhum.
 */
export function diaDaSemanaOdoo(dia: string): string {
	const [ano, mes, d] = dia.split('-').map(Number) as [number, number, number];
	// `getUTCDay()` dá 0 ao domingo; a convenção do Odoo dá 0 à segunda.
	return String((new Date(Date.UTC(ano, mes - 1, d)).getUTCDay() + 6) % 7);
}

/** O nome do dia da semana, em português. */
export function nomeDoDiaDaSemana(dia: string): string {
	return NOMES_DOS_DIAS[Number(diaDaSemanaOdoo(dia))] as string;
}

/**
 * Como é que o dia mostrado se relaciona com hoje.
 *
 * **Não é decoração.** Quem entra na cozinha e vê "quinta-feira" não sabe se o ecrã está em hoje ou
 * se alguém o deixou noutro sítio. A navegação é toda manual e o ecrã fica onde o deixaram —
 * portanto tem de dizer onde está.
 */
export function relacaoComHoje(dia: string, hoje: string): string {
	const diferenca = diferencaEmDias(hoje, dia);

	if (diferenca === 0) return 'hoje';
	if (diferenca === 1) return 'amanhã';
	if (diferenca === -1) return 'ontem';
	if (diferenca > 1) return `daqui a ${diferenca} dias`;
	return `há ${-diferenca} dias`;
}

/**
 * Uma hora decimal do Odoo como `HH:MM`.
 *
 * `start_hour` é um float — `9.5` são as 9:30 — no fuso do `resource.calendar` a que a rota está
 * presa, que em toda a base é `Europe/Lisbon`. **Não é um datetime**: passá-la pelo `new Date` ou
 * pelo `odooDate` não faz sentido nenhum, e é o erro que este formatador existe para evitar.
 *
 * Devolve `null` para o que não é uma hora do dia, incluindo o `false` com que o Odoo escreve
 * "sem valor".
 */
export function horaDecimal(valor: unknown): string | null {
	if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0 || valor >= 24) return null;

	const minutosTotais = Math.round(valor * 60);
	const horas = Math.floor(minutosTotais / 60) % 24;
	const minutos = minutosTotais % 60;

	return `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}`;
}

/**
 * A hora de parede em Lisboa de um datetime do Odoo — `'2026-01-15 19:32:04'` → `'19:32'`.
 *
 * **É o que permite atribuir a um turno uma coisa que não tem turno.** Uma `pos.order` traz um
 * `date_order` e mais nada: quem quiser saber em que turno é que ela aconteceu tem de comparar a
 * hora a que foi registada com a hora a que os turnos do dia começam — e essa comparação só faz
 * sentido no fuso em que as pessoas trabalham. Ver `turnoDoExtra`, em `pos.ts`.
 *
 * Passa pelo `odooDate` e nunca pelo `new Date`: o formato separado por espaço é lido pelos motores
 * de JavaScript como hora **local**, o que deslocaria o instante pelo desvio da runtime — num
 * Worker, zero, e portanto um erro que não aparecia em lado nenhum até alguém correr isto noutro
 * sítio.
 */
export function horaEmLisboa(dataOdoo: unknown): string | null {
	if (typeof dataOdoo !== 'string') return null;

	const instante = odooDate(dataOdoo);
	if (instante === null) return null;

	const p = partesEmLisboa(instante);
	return `${String(p.hour ?? 0).padStart(2, '0')}:${String(p.minute ?? 0).padStart(2, '0')}`;
}
