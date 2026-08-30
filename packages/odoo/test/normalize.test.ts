import { describe, expect, it } from 'vitest';
import { many2one, many2oneId, nullable, odooDate, toOdooDate } from '../src/index';

describe('many2one', () => {
	it('descompacta [id, display_name]', () => {
		expect(many2one([3, 'Porto'])).toEqual({ id: 3, nome: 'Porto' });
	});

	it('devolve null quando o campo está vazio', () => {
		expect(many2one(false)).toBeNull();
	});

	it('aceita um display_name vazio sem o confundir com campo vazio', () => {
		expect(many2one([7, ''])).toEqual({ id: 7, nome: '' });
	});
});

describe('many2oneId', () => {
	it('devolve só o id', () => {
		expect(many2oneId([3, 'Porto'])).toBe(3);
	});

	it('devolve null quando o campo está vazio', () => {
		expect(many2oneId(false)).toBeNull();
	});
});

describe('nullable', () => {
	it('troca o false do Odoo por null', () => {
		expect(nullable<string>(false)).toBeNull();
	});

	it('deixa passar o valor quando existe', () => {
		expect(nullable<string>('abc')).toBe('abc');
		expect(nullable<number>(42)).toBe(42);
	});

	it('não trata valores falsy legítimos como vazios', () => {
		expect(nullable<number>(0)).toBe(0);
		expect(nullable<string>('')).toBe('');
		expect(nullable<number[]>([])).toEqual([]);
	});

	// Documenta o limite conhecido: num campo booleano o `false` é um valor, não um vazio,
	// e o Odoo serializa os dois de forma indistinguível. Daí o aviso no JSDoc.
	it('não distingue um booleano false de um campo vazio — por isso não se usa em booleanos', () => {
		expect(nullable<boolean>(true)).toBe(true);
		expect(nullable<boolean>(false)).toBeNull();
	});
});

describe('odooDate — variante datetime', () => {
	it('lê "YYYY-MM-DD HH:MM:SS" como UTC', () => {
		expect(odooDate('2026-08-29 09:14:22')?.toISOString()).toBe('2026-08-29T09:14:22.000Z');
	});

	// Esta asserção é independente do fuso da máquina por construção: compara com um instante
	// absoluto. Se a implementação caísse em `new Date(str)` — que lê o formato do Odoo como hora
	// local — falharia em qualquer máquina cujo offset não seja 0 nessa data.
	it('não depende do fuso local de quem corre os testes', () => {
		const str = '2026-08-15 23:30:00';
		const instanteUtc = Date.UTC(2026, 7, 15, 23, 30, 0);
		expect(odooDate(str)?.getTime()).toBe(instanteUtc);

		// O contraste com new Date() só é observável fora de UTC (Lisboa é UTC+0 no Inverno).
		if (new Date(instanteUtc).getTimezoneOffset() !== 0) {
			expect(new Date(str).getTime()).not.toBe(instanteUtc);
		}
	});

	it('aceita o separador T e fracção de segundo, truncando-a', () => {
		expect(odooDate('2026-08-29T09:14:22')?.toISOString()).toBe('2026-08-29T09:14:22.000Z');
		expect(odooDate('2026-08-29 09:14:22.987654')?.toISOString()).toBe('2026-08-29T09:14:22.000Z');
	});

	it('lê as fronteiras do dia', () => {
		expect(odooDate('2026-01-01 00:00:00')?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
		expect(odooDate('2026-12-31 23:59:59')?.toISOString()).toBe('2026-12-31T23:59:59.000Z');
	});
});

describe('odooDate — variante date', () => {
	it('lê "YYYY-MM-DD" como meia-noite UTC, por não trazer hora nem fuso', () => {
		expect(odooDate('2026-08-29')?.toISOString()).toBe('2026-08-29T00:00:00.000Z');
	});

	it('trata 29 de Fevereiro num ano bissexto', () => {
		expect(odooDate('2024-02-29')?.toISOString()).toBe('2024-02-29T00:00:00.000Z');
	});
});

describe('odooDate — vazios e entradas inválidas', () => {
	it('devolve null para o false de campo vazio', () => {
		expect(odooDate(false)).toBeNull();
	});

	it('devolve null para string vazia ou só espaços', () => {
		expect(odooDate('')).toBeNull();
		expect(odooDate('   ')).toBeNull();
	});

	it('devolve null para o que não é uma data', () => {
		expect(odooDate('não é uma data')).toBeNull();
		expect(odooDate('29-08-2026')).toBeNull();
		expect(odooDate('2026/08/29')).toBeNull();
	});

	// `Date.UTC` normaliza fora de gama em silêncio: sem validação, '2026-13-45' viraria Fevereiro
	// de 2027 e passaria por uma data legítima.
	it('devolve null em vez de rolar datas impossíveis', () => {
		expect(odooDate('2026-13-45')).toBeNull();
		expect(odooDate('2026-02-30')).toBeNull();
		expect(odooDate('2025-02-29')).toBeNull();
		expect(odooDate('2026-08-29 25:00:00')).toBeNull();
	});

	it('ignora espaços à volta', () => {
		expect(odooDate('  2026-08-29 09:14:22  ')?.toISOString()).toBe('2026-08-29T09:14:22.000Z');
	});
});

describe('toOdooDate', () => {
	it('formata em UTC no formato do Odoo', () => {
		expect(toOdooDate(new Date('2026-08-29T09:14:22.000Z'))).toBe('2026-08-29 09:14:22');
	});

	it('preenche com zeros à esquerda', () => {
		expect(toOdooDate(new Date('2026-01-05T00:00:00.000Z'))).toBe('2026-01-05 00:00:00');
	});

	it('trunca os milissegundos em vez de arredondar, porque o Odoo guarda ao segundo', () => {
		expect(toOdooDate(new Date('2026-08-29T09:14:22.987Z'))).toBe('2026-08-29 09:14:22');
	});

	it('converte hora local em UTC — o caso real de escrever um check_in', () => {
		const checkIn = new Date('2026-08-29T10:14:22+01:00'); // 10:14 em Lisboa, horário de Verão
		expect(toOdooDate(checkIn)).toBe('2026-08-29 09:14:22');
	});

	it('rejeita um Date inválido em vez de escrever lixo no Odoo', () => {
		expect(() => toOdooDate(new Date('xxx'))).toThrow(TypeError);
	});
});

describe('round-trip odooDate ↔ toOdooDate', () => {
	it('Date → string → Date preserva o instante ao segundo', () => {
		const agora = new Date();
		const aoSegundo = Math.floor(agora.getTime() / 1000) * 1000;
		expect(odooDate(toOdooDate(agora))?.getTime()).toBe(aoSegundo);
	});

	it.each(['2026-08-29 09:14:22', '2026-01-01 00:00:00', '2026-12-31 23:59:59', '2024-02-29 12:00:00'])(
		'string → Date → string preserva %s',
		(str) => {
			expect(toOdooDate(odooDate(str)!)).toBe(str);
		},
	);

	it('um check_out escrito e relido dá o mesmo instante', () => {
		const checkOut = new Date('2026-08-29T18:45:03+01:00');
		expect(odooDate(toOdooDate(checkOut))?.getTime()).toBe(checkOut.getTime());
	});
});
