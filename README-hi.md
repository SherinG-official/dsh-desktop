# dsh-desktop-pet

DeepSeek Harness ke liye desktop pet: ek floating window jo kaam ke dauraan token usage aur account balance live dikhati hai.

[English](README.md) · [中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md)

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `0.2.0-rc.2` (desktop profile) |
| Node | `^22.19.0 || >=24.0.0` |
| Platforms | Windows (the window host is Electron) |

## What it does

Host plugin ke roop mein pet window ke lifecycle ko sambhalta hai.

Plugin surface se floating window nahi banayi ja sakti: Client module harness page me chalta hai aur Host plugin Node me bina Electron APIs ke. Isliye window apna alag process rehti hai aur yeh plugin use chalata hai — activate par shuru, unload par band, crash ke baad restart.

Window apna data khud padhti hai: token usage engine ki `tokenUsage` projection rows se, aur balance `GET https://api.deepseek.com/user/balance` se.

## Install

```sh
pnpm pack
dsh plugin --profile desktop add ./dsh-desktop-pet-0.1.0.tgz
```

**Directory path** se install karne par bundle register nahi hota — tarball (ya npm/git) chahiye. Uske baad app restart karein; bundle startup par load hote hain. Window host `electron` hai, normal dependency ke roop me, aur pnpm ka build gate ise `pnpm-workspace.yaml` me allow karna hoga (`allowBuilds: electron: true`).

## Configuration

| Key | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Plugin activate hone par window shuru karein |
| `command` | string | `''` | Host executable; khaali chhodne par `electron` module system se resolve hota hai |
| `args` | string[] | `[]` | `command` ke arguments |
| `cwd` | string | `''` | Working directory; khaali chhodne par `<plugin>/workspace`, user profile kabhi nahi |
| `restartDelayMs` | number | `2000` | Abnormal exit ke baad restart se pehle deri |
| `maxRestarts` | number | `5` | Lagataar restart ki seema |

Config Schemastery schema se validate hoti hai; koi tunable hardcoded nahi hai. Clean exit (`code 0`) ko user ka jaan-boojh kar band karna maana jata hai aur use restart nahi kiya jata.

## Development

```sh
npm install --ignore-scripts
npm test
```

## License

[Apache License 2.0](LICENSE) © 2026 dsh-desktop-pet contributors.
