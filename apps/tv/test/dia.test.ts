import { describe, expect, it } from 'vitest';
import {
	diaDaSemanaOdoo,
	diaRefood,
	diaValido,
	diferencaEmDias,
	horaDecimal,
	horaEmLisboa,
	janelaDoDia,
	nomeDoDiaDaSemana,
	relacaoComHoje,
	somarDias,
} from '../src/dia';

/**
 * O dia Refood é a parte do painel onde um erro não dá erro — dá um ecrã a mostrar o dia errado.
 * Estes testes existem para que essa classe de falha seja barulhenta aqui e não silenciosa numa
 * cozinha.
 */
describe('o dia Refood acaba às 3h de Lisboa', () => {
	it('às 2:59 ainda é o dia anterior', () => {
		// 2:59 de quinta em Lisboa, no inverno (UTC = Lisboa).
		expect(diaRefood(new Date('2026-01-15T02:59:00Z'))).toBe('2026-01-14');
	});

	it('às 3:00 vira', () => {
		expect(diaRefood(new Date('2026-01-15T03:00:00Z'))).toBe('2026-01-15');
	});

	it('à meia-noite ainda é o dia anterior — é aí que um corte à meia-noite falharia', () => {
		expect(diaRefood(new Date('2026-01-15T00:00:00Z'))).toBe('2026-01-14');
	});

	/**
	 * O erro que este teste guarda: no horário de verão, as 23h de Lisboa já são o dia seguinte em
	 * UTC. Um cálculo feito em UTC virava o dia às 23h — a meio do turno das entregas, que começa
	 * às 18:30. É o pior erro possível neste ecrã.
	 */
	it('às 23h de uma noite de verão continua a ser o mesmo dia', () => {
		// 2026-07-15 23:30 em Lisboa (WEST, UTC+1) = 22:30 UTC.
		expect(diaRefood(new Date('2026-07-15T22:30:00Z'))).toBe('2026-07-15');
		// E às 00:30 de Lisboa do dia seguinte (23:30 UTC) ainda é o dia 15.
		expect(diaRefood(new Date('2026-07-15T23:30:00Z'))).toBe('2026-07-15');
	});

	it('às 3:30 de uma manhã de verão já é o dia novo', () => {
		// 2026-07-16 03:30 em Lisboa = 02:30 UTC.
		expect(diaRefood(new Date('2026-07-16T02:30:00Z'))).toBe('2026-07-16');
	});
});

describe('a janela UTC de um dia', () => {
	it('no inverno vai das 03:00 UTC às 03:00 UTC do dia seguinte', () => {
		const { inicio, fim } = janelaDoDia('2026-01-14');
		expect(inicio.toISOString()).toBe('2026-01-14T03:00:00.000Z');
		expect(fim.toISOString()).toBe('2026-01-15T03:00:00.000Z');
	});

	it('no verão desloca-se uma hora, porque Lisboa está em UTC+1', () => {
		const { inicio, fim } = janelaDoDia('2026-07-15');
		expect(inicio.toISOString()).toBe('2026-07-15T02:00:00.000Z');
		expect(fim.toISOString()).toBe('2026-07-16T02:00:00.000Z');
	});

	it('o fim de um dia é o início do seguinte, sem buraco nem sobreposição', () => {
		expect(janelaDoDia('2026-03-28').fim.toISOString()).toBe(janelaDoDia('2026-03-29').inicio.toISOString());
	});

	/**
	 * No domingo em que o relógio salta, o dia Refood tem 23 ou 25 horas. Não se corrige: às 3h de
	 * um domingo de mudança de hora não há turno nenhum a decorrer.
	 */
	it('o dia da mudança para a hora de verão tem 23 horas', () => {
		const { inicio, fim } = janelaDoDia('2026-03-28');
		expect((fim.getTime() - inicio.getTime()) / 3_600_000).toBe(23);
	});
});

