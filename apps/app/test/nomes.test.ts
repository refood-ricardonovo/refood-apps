import { describe, expect, it } from 'vitest';
import { nomeCurto, primeiroNome } from '../src/nomes';

/**
 * **Nenhum destes casos é de laboratório.** O `full_name` está vazio em cerca de 430 fichas activas,
 * há nomes com espaço duplo, e as partículas — *da*, *de*, *dos* — são a norma e não a excepção num
 * nome português.
 */
describe('o primeiro nome, para o mural', () => {
	it('é a primeira palavra do full_name', () => {
		expect(primeiroNome('Maria Fernanda da Costa')).toBe('Maria');
	});

	/** 430 fichas activas não têm `full_name`. Sem recurso ao `name`, ficavam fora do mural. */
	it('cai no name quando o full_name vem vazio', () => {
		expect(primeiroNome(false, 'Maria Fernanda da Costa')).toBe('Maria');
		expect(primeiroNome('   ', 'Maria Costa')).toBe('Maria');
	});

	it('devolve null quando não há nome nenhum, em vez de inventar', () => {
		expect(primeiroNome(false)).toBeNull();
		expect(primeiroNome('', '')).toBeNull();
	});
});

describe('o nome curto, para quem se acabou de identificar', () => {
	it('é o primeiro nome e a inicial do apelido', () => {
		expect(nomeCurto('Maria Costa')).toBe('Maria C.');
		expect(nomeCurto('João Pedro Silva')).toBe('João S.');
	});

	/**
	 * **A inicial salta as partículas.** *Maria Fernanda da Costa* dá `Maria C.` — um `Maria d.` não
	 * diria nada a ninguém, e é o que sai de olhar só para a última palavra.
	 */
	it('salta as partículas para chegar ao apelido', () => {
		expect(nomeCurto('Maria Fernanda da Costa')).toBe('Maria C.');
		expect(nomeCurto('Ana de Sousa')).toBe('Ana S.');
	});

	/** Um nome de uma palavra fica na palavra: não se inventa uma inicial que não existe. */
	it('aguenta um nome de uma palavra só', () => {
		expect(nomeCurto('Madalena')).toBe('Madalena');
	});

	it('colapsa o espaço, que há fichas com espaço duplo', () => {
		expect(nomeCurto('  Maria   Costa ')).toBe('Maria C.');
	});

	it('devolve null quando não há nome nenhum', () => {
		expect(nomeCurto(false, false)).toBeNull();
	});

	/**
	 * A regra dos televisores é primeiro nome e inicial; **o mural mostra menos ainda**, só o
	 * primeiro nome, porque é um projector numa sala com gente que não é dali. Este teste guarda a
	 * diferença entre as duas formas.
	 */
	it('mostra mais do que o mural, e é de propósito', () => {
		expect(nomeCurto('Maria Costa')).not.toBe(primeiroNome('Maria Costa'));
	});
});
