/**
 * O service worker mínimo — existe para a app ser instalável, e não faz mais nada.
 *
 * **Porque é que tem de existir.** O critério de instalação do Chrome no Android é manifest **mais**
 * um service worker com handler de `fetch`. Sem ele o site funciona na mesma, mas o telemóvel nunca
 * oferece "adicionar ao ecrã principal", e instalar faz parte da demonstração. O iOS não precisa
 * dele — instala só com o manifest — mas registá-lo não lhe custa nada.
 *
 * **Não guarda nada, e é escolha.** Um service worker que faça cache passa a ser o dono do que o
 * telemóvel vê, e sem uma estratégia de invalidação escrita isso é uma app instalada a mostrar uma
 * versão velha sem forma de a actualizar — numa demonstração, o pior dos defeitos. O handler existe
 * para o critério estar cumprido e deixa o pedido seguir para a rede, exactamente como seguiria se
 * ele não estivesse aqui.
 *
 * **Quando a app tiver conteúdo a sério**, é aqui que entra a estratégia — e entra com uma decisão
 * escrita sobre o que fica offline e como se actualiza, não por ser o passo seguinte óbvio.
 */

/*
 * `skipWaiting` e `clients.claim`: um service worker novo substitui o antigo sem esperar que todos
 * os separadores fechem. Enquanto não há cache nenhuma isto não tem risco — não há duas versões de
 * dados a coexistir —, e evita o caso clássico de um telemóvel ficar preso a um worker antigo que
 * ninguém consegue tirar de lá.
 */
self.addEventListener('install', () => {
	self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
	evento.waitUntil(self.clients.claim());
});

/*
 * O handler tem de existir para o critério de instalação; `respondWith` não é chamado, portanto o
 * browser trata o pedido como trataria sem service worker nenhum. É a forma mais honesta de dizer
 * "estou aqui e não interfiro".
 */
self.addEventListener('fetch', () => {});
