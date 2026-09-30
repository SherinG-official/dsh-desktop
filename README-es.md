# dsh-desktop-pet

Mascota de escritorio para DeepSeek Harness: una ventana flotante siempre visible que muestra el uso de tokens y el saldo en vivo.

[English](README.md) · [中文](README-zh.md) · [हिन्दी](README-hi.md) · [Português](README-pt.md)

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `0.2.0-rc.2` (desktop profile) |
| Node | `^22.19.0 || >=24.0.0` |
| Platforms | Windows (the window host is Electron) |

## What it does

Gestiona el ciclo de vida de la ventana de la mascota como plugin de Host.

Una ventana flotante no puede crearse desde la superficie de plugins: un modulo Client se ejecuta en la pagina del harness y un plugin de Host se ejecuta en Node sin APIs de Electron. La ventana sigue siendo un proceso aparte y este plugin la administra: la inicia al activarse, la detiene al descargarse y la reinicia tras un fallo.

La ventana lee sus propios datos: uso de tokens desde las filas de proyeccion `tokenUsage` del motor, y saldo desde `GET https://api.deepseek.com/user/balance`.

## Install

```sh
pnpm pack
dsh plugin --profile desktop add ./dsh-desktop-pet-0.1.0.tgz
```

Instalar desde una **ruta de directorio** no registra el bundle: debe ser un tarball (o npm/git). Reinicia la aplicacion despues; los bundles se cargan al arrancar. El anfitrion de la ventana es `electron`, instalado como dependencia normal, y la puerta de compilacion de pnpm debe permitirlo en `pnpm-workspace.yaml` (`allowBuilds: electron: true`).

## Configuration

| Clave | Tipo | Por defecto | Descripcion |
|---|---|---|---|
| `enabled` | boolean | `true` | Iniciar la ventana al activar el plugin |
| `command` | string | `''` | Ejecutable anfitrion; vacio resuelve `electron` por el sistema de modulos |
| `args` | string[] | `[]` | Argumentos para `command` |
| `cwd` | string | `''` | Directorio de trabajo; vacio usa `<plugin>/workspace`, nunca el perfil de usuario |
| `restartDelayMs` | number | `2000` | Retardo antes de reiniciar tras una salida anormal |
| `maxRestarts` | number | `5` | Reinicios consecutivos permitidos |

La configuracion la valida el esquema Schemastery; ningun valor ajustable esta fijado en el codigo. Una salida limpia (`code 0`) se considera un cierre deliberado y nunca se reinicia.

## Development

```sh
npm install --ignore-scripts
npm test
```

## License

[Apache License 2.0](LICENSE) © 2026 dsh-desktop-pet contributors.
