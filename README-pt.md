# dsh-desktop-pet

Mascote de desktop para o DeepSeek Harness: uma janela flutuante sempre visivel que mostra o uso de tokens e o saldo ao vivo.

[English](README.md) · [中文](README-zh.md) · [Español](README-es.md) · [हिन्दी](README-hi.md)

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `0.2.0-rc.2` (desktop profile) |
| Node | `^22.19.0 || >=24.0.0` |
| Platforms | Windows (the window host is Electron) |

## What it does

Gerencia o ciclo de vida da janela da mascote como plugin de Host.

Uma janela flutuante nao pode ser criada pela superficie de plugins: um modulo Client roda na pagina do harness e um plugin de Host roda em Node sem APIs do Electron. A janela continua sendo um processo separado e este plugin a administra: inicia ao ativar, encerra ao descarregar e reinicia apos uma falha.

A janela le os proprios dados: uso de tokens das linhas de projecao `tokenUsage` do motor, e saldo de `GET https://api.deepseek.com/user/balance`.

## Install

```sh
pnpm pack
dsh plugin --profile desktop add ./dsh-desktop-pet-0.1.0.tgz
```

Instalar a partir de um **caminho de diretorio** nao registra o bundle: precisa ser um tarball (ou npm/git). Reinicie o aplicativo depois; bundles carregam na inicializacao. O host da janela e o `electron`, instalado como dependencia normal, e o portao de build do pnpm deve permiti-lo em `pnpm-workspace.yaml` (`allowBuilds: electron: true`).

## Configuration

| Chave | Tipo | Padrao | Descricao |
|---|---|---|---|
| `enabled` | boolean | `true` | Iniciar a janela quando o plugin ativa |
| `command` | string | `''` | Executavel host; vazio resolve `electron` pelo sistema de modulos |
| `args` | string[] | `[]` | Argumentos para `command` |
| `cwd` | string | `''` | Diretorio de trabalho; vazio usa `<plugin>/workspace`, nunca o perfil do usuario |
| `restartDelayMs` | number | `2000` | Atraso antes de reiniciar apos saida anormal |
| `maxRestarts` | number | `5` | Reinicios consecutivos permitidos |

A configuracao e validada pelo schema Schemastery; nenhum valor ajustavel esta fixado no codigo. Uma saida limpa (`code 0`) e tratada como fechamento deliberado e nunca e reiniciada.

## Development

```sh
npm install --ignore-scripts
npm test
```

## License

[Apache License 2.0](LICENSE) © 2026 dsh-desktop-pet contributors.
