# Mapeamento de teclas (keymap)

Transforma teclado e mouse em toques na tela do celular, para jogar no PC.
Arquivos: `engine.js` (execução), `editor.js` (editor visual), `presets.js` (exemplos), `keymap.css`.

> **Importante:** as posições dos exemplos são aproximadas. Cada jogo (e cada layout de HUD)
> tem os botões em lugares diferentes — abra o editor e arraste cada controle para cima do
> botão correspondente do jogo antes de jogar.

## Perfil (JSON, versão 1)

```json
{
  "version": 1,
  "name": "Meu FPS",
  "lookToggleKey": "Backquote",
  "lookToggleMode": "toggle",
  "controls": [
    { "id": "…", "type": "tap",      "key": "Space",  "x": 0.88, "y": 0.62 },
    { "id": "…", "type": "tap",      "key": "Mouse0", "x": 0.80, "y": 0.70, "lookOnly": true },
    { "id": "…", "type": "joystick", "keys": { "up": "KeyW", "down": "KeyS", "left": "KeyA", "right": "KeyD" },
      "x": 0.17, "y": 0.70, "radius": 0.12, "sprintKey": "ShiftLeft" },
    { "id": "…", "type": "look",     "x": 0.65, "y": 0.45, "sensitivityX": 1.0, "sensitivityY": 1.0,
      "invertY": false, "smoothing": 0 },
    { "id": "…", "type": "swipe",    "key": "KeyR", "x": 0.5, "y": 0.8, "x2": 0.5, "y2": 0.5, "durationMs": 120 },
    { "id": "…", "type": "multitap", "key": "KeyQ", "points": [ { "x": 0.3, "y": 0.3, "delayMs": 0 }, { "x": 0.4, "y": 0.3, "delayMs": 60 } ] }
  ]
}
```

- **Coordenadas** `x`, `y` vão de 0 a 1 em relação à imagem do celular (0,0 = canto superior esquerdo).
- **Raio** do joystick é medido em frações da **altura** da imagem.
- **Teclas** usam `KeyboardEvent.code` (`KeyW`, `Space`, `ShiftLeft`, `Digit1`, `Backquote`…).
  Mouse: `Mouse0` (esquerdo), `Mouse1` (meio/clique da rodinha), `Mouse2` (direito),
  `Mouse3`/`Mouse4` (laterais), `WheelUp`/`WheelDown` (cada "clique" da rodinha).
- **A mesma tecla pode ser usada em vários controles**: ao apertar, todos são acionados juntos
  (ex.: botão esquerdo em dois botões de tiro). O editor mostra um selo "×N" nesses casos.
- Campos desconhecidos são descartados; `sensitivity` (antigo) é aceito e vira X e Y.

## Tipos de controle

| Tipo | Comportamento |
|---|---|
| `tap` (Toque) | Pressiona ao apertar a tecla e solta ao soltar (segurar = toque longo). Com `lookOnly: true` só funciona com o modo mira ligado — fora dele o botão/tecla volta a funcionar normalmente (ex.: clique esquerdo para usar menus). Na rodinha, cada clique gera um toque rápido (~30 ms). |
| `joystick` | 4 teclas → um dedo. Encosta no centro ao apertar a primeira direção e vai para centro + direção × raio; diagonais são normalizadas, teclas opostas se anulam, solta quando todas são liberadas. Sem a tecla de correr (`sprintKey`) o dedo vai a **75% do raio**; segurando-a, a **100%**. A transição é suavizada em 2 passos (60% imediato, 100% após 10 ms). |
| `look` (Mira) | Câmera de FPS com o mouse. Um dedo fica pressionado no ponto da Mira e acompanha o movimento do mouse. Quando se afasta mais de 0,2 (altura da tela) do ponto ou chega perto da borda, é solto e pressionado de novo no ponto, sem você perceber. Apenas uma por perfil. |
| `swipe` (Deslizar) | Ao apertar, desliza de (x,y) até (x2,y2) em `durationMs` e solta. |
| `multitap` (Macro) | Sequência de toques rápidos (30 ms cada). `delayMs` é o atraso em relação ao ponto anterior (o do primeiro ponto conta a partir do aperto). |

## Modo mira

- Tecla configurável na barra do editor (`lookToggleKey`, padrão `'` — tecla `Backquote`; muita
  gente prefere `Alt` esquerdo ou o botão direito do mouse).
- `lookToggleMode`: `"toggle"` (**Alternar** — aperta para ligar e de novo para desligar) ou
  `"hold"` (**Segurar** — ativo só enquanto a tecla estiver pressionada).
- Com a mira ligada o cursor do PC some (pointer lock) e aparece o aviso "Modo mira: ON".
  **Esc sempre sai.** Sem nenhum controle `look` no perfil, a tecla da mira não faz nada.
- Sensibilidade: `sensitivityX`/`sensitivityY` (0,1–5). Com 1,0, 1 px de mouse ≈ 1 px numa tela
  de 1080p (independe da resolução de espelhamento escolhida). `invertY` inverte o eixo vertical.
- `smoothing` (0 = desligado, padrão): suaviza o movimento, mas adiciona atraso.
- Posicione a Mira numa área **vazia** da tela (sem botões), normalmente no lado direito.

## Editor

Abra pelo botão de mapeamento. Na barra: **+ Toque, + Joystick, + Mira, + Deslizar, + Macro**,
nome do perfil, tecla/modo da mira, **Limpar tudo**, **Cancelar**, **Salvar** (ou Ctrl+S).
Arraste os controles; clique para editar no painel lateral (tecla, "só no modo mira",
sensibilidade, duração, atrasos, tecla de correr, excluir). Para definir uma tecla, clique no
campo e aperte a tecla, um botão do mouse ou gire a rodinha (Esc cancela).
Atalhos: setas movem o controle selecionado (Shift = passo maior), Delete exclui, Esc desmarca,
⇅ move a barra para baixo, ◧ troca o painel de lado.

Ao salvar, o perfil é validado: nome obrigatório, joystick com as 4 direções, toques/deslizar/macro
com tecla, uma única Mira e tecla da mira definida (não pode ser Esc).

## Exemplos incluídos

- **FPS (Free Fire/PUBG/CODM) – exemplo**: WASD + Shift correr, mira em `'`, botão esquerdo atira e
  direito abre a luneta (só no modo mira), Espaço pula, C agacha, R recarrega, G granada,
  F interage, 1/2 (e a rodinha) trocam de arma, Tab mochila.
- **MOBA (Mobile Legends/LoL WR) – exemplo**: WASD move; como o W é do joystick, as habilidades
  ficam em **Q / E / R**, F feitiço, Espaço ou botão esquerdo ataca, B volta à base, H cura,
  L sobe as 3 habilidades de nível (macro), P loja, Tab mapa. Se preferir Q/W/E/R, troque o joystick
  para as setas no editor.
