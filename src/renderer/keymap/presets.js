// Emule — built-in example keymap profiles (owner: C)
// Positions are approximate for 16:9/20:9 landscape games and MUST be adjusted per game
// in the editor (Mapear teclas → Editar).

export const PRESETS = [
  {
    version: 1,
    name: 'FPS (Free Fire/PUBG/CODM) – exemplo',
    lookToggleKey: 'Backquote', // tecla ' (ABNT2). Muitos preferem AltLeft — troque no editor.
    lookToggleMode: 'toggle',
    controls: [
      { id: 'fps-move', type: 'joystick', keys: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' },
        x: 0.16, y: 0.70, radius: 0.13, sprintKey: 'ShiftLeft' },
      { id: 'fps-look', type: 'look', x: 0.62, y: 0.40, sensitivityX: 1.0, sensitivityY: 1.0, invertY: false, smoothing: 0 },
      { id: 'fps-fire', type: 'tap', key: 'Mouse0', x: 0.83, y: 0.60, lookOnly: true },
      { id: 'fps-scope', type: 'tap', key: 'Mouse2', x: 0.93, y: 0.44, lookOnly: true },
      { id: 'fps-jump', type: 'tap', key: 'Space', x: 0.93, y: 0.62 },
      { id: 'fps-crouch', type: 'tap', key: 'KeyC', x: 0.86, y: 0.86 },
      { id: 'fps-reload', type: 'tap', key: 'KeyR', x: 0.76, y: 0.88 },
      { id: 'fps-grenade', type: 'tap', key: 'KeyG', x: 0.70, y: 0.74 },
      { id: 'fps-interact', type: 'tap', key: 'KeyF', x: 0.60, y: 0.62 },
      { id: 'fps-weapon1', type: 'tap', key: 'Digit1', x: 0.43, y: 0.89 },
      { id: 'fps-weapon2', type: 'tap', key: 'Digit2', x: 0.55, y: 0.89 },
      // rodinha também troca de arma (levemente deslocado para não esconder o "1"/"2" no editor)
      { id: 'fps-wheel1', type: 'tap', key: 'WheelUp', x: 0.45, y: 0.86 },
      { id: 'fps-wheel2', type: 'tap', key: 'WheelDown', x: 0.57, y: 0.86 },
      { id: 'fps-bag', type: 'tap', key: 'Tab', x: 0.95, y: 0.12 },
    ],
  },
  {
    version: 1,
    name: 'MOBA (Mobile Legends/LoL WR) – exemplo',
    lookToggleKey: null,
    lookToggleMode: 'toggle',
    controls: [
      // W é do joystick; as habilidades ficam em Q / E / R (+ F para o feitiço).
      // Quem preferir Q/W/E/R pode mover o joystick para as setas no editor.
      { id: 'moba-move', type: 'joystick', keys: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' },
        x: 0.14, y: 0.72, radius: 0.14 },
      { id: 'moba-attack', type: 'tap', key: 'Space', x: 0.88, y: 0.80 },
      { id: 'moba-attack-m', type: 'tap', key: 'Mouse0', x: 0.88, y: 0.80 },
      { id: 'moba-skill1', type: 'tap', key: 'KeyQ', x: 0.73, y: 0.84 },
      { id: 'moba-skill2', type: 'tap', key: 'KeyE', x: 0.77, y: 0.66 },
      { id: 'moba-skill3', type: 'tap', key: 'KeyR', x: 0.86, y: 0.57 },
      { id: 'moba-spell', type: 'tap', key: 'KeyF', x: 0.63, y: 0.86 },
      { id: 'moba-recall', type: 'tap', key: 'KeyB', x: 0.47, y: 0.90 },
      { id: 'moba-heal', type: 'tap', key: 'KeyH', x: 0.53, y: 0.90 },
      { id: 'moba-lvl', type: 'multitap', key: 'KeyL', points: [
        { x: 0.73, y: 0.76, delayMs: 0 }, { x: 0.77, y: 0.58, delayMs: 60 }, { x: 0.86, y: 0.49, delayMs: 60 },
      ] },
      { id: 'moba-shop', type: 'tap', key: 'KeyP', x: 0.05, y: 0.35 },
      { id: 'moba-map', type: 'tap', key: 'Tab', x: 0.08, y: 0.12 },
    ],
  },
];
