<p align="center">
  <img src="build/icon.png" width="112" alt="Emule">
</p>

<h1 align="center">Emule</h1>

<p align="center">
  Espelhe a tela do seu Android no PC via USB, com latência mínima, áudio do celular no PC
  e mapeamento completo de teclado e mouse para jogos.
</p>

<p align="center">
  <a href="https://github.com/David-Santosx/emule/releases/latest"><b>⬇ Baixar para Windows</b></a> ·
  <a href="https://david-santosx.github.io/emule/">Site</a> ·
  <a href="docs/ARCHITECTURE.md">Arquitetura</a> ·
  <a href="docs/PROTOCOL.md">Protocolo</a>
</p>

---

## Destaques

- **Latência mínima**: decodificação por hardware (WebCodecs H.264/H.265) e cada quadro é
  desenhado assim que é decodificado, sem fila. O mouse é lido em alta frequência
  (`pointerrawupdate`, até 1000 Hz) e enviado ao celular a ~250 Hz.
- **Qualidade**: resolução nativa, até 24 Mbps, 60 fps, com predefinições *Máxima qualidade*,
  *Equilibrado* e *Desempenho*.
- **Áudio do celular no PC** (Android 11+), com buffer de ~25–60 ms, volume e mudo.
- **Mapeamento para jogos**:
  - toque/segurar, joystick WASD (com tecla de corrida), deslizar e macro (vários toques);
  - todas as teclas, botões do mouse (esquerdo, direito, meio, laterais) e roda para cima/baixo;
  - uma tecla pode acionar vários controles ao mesmo tempo;
  - **modo mira**: o cursor do PC some e o mouse controla a câmera, nos modos alternar ou
    segurar, com sensibilidade X/Y separada e inversão do eixo Y;
  - editor visual de arrastar e soltar, perfis de exemplo (FPS e MOBA), importar/exportar JSON.
- Barra lateral com voltar, início, recentes, volume, power, captura de tela, instalar APK,
  desligar a tela do celular, tela cheia, sempre no topo e estatísticas (FPS, bitrate, fila, áudio).
- **Simples**: um único `Emule.exe` portátil (ou instalador). O `adb` já vem embutido.

Medido num Galaxy A25 (Android 16): conexão em ~1,2 s, primeiro quadro em ~1,6 s,
1080×2340 a até 60 fps, buffer de áudio de ~25–35 ms.

## Como usar

1. No celular: **Configurações › Sobre o telefone › Informações do software** e toque 7 vezes em
   **Número de compilação**.
2. Em **Opções do desenvolvedor**, ative **Depuração USB**.
3. Conecte o cabo USB e aceite o aviso **Permitir depuração USB?** no celular.
4. Abra o `Emule.exe`, selecione o celular e clique em **Conectar**.

O Windows pode mostrar o aviso do SmartScreen porque o app não tem assinatura digital: clique em
**Mais informações › Executar assim mesmo**. Feche outros programas que usam adb (WASD+,
emuladores, scrcpy…), pois eles podem derrubar a conexão.

**Requisitos**: Windows 10/11 64 bits; Android 5.0+ (áudio: Android 11+).

### Atalhos

| Tecla | Ação |
|---|---|
| F1 | Ajuda |
| F11 | Tela cheia |
| F12 ou Ctrl+K | Liga/desliga o mapeamento |
| Ctrl+Shift+E | Editor de mapeamento |
| Ctrl+Shift+H | Estatísticas |
| Mouse esquerdo / direito / meio | Toque e arrastar / Voltar / Início |
| `'` (perfil FPS de exemplo) e Esc | Liga o modo mira / sai |

Detalhes do formato dos perfis: [`src/renderer/keymap/README.md`](src/renderer/keymap/README.md).

> Usar mapeamento de teclas em jogos online pode violar os termos de alguns jogos.
> Use por sua conta e risco.

## Desenvolvimento

Requer Node.js 20+ no Windows.

```bash
npm install          # instala o Electron e baixa adb + scrcpy-server para vendor/ (SHA-256 verificado)
npm start            # roda o app em modo de desenvolvimento
npm test             # testes (node --test)
npm run dist         # gera release/Emule.exe (portátil) e release/Emule-Setup-<versão>.exe
```

### Estrutura

```
src/main/        processo principal: adb, sessão scrcpy (sockets, parser), configurações e perfis
src/preload.js   API window.emule (contextBridge)
src/renderer/    interface, vídeo (WebCodecs), áudio (AudioWorklet), entrada, mensagens de controle
src/renderer/keymap/  motor de mapeamento, editor visual, perfis de exemplo
scripts/         download dos binários, ícone, empacotamento
docs/            arquitetura, protocolo do scrcpy v5.0.1 e o site (GitHub Pages)
test/            testes automatizados
```

O lado do celular é o `scrcpy-server` oficial, sem modificações. O cliente é próprio; o protocolo
está documentado em [`docs/PROTOCOL.md`](docs/PROTOCOL.md).

## Créditos

Baseado no servidor do [scrcpy](https://github.com/Genymobile/scrcpy) (Apache-2.0), no `adb` do
Android platform-tools (Apache-2.0) e no [Electron](https://www.electronjs.org/) (MIT).
Veja [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