describe('o dia da semana segue a convenção do Odoo, não a do JavaScript', () => {
	it("dá '0' à segunda-feira e '6' ao domingo", () => {
		expect(diaDaSemanaOdoo('2026-01-12')).toBe('0'); // segunda
		expect(diaDaSemanaOdoo('2026-01-18')).toBe('6'); // domingo
	});

	it('devolve string, e não número — o `week_day` é um selection', () => {
		expect(typeof diaDaSemanaOdoo('2026-01-15')).toBe('string');
	});

	it('nomeia os dias em português', () => {
		expect(nomeDoDiaDaSemana('2026-01-15')).toBe('quinta-feira');
		expect(nomeDoDiaDaSemana('2026-01-17')).toBe('sábado');
	});
});

describe('aritmética de dias', () => {
	it('soma e subtrai atravessando meses e anos', () => {
		expect(somarDias('2026-01-31', 1)).toBe('2026-02-01');
		expect(somarDias('2026-01-01', -1)).toBe('2025-12-31');
		expect(somarDias('2024-02-28', 1)).toBe('2024-02-29');
	});

	it('atravessa a mudança de hora sem perder nem ganhar um dia', () => {
		expect(somarDias('2026-03-28', 1)).toBe('2026-03-29');
		expect(diferencaEmDias('2026-03-27', '2026-03-30')).toBe(3);
	});

	it('recusa datas que não existem', () => {
		expect(diaValido('2026-01-15')).toBe(true);
		expect(diaValido('2026-02-30')).toBe(false);
		expect(diaValido('2026-13-01')).toBe(false);
		expect(diaValido('15-01-2026')).toBe(false);
		expect(diaValido('')).toBe(false);
	});
});

describe('a relação com hoje', () => {
	it('diz onde o ecrã está, porque só o dia da semana não chega', () => {
		expect(relacaoComHoje('2026-01-15', '2026-01-15')).toBe('hoje');
		expect(relacaoComHoje('2026-01-16', '2026-01-15')).toBe('amanhã');
		expect(relacaoComHoje('2026-01-18', '2026-01-15')).toBe('daqui a 3 dias');
		expect(relacaoComHoje('2026-01-14', '2026-01-15')).toBe('ontem');
	});
});

describe('as horas decimais do Odoo', () => {
	it('9.5 são as 9:30', () => {
		expect(horaDecimal(9.5)).toBe('09:30');
		expect(horaDecimal(18.5)).toBe('18:30');
		expect(horaDecimal(0)).toBe('00:00');
		expect(horaDecimal(23.75)).toBe('23:45');
	});

	it('arredonda ao minuto em vez de mostrar segundos', () => {
		expect(horaDecimal(9.51)).toBe('09:31');
	});

	/** O Odoo escreve `false` para "sem valor" em qualquer tipo de campo, inclusive num float. */
	it('devolve null para o que não é uma hora do dia', () => {
		expect(horaDecimal(false)).toBeNull();
		expect(horaDecimal(null)).toBeNull();
		expect(horaDecimal(24)).toBeNull();
		expect(horaDecimal(-1)).toBeNull();
		expect(horaDecimal('9.5')).toBeNull();
		expect(horaDecimal(Number.NaN)).toBeNull();
	});
});

describe('horaEmLisboa', () => {
	/**
	 * O `date_order` do Odoo é UTC sem marca de fuso, e o que interessa comparar com a hora de um
	 * turno é a hora de parede. No inverno coincidem; no verão diferem uma hora, e é aí que um
	 * extra ia parar ao turno errado.
	 */
	it('converte um datetime do Odoo para a hora de parede', () => {
		expect(horaEmLisboa('2026-01-15 18:40:22')).toBe('18:40');
		expect(horaEmLisboa('2026-07-15 17:30:00')).toBe('18:30');
	});

	it('devolve null para o que não é um datetime do Odoo', () => {
		expect(horaEmLisboa(false)).toBeNull();
		expect(horaEmLisboa('')).toBeNull();
		expect(horaEmLisboa('2026-13-40 99:99:99')).toBeNull();
		expect(horaEmLisboa(undefined)).toBeNull();
	});
});
