# Componentes de terceiros

O Emule redistribui (dentro do executável, em `resources/vendor`) os binários abaixo,
baixados da release oficial `scrcpy-win64-v5.0.1.zip` por `scripts/fetch-vendor.js`
(SHA-256 verificado). Eles não ficam versionados neste repositório.

| Componente | Origem | Licença |
|---|---|---|
| `scrcpy-server` v5.0.1 | [Genymobile/scrcpy](https://github.com/Genymobile/scrcpy) — © Genymobile, Romain Vimont | [Apache License 2.0](https://github.com/Genymobile/scrcpy/blob/master/LICENSE) |
| `adb.exe`, `AdbWinApi.dll`, `AdbWinUsbApi.dll` (platform-tools 37.0.1) | [Android Open Source Project](https://developer.android.com/tools/releases/platform-tools) | [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) |
| Electron | [electron/electron](https://github.com/electron/electron) | [MIT](https://github.com/electron/electron/blob/main/LICENSE) |

O cliente do Emule (decodificação, interface, mapeamento de teclas) é código próprio e não
inclui código-fonte do cliente do scrcpy; ele fala o protocolo do `scrcpy-server`
documentado em [`docs/PROTOCOL.md`](docs/PROTOCOL.md).
