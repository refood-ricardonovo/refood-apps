import { describe, expect, it } from 'vitest';
import { nomeCurto, nucleoDaEntrada, nucleoDoMural, primeiroNome } from '../src/nomes';

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

/**
 * **O `PT` da frente é convenção de nomes do Odoo e não informação** — todo o núcleo o traz. A
 * palavra "Núcleo" sai só no mural, onde se repetiria em cada linha da coluna sem distinguir
 * nenhuma; no telemóvel aparece uma vez e ali mais texto lê-se melhor.
 */
describe('o nome de um núcleo, por superfície', () => {
	it('no telemóvel tira o PT e deixa a palavra Núcleo', () => {
		expect(nucleoDaEntrada('PT Núcleo Leiria')).toBe('Núcleo Leiria');
	});

	it('no mural tira o PT e o Núcleo', () => {
		expect(nucleoDoMural('PT Núcleo Leiria')).toBe('Leiria');
	});

	it('deixa em paz um nome que não traga os prefixos', () => {
		expect(nucleoDaEntrada('Refood Benfica')).toBe('Refood Benfica');
		expect(nucleoDoMural('Refood Benfica')).toBe('Refood Benfica');
	});

	/** O prefixo é uma palavra, não duas letras: um núcleo chamado *PTolomeu* fica inteiro. */
	it('não corta uma palavra que apenas comece por PT', () => {
		expect(nucleoDoMural('PTolomeu')).toBe('PTolomeu');
	});

	/** Um ecrã com uma linha em branco não se lê. Melhor o nome estranho do que nada. */
	it('devolve o nome como veio se tirar os prefixos não deixar nada', () => {
		expect(nucleoDoMural('PT Núcleo')).toBe('PT Núcleo');
	});

	it('devolve null quando não há nome', () => {
		expect(nucleoDoMural(false)).toBeNull();
		expect(nucleoDaEntrada('   ')).toBeNull();
	});
});
