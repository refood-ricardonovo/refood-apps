import { beforeEach, describe, expect, it } from 'vitest';
import { deviceOrdinals, type LinhaDispositivo } from '../src/auth';
import { linhasDoNucleo, ordinaisDoNucleo } from '../src/dispositivos';
import { novaBase, type D1Falso } from './d1-falso';

let db: D1Falso;

/** Três ecrãs no núcleo 7, emparelhados por esta ordem, e um noutro núcleo. */
beforeEach(async () => {
	db = novaBase();

	const linhas: [string, number, string][] = [
		['d1', 7, '2026-01-10T08:00:00.000Z'],
		['d2', 7, '2026-02-10T08:00:00.000Z'],
		['d3', 7, '2026-03-10T08:00:00.000Z'],
		['d9', 9, '2026-01-01T08:00:00.000Z'],
	];

	for (const [id, empresa, criado] of linhas) {
		await db
			.prepare('INSERT INTO dispositivos (id, token_hash, company_id, criado_em) VALUES (?, ?, ?, ?)')
			.bind(id, `hash-${id}`, empresa, criado)
			.run();
	}
});

describe('ordinaisDoNucleo', () => {
	it('numera os ecrãs do núcleo pela ordem de emparelhamento', async () => {
		expect([...(await ordinaisDoNucleo(db, 7))]).toEqual([
			['d1', 1],
			['d2', 2],
			['d3', 3],
		]);
	});

	it('não traz ecrãs de outro núcleo', async () => {
		const linhas = await linhasDoNucleo(db, 7);
		expect(linhas.map((linha) => linha.id)).toEqual(['d1', 'd2', 'd3']);
		expect(await ordinaisDoNucleo(db, 9)).toEqual(new Map([['d9', 1]]));
	});

	it('devolve vazio para um núcleo sem ecrãs, em vez de rebentar', async () => {
		expect((await ordinaisDoNucleo(db, 42)).size).toBe(0);
	});

	/**
	 * O caso que a guarda do `deviceOrdinals` não apanha: uma lista completa do núcleo errado
	 * rebenta lá, mas uma lista incompleta do núcleo certo passa incólume. É por isso que este
	 * teste é contra a query, e não contra a função.
	 */
	describe('quando um ecrã é revogado', () => {
		beforeEach(async () => {
			await db.prepare("UPDATE dispositivos SET revogado = 1, revogado_em = ? WHERE id = 'd2'").bind('2026-04-01T08:00:00.000Z').run();
		});

		it('os números dos outros não mexem, e fica o buraco no lugar do revogado', async () => {
			const ordinais = await ordinaisDoNucleo(db, 7);

			expect(ordinais.get('d1')).toBe(1);
			expect(ordinais.get('d3')).toBe(3);
			expect(ordinais.get('d2')).toBe(2); // continua numerado: o buraco é dele
		});

		it('a query não filtra por revogado — e o filtro óbvio dava outros números', async () => {
			// A versão "óbvia", que reaproveita o WHERE do idx_dispositivos_empresa. Fica aqui como
			// contraste: é ela que renumera o 'd3' de 3 para 2 sem ninguém dar por isso, e a guarda
			// do módulo cala-se porque todas as linhas continuam a ser do núcleo certo.
			const { results: visiveis } = await db
				.prepare('SELECT id, company_id, criado_em FROM dispositivos WHERE company_id = ? AND revogado = 0 ORDER BY criado_em ASC, id ASC')
				.bind(7)
				.all<LinhaDispositivo>();

			expect(() => deviceOrdinals(visiveis, 7)).not.toThrow();
			expect(deviceOrdinals(visiveis, 7).get('d3')).toBe(2);

			// A query a sério conta as revogadas, e por isso o 'd3' fica onde estava.
			expect((await ordinaisDoNucleo(db, 7)).get('d3')).toBe(3);
			expect((await linhasDoNucleo(db, 7)).length).toBe(3);
		});
	});

	it('mantém os números estáveis quando um ecrã novo entra depois de uma revogação', async () => {
		await db.prepare("UPDATE dispositivos SET revogado = 1 WHERE id = 'd1'").run();
		await db
			.prepare('INSERT INTO dispositivos (id, token_hash, company_id, criado_em) VALUES (?, ?, ?, ?)')
			.bind('d4', 'hash-d4', 7, '2026-05-10T08:00:00.000Z')
			.run();

		const ordinais = await ordinaisDoNucleo(db, 7);
		expect(ordinais.get('d2')).toBe(2);
		expect(ordinais.get('d3')).toBe(3);
		expect(ordinais.get('d4')).toBe(4); // o novo é o 4, não reaproveita o 1 do revogado
	});
});
