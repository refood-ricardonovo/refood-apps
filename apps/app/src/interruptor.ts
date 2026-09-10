/**
 * O interruptor da demonstração, num sítio só.
 *
 * Estava escrito três vezes — em `entrar.ts`, em `mural.ts` e outra vez na rota de reinício — e
 * passou a carregar peso a mais para isso: é ele que decide se a app está aberta, se o mural serve
 * alguma coisa, e agora também **qual das duas páginas de entrada é que a pessoa vê**. Três cópias
 * de uma condição que governa isso tudo é uma cópia que fica para trás.
 *
 * ## Fecha por omissão, e só um valor exacto abre
 *
 * Um segredo em falta fecha. Um segredo com outro valor qualquer fecha. **Uma configuração que não
 * carrega nunca pode ser a coisa que abre a porta** — a mesma regra do `ADMIN_SECRET` do `apps/tv`.
 *
 * É por isso que a app pode ser implantada em produção sem segredo nenhum e servir a página certa:
 * sem `ENTRADA_ABERTA`, sem credenciais do Odoo e sem nada, o que se vê é *a app está a chegar*, que
 * é o estado normal em todos os dias menos um.
 *
 * ## O estado é público, e isso é uma decisão e não um descuido
 *
 * O `GET /api/estado` diz a quem perguntar se a porta está aberta. **O que se publica é só isso** —
 * não diz nada sobre pessoa nenhuma, nem sobre quantas entraram, nem sobre que núcleos estão na
 * sala. Publica-se porque não há alternativa: uma página que muda com o interruptor publica o
 * interruptor, seja por API, seja servindo HTML diferente. O que continua a exigir uma pergunta por
 * cada NIF, e travada ao ritmo, é a única coisa que interessa esconder. Ver o `CLAUDE.md` desta app.
 */

/** O único valor que abre. Qualquer outra coisa, e a ausência do segredo, fecha. */
const ABERTA = 'aberta';

export function entradaAberta(env: Env): boolean {
	return env.ENTRADA_ABERTA === ABERTA;
}

/** `GET /api/estado` — qual das duas páginas de entrada é que a pessoa vê. */
export function rotaEstado(env: Env): Response {
	return Response.json({ ok: true, aberta: entradaAberta(env) });
}
