# WhatsApp Sound Sticker Bot

[![CI](https://github.com/DavidRamirez206/whatsapp-sound-sticker-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/DavidRamirez206/whatsapp-sound-sticker-bot/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/DavidRamirez206/whatsapp-sound-sticker-bot)](https://github.com/DavidRamirez206/whatsapp-sound-sticker-bot/releases/latest)
[![Licencia: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[English](README.md) · **Español**

Un bot sencillo de WhatsApp que convierte un video en un **sticker animado que reproduce su sonido**.
Envía un video con el texto `!a` a la cuenta de WhatsApp donde corre el bot y te responde con el sticker.

Es un proyecto pequeño, pero aquí también sirve como excusa práctica para hablar de algo mucho más
importante: **qué pasa realmente con tus datos cuando se los envías a un bot** y qué cuidados tener con
este o con cualquier otro. Lee la sección [Seguridad, privacidad y riesgos](#seguridad-privacidad-y-riesgos)
antes de usarlo.

---

## Contenido

- [Cómo funciona](#cómo-funciona)
- [Características](#características)
- [Aviso legal](#aviso-legal)
- [Opción A: ejecutable listo para usar (recomendada)](#opción-a-ejecutable-listo-para-usar-recomendada)
- [Opción B: ejecutar desde el código fuente](#opción-b-ejecutar-desde-el-código-fuente)
  - [Windows](#windows-1)
  - [Linux](#linux-1)
- [Vincular tu cuenta de WhatsApp](#vincular-tu-cuenta-de-whatsapp)
- [Uso](#uso)
- [Configuración](#configuración)
- [Cómo se codifican los videos largos](#cómo-se-codifican-los-videos-largos)
- [Confiabilidad](#confiabilidad)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Pruebas](#pruebas)
- [Compilar el ejecutable y publicar versiones](#compilar-el-ejecutable-y-publicar-versiones)
- [Solución de problemas](#solución-de-problemas)
- [Seguridad, privacidad y riesgos](#seguridad-privacidad-y-riesgos)
- [Licencia](#licencia)

---

## Cómo funciona

1. El bot se conecta a WhatsApp como un **dispositivo vinculado** de una cuenta normal (el mismo
   mecanismo de WhatsApp Web) usando [Baileys](https://github.com/WhiskeySockets/Baileys).
2. Cuando llega un video con el texto `!a`, el bot lo descarga y con **FFmpeg** genera:
   - un **WebP** animado de 512×512 px de menos de 500 KB (los límites de WhatsApp para stickers), y
   - una pista de audio **Ogg/Opus** que dura exactamente lo mismo que la animación.
3. Sube ambos archivos a los servidores de medios de WhatsApp.
4. Un sticker con sonido de WhatsApp es un `StickerMessage` normal que lleva un `AudioMessage` completo
   en el **campo 26** del protobuf. Baileys no conoce ese campo, así que el bot modifica el codificador del
   mensaje para agregarlo (`src/sticker-audio-patch.js`).
5. El sticker se envía como respuesta al mensaje que lo pidió.

## Características

- Stickers con sonido a partir de cualquier video con audio, hasta 25 s por defecto (configurable).
- Codificación que se adapta al contenido: elige los mejores fps y calidad que caben en 500 KB
  ([detalles](#cómo-se-codifican-los-videos-largos)).
- Audio y animación duran lo mismo al milisegundo, así el sonido no se desfasa cuando el sticker se repite.
- Validación local de cada sticker y audio antes de enviarlos.
- Inicio de sesión con código QR o con código de vinculación.
- Privacidad por defecto: los videos recibidos se procesan en una carpeta temporal que se borra al terminar.
- Ejecutables para Windows y Linux con FFmpeg incluido.
- Pruebas unitarias y de integración (`node:test`) y CI en Windows y Linux.

## Aviso legal

Este proyecto **no está afiliado, respaldado ni soportado por WhatsApp ni por Meta**. Usa una librería
no oficial. Automatizar una cuenta personal puede ir en contra de los
[Términos del servicio de WhatsApp](https://www.whatsapp.com/legal/terms-of-service) y **la cuenta puede
ser suspendida temporal o permanentemente**. Usa un número secundario que puedas perder, y usa el bot con
fines personales, no comerciales y sin spam. Eres responsable de cómo lo uses.

---

## Opción A: ejecutable listo para usar (recomendada)

No necesitas instalar Node.js ni FFmpeg: todo viene en el paquete.

1. Abre la [última versión publicada](https://github.com/DavidRamirez206/whatsapp-sound-sticker-bot/releases/latest).
2. Descarga el archivo de tu sistema:
   - Windows: `whatsapp-sound-sticker-bot-vX.Y.Z-windows-x64.zip`
   - Linux: `whatsapp-sound-sticker-bot-vX.Y.Z-linux-x64.tar.gz`
3. *(Recomendado)* Verifica la descarga con `SHA256SUMS.txt` de la misma versión:
   - Windows (PowerShell): `Get-FileHash .\whatsapp-sound-sticker-bot-*-windows-x64.zip -Algorithm SHA256`
   - Linux: `sha256sum -c SHA256SUMS.txt --ignore-missing`

   El hash que aparece debe ser idéntico al de `SHA256SUMS.txt`.
4. Extráelo en una carpeta propia (ahí el bot creará su carpeta de sesión).

### Windows

1. Clic derecho sobre el `.zip` → **Extraer todo…** → elige una carpeta, por ejemplo `C:\sound-sticker-bot`.
2. Doble clic en `sound-sticker-bot.exe`.
   - Windows SmartScreen puede decir *"Windows protegió su PC"* porque el ejecutable no está firmado.
     Haz clic en **Más información → Ejecutar de todas formas** solo si lo descargaste de la página oficial
     de versiones y el hash coincide.
3. Se abre una consola que muestra un código QR. Sigue con
   [Vincular tu cuenta de WhatsApp](#vincular-tu-cuenta-de-whatsapp).
4. Para detener el bot, cierra la ventana o presiona `Ctrl + C`.

> Consejo: si el QR se ve mal, abre la carpeta en **Windows Terminal** (clic derecho dentro de la carpeta →
> *Abrir en Terminal*) y ejecuta `.\sound-sticker-bot.exe`. Windows Terminal dibuja el QR mejor que la consola antigua.

### Linux

```bash
mkdir -p ~/sound-sticker-bot && cd ~/sound-sticker-bot
tar -xzf ~/Descargas/whatsapp-sound-sticker-bot-*-linux-x64.tar.gz --strip-components=1
./sound-sticker-bot
```

Si aparece *permiso denegado*, ejecuta `chmod +x sound-sticker-bot ffmpeg ffprobe` y vuelve a intentarlo.
El ejecutable es para sistemas x86-64 con glibc (Ubuntu, Debian, Fedora, Arch, Mint, …).

### Cambiar la configuración con el ejecutable

Copia `.env.example` como `.env` en la misma carpeta y edítalo con cualquier editor de texto
(ver [Configuración](#configuración)). Reinicia el bot después de cambiarlo.

---

## Opción B: ejecutar desde el código fuente

Requisitos:

| Herramienta | Versión | Para qué |
| --- | --- | --- |
| [Node.js](https://nodejs.org) | 22.12 o superior (se recomienda 24 LTS) | Ejecuta el bot |
| [FFmpeg](https://ffmpeg.org) (con `ffprobe`) | 6 o superior, compilado con `libwebp` y `libopus` | Convierte video y audio |
| [Git](https://git-scm.com) | cualquiera | Descarga el código (o baja el ZIP desde GitHub) |

### Windows

1. **Instala Node.js**
   - Descarga el instalador **LTS** desde <https://nodejs.org> y ejecútalo con las opciones por defecto, **o**
   - en PowerShell: `winget install OpenJS.NodeJS.LTS`
2. **Instala FFmpeg**
   - En PowerShell: `winget install Gyan.FFmpeg` (build completo, incluye `ffprobe`, `libwebp` y `libopus`), **o**
   - con [Chocolatey](https://chocolatey.org): `choco install ffmpeg`, **o**
   - a mano: descarga un build *full* desde <https://www.gyan.dev/ffmpeg/builds/>, extráelo en `C:\ffmpeg`
     y agrega `C:\ffmpeg\bin` al `Path` (Inicio → *Editar las variables de entorno del sistema* →
     *Variables de entorno* → `Path` → *Editar* → *Nuevo*).
3. **Instala Git** (opcional): `winget install Git.Git`
4. **Cierra y vuelve a abrir** PowerShell para que tome el nuevo `Path`, y comprueba:
   ```powershell
   node --version     # v22.12.0 o superior
   ffmpeg -version
   ffprobe -version
   ```
5. **Descarga e inicia el bot**
   ```powershell
   git clone https://github.com/DavidRamirez206/whatsapp-sound-sticker-bot.git
   cd whatsapp-sound-sticker-bot
   npm ci
   npm start
   ```

### Linux

1. **Instala FFmpeg y Git**
   ```bash
   # Debian / Ubuntu / Linux Mint
   sudo apt update && sudo apt install -y ffmpeg git curl

   # Fedora (activa antes RPM Fusion para tener FFmpeg completo: https://rpmfusion.org/Configuration)
   sudo dnf install -y ffmpeg git

   # Arch / Manjaro
   sudo pacman -S --needed ffmpeg git
   ```
2. **Instala Node.js** con [nvm](https://github.com/nvm-sh/nvm) (no necesita root y es fácil de actualizar):
   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
   source ~/.bashrc      # o abre una terminal nueva
   nvm install 24
   ```
   Los paquetes de la distribución (`apt install nodejs`) suelen estar desactualizados; revisa con `node --version`.
3. **Comprueba las herramientas**
   ```bash
   node --version                                   # v22.12.0 o superior
   ffmpeg -hide_banner -encoders | grep -E " libwebp | libopus "   # deben aparecer los dos
   ```
4. **Descarga e inicia el bot**
   ```bash
   git clone https://github.com/DavidRamirez206/whatsapp-sound-sticker-bot.git
   cd whatsapp-sound-sticker-bot
   npm ci
   npm start
   ```

#### Dejarlo corriendo en un servidor Linux (opcional)

Ejemplo de unidad `systemd` (`/etc/systemd/system/sound-sticker-bot.service`). Vincula la cuenta una vez de
forma interactiva con `npm start` antes de activar el servicio, porque el QR se muestra en la terminal.

```ini
[Unit]
Description=WhatsApp sound sticker bot
After=network-online.target

[Service]
User=tuusuario
WorkingDirectory=/home/tuusuario/whatsapp-sound-sticker-bot
ExecStart=/home/tuusuario/.nvm/versions/node/v24.11.1/bin/node index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now sound-sticker-bot
journalctl -u sound-sticker-bot -f     # registros en vivo
```

Ajusta `User`, las rutas y la versión de Node (`which node`) a tu equipo.

---

## Vincular tu cuenta de WhatsApp

El bot funciona como un **dispositivo vinculado** más de una cuenta de WhatsApp existente, igual que
WhatsApp Web. Se procesan los mensajes que reciba esa cuenta con el texto `!a`. **Usa un número secundario**
si puedes (ver [Aviso legal](#aviso-legal)).

### Con código QR (por defecto)

1. Inicia el bot. Aparece un código QR en la terminal.
2. En el celular: **WhatsApp → Ajustes (⋮ en Android) → Dispositivos vinculados → Vincular un dispositivo**.
3. Escanea el QR. La terminal muestra `[CONNECTION] linked`.

### Con código de vinculación (sin cámara)

1. Pon tu número en `.env`, con código de país y solo dígitos: `PAIRING_NUMBER=573001234567`.
2. Inicia el bot. Imprime `[LOGIN] Pairing code: ABCD-EFGH`.
3. En el celular: **Dispositivos vinculados → Vincular un dispositivo → Vincular con el número de teléfono**
   y escribe el código.

### Carpeta de sesión

Después de vincular, las credenciales quedan en `whatsapp_session/`. La próxima vez el bot inicia sesión
solo. **Esa carpeta equivale a tu contraseña**: quien la copie puede leer y enviar mensajes como tú.
Nunca la compartas, la subas ni la incluyas en un commit (ya está en `.gitignore`).

### Desvincular

- En el celular: **Dispositivos vinculados → toca el dispositivo → Cerrar sesión**, y luego borra `whatsapp_session/`.
- Si el bot dice `logged out`, borra `whatsapp_session/` e inícialo de nuevo para volver a vincular.

---

## Uso

1. Abre cualquier chat con la cuenta donde corre el bot (o, si vinculaste tu propio número, usa el chat
   **"Mensaje para ti"** / **"Tú"**).
2. Envía un **video con sonido** y escribe `!a` como texto del video.
3. El bot responde con el sticker animado. Tócalo para escuchar el sonido.

Notas:

- Los videos más largos que `MAX_SECONDS` (25 s por defecto) se recortan en ese punto.
- Los videos sin pista de audio se rechazan con un mensaje.
- También funciona en grupos: cualquier integrante puede usarlo (ver [riesgos](#5-usar-un-bot-en-grupos)).
- Las versiones de WhatsApp que no soportan stickers con sonido muestran solo la animación.

---

## Configuración

La configuración se hace con variables de entorno. Lo más fácil es un archivo `.env` junto al bot
(copia `.env.example` como `.env`). Las variables de entorno reales tienen prioridad sobre el archivo.

| Variable | Valor por defecto | Descripción |
| --- | --- | --- |
| `COMMAND` | `!a` | Texto que activa el bot. |
| `MAX_SECONDS` | `25` | Duración máxima del sticker en segundos (1–60). |
| `MAX_FRAMES` | `250` | Máximo de frames por sticker. Menos frames = menos tirones en celulares viejos. |
| `AUDIO_KBPS` | `32` | Bitrate Opus del audio del sticker. |
| `AUDIO_LEAD_MS` | `100` | Milisegundos que se saltan al inicio del audio para compensar el retraso de WhatsApp al reproducirlo. Súbelo si el sonido va atrasado; bájalo o ponlo en `0` si va adelantado. |
| `MAX_PARALLEL_JOBS` | `2` | Videos que se convierten a la vez. |
| `REPLY_TO_MESSAGE` | `1` | Envía el sticker como respuesta al mensaje que lo pidió. |
| `NOTIFY_ERRORS` | `1` | Responde con un texto corto cuando no se puede hacer el sticker (los problemas del propio video siempre se explican). |
| `MAX_MESSAGE_AGE_SECONDS` | `600` | Los comandos más viejos que esto se omiten (queda en el log y se pide reenviarlo en el chat). Cubre los comandos enviados mientras el bot estaba desconectado. |
| `JOB_TIMEOUT_SECONDS` | `300` | Un trabajo que tarde más que esto se abandona y se informa, para que no bloquee la cola. |
| `FFMPEG_TIMEOUT_SECONDS` | `180` | Cualquier proceso de FFmpeg/FFprobe que tarde más que esto se termina a la fuerza. |
| `SESSION_DIR` | `whatsapp_session` | Carpeta con las credenciales de WhatsApp. |
| `PAIRING_NUMBER` | *(vacío)* | Número (dígitos, con código de país) para iniciar sesión con código de vinculación en vez de QR. |
| `SAVE_OUTPUTS` | `0` | `1` guarda cada video recibido y los archivos generados en `OUTPUTS_DIR`. Desactivado por privacidad. |
| `OUTPUTS_DIR` | `outputs` | Dónde se guardan los archivos si `SAVE_OUTPUTS=1`. |
| `KEEP_OUTPUTS` | `15` | Cuántas carpetas guardadas se conservan (se borran las más viejas). |
| `DEBUG` | `0` | Modo diagnóstico: activa el comando de prueba, imprime los mensajes crudos del protocolo, analiza los stickers con sonido que llegan y verifica las subidas. |
| `TEST_COMMAND` | `!t` | (Solo en debug) Envía 5 stickers con distintas codificaciones de audio para comparar cuáles suenan. |
| `VERIFY_UPLOAD` | igual que `DEBUG` | Vuelve a descargar cada subida y comprueba hash y reproducción. |
| `FFMPEG_PATH`, `FFPROBE_PATH` | *(automático)* | Binarios de FFmpeg personalizados. Por defecto se buscan junto al ejecutable y luego en el `PATH`. |

Ejemplos:

```bash
# Linux / macOS, solo para esta ejecución
MAX_SECONDS=10 npm start
```

```powershell
# Windows PowerShell, solo para esta ejecución
$env:MAX_SECONDS=10; npm start
```

---

## Cómo se codifican los videos largos

WhatsApp rechaza stickers animados de más de **500 KB**, así que en clips largos hay que equilibrar fps y
calidad de imagen. La versión anterior del bot tenía tres problemas con videos de más de 10 s:

1. Un presupuesto fijo de frames (130) obligaba a bajar todos los clips largos a 5–6 fps, incluso los
   simples que podían tener más.
2. Adivinaba la calidad con una sola muestra de 3 segundos del centro del clip; en videos con mucho detalle
   se equivocaba y terminaba haciendo una escalera de cinco codificaciones completas.
3. Codificaba con el nivel de esfuerzo más lento, muchas veces más lento que el nivel 4 para archivos solo
   ~2 % más pequeños.

El codificador actual (`src/media/sticker.js`):

1. Codifica **cada frame como una imagen completa** con `libwebp` de FFmpeg. El codificador animado
   (`libwebp_anim`) da archivos más pequeños, pero reutiliza bloques del frame anterior cuando "casi no
   cambiaron", con una tolerancia que crece al bajar la calidad; con las calidades que necesitan los clips
   largos deja bloques viejos y pixelados sobre la imagen en movimiento, por eso no se usa.
2. Arma una muestra con tres ventanas de 1 segundo repartidas a lo largo del clip y la codifica en 8
   niveles de calidad en paralelo, midiendo el **costo de un frame** en cada calidad. Como los frames son
   independientes, el tamaño del sticker completo se puede predecir: crece de forma lineal con los frames.
3. Elige los **fps más altos que mantienen calidad ≥ 30** dentro del presupuesto (luego ≥ 12), con el tope
   de `MAX_FRAMES`. Si ni así cabe, deja 5 fps y la mejor calidad que quepa: se ven mejor frames nítidos
   que unos cuantos frames extra borrosos. Los videos simples o casi estáticos conservan hasta 15 fps
   aunque sean largos.
4. Codifica el clip completo con nivel de esfuerzo 4. Si sobró espacio, prueba un escalón más de calidad
   y lo conserva si sigue por debajo de 500 KB.

Medido en la misma máquina con videos reales (el PSNR compara cada frame del sticker con el frame
original del video; más alto = más nítido):

| Clip | Antes | Ahora |
| --- | --- | --- |
| 6,5 s, 1280×2276 | 15 fps, q50, 26,4 dB – 14,3 s | 15 fps, q75, 26,7 dB – 10,0 s |
| 18,9 s, 800×480 | 5 fps, q6, 29,9 dB – 24,4 s | 5 fps, q6, 29,9 dB – 10,1 s |
| 22,9 s, 800×480 | 5 fps, q6, 30,8 dB – 25,2 s | 5 fps, q6, 30,8 dB – 18,0 s |
| 25 s (recortado de 120 s), 496×368 | 5 fps, q6, 33,5 dB – 10,2 s | 5 fps, q12, 34,5 dB – 18,3 s |

"q" es la calidad de libwebp (0–100); el tiempo es el de la conversión completa. Los clips con mucho
detalle y movimiento de 20 s o más simplemente no admiten más de ~5 fps en 500 KB sin perder nitidez visible.

---

## Confiabilidad

El bot está pensado para correr días sin supervisión, así que nunca falla en silencio:

- **Todo comando tiene un resultado.** Se procesa, o el chat recibe una explicación corta de por qué no
  (sin audio, video ilegible, tardó demasiado, problema de conexión), o queda en el log como `[SKIP]`
  porque es más viejo que `MAX_MESSAGE_AGE_SECONDS` y se pide en el chat que lo envíen de nuevo.
- **Los comandos enviados mientras el bot estaba desconectado no se pierden.** WhatsApp los entrega al
  reconectar y se procesan si son recientes (10 minutos por defecto).
- **La conexión siempre vuelve.** Caídas, suspensión del equipo y cambios de red activan la reconexión con
  espera exponencial (hasta 60 s entre intentos), sin límite de intentos. Un watchdog reinicia la conexión
  si alguna vez queda caída sin nada pendiente. Solo se detiene cuando reintentar no sirve (sesión cerrada,
  la misma sesión abierta en otra instancia, cuenta bloqueada) y el log dice qué hacer.
- **Nada puede colgar el bot.** Descargas, subidas y envíos tienen límite de tiempo y reintentos, y siempre
  usan la conexión actual; los procesos de FFmpeg se terminan después de `FFMPEG_TIMEOUT_SECONDS`; un
  trabajo completo se abandona después de `JOB_TIMEOUT_SECONDS` y libera su lugar en la cola.
- **Los reenvíos siguen funcionando.** Cuando un celular no puede descifrar el sticker, WhatsApp le pide al
  bot que lo envíe otra vez; los mensajes recientes y su audio se guardan una hora, incluso entre
  reconexiones, así que el sticker reenviado sigue teniendo sonido.
- **Los errores quedan contenidos.** Un mensaje dañado, un trabajo que falla o una excepción inesperada se
  registran con su causa y el bot sigue atendiendo los siguientes. Ctrl+C o detener el servicio cierra la
  sesión de forma limpia.
- El bot no marca la cuenta como "en línea", así tu celular sigue recibiendo notificaciones.

Estos comportamientos están cubiertos por pruebas en `test/unit/connection.test.js` y `test/unit/bot.test.js`.

---

## Estructura del proyecto

```text
index.js                      Punto de entrada (manejo de errores fatales)
src/
├── main.js                   Arranque: configuración, chequeo de FFmpeg, parches del protocolo
├── config.js                 Lectura de variables de entorno / .env
├── bot.js                    Enrutamiento de mensajes y ejecución de trabajos (todo comando tiene resultado)
├── handlers.js               Comando de sticker y comando de prueba (debug)
├── errors.js                 Errores para el usuario y explicaciones en el chat
├── queue.js                  Cola de trabajos con límite de concurrencia
├── retry.js                  Pasos cronometrados con límites de tiempo y reintentos
├── ttl-cache.js              Caché acotada con expiración
├── workdir.js                Carpetas de trabajo temporales / guardadas
├── logger.js                 Registro en consola (oculta los volcados de sesiones Signal)
├── protobuf.js               Lector de protobuf sin esquema
├── sticker-audio-patch.js    Agrega el audio (campo 26) a los stickers salientes
├── media/
│   ├── ffmpeg.js             Localización y ejecución de FFmpeg / FFprobe
│   ├── probe.js              Inspección de video y audio
│   ├── sticker.js            Video → WebP animado (planificador de fps / calidad)
│   ├── audio.js              Extracción de audio y forma de onda
│   ├── webp.js               Lector del contenedor WebP
│   └── validate.js           Validación antes de enviar
└── whatsapp/
    ├── connection.js         Conexión resiliente: login, reconexión con espera, watchdog
    ├── send.js               Subida y envío del sticker con sonido
    ├── verify.js             Verificación opcional volviendo a descargar
    └── inspect.js            Debug: análisis de stickers con sonido entrantes
scripts/
├── bundle.js                 Empaquetado con esbuild → dist/bot.cjs
└── build-sea.js              Ejecutable único de Node → dist/sound-sticker-bot(.exe)
test/
├── unit/                     Pruebas de lógica pura
└── integration/              Pruebas con FFmpeg real (se omiten si no está instalado)
```

## Pruebas

```bash
npm test            # unitarias + integración (las de integración se omiten si falta FFmpeg)
npm run test:unit   # solo unitarias, no requieren FFmpeg
```

Se usa el test runner incluido en Node; no hay dependencias de pruebas. La CI las ejecuta en Windows y
Linux con Node 22 y 24 en cada push y pull request.

## Compilar el ejecutable y publicar versiones

Compilar localmente (genera un ejecutable para el sistema actual en `dist/`):

```bash
npm ci
npm run build:exe
```

El proceso empaqueta todo el código con **esbuild** en `dist/bot.cjs` y lo inyecta en una copia del binario
de Node usando [aplicaciones ejecutables únicas de Node](https://nodejs.org/api/single-executable-applications.html).
FFmpeg no va embebido: pon `ffmpeg` y `ffprobe` junto al ejecutable o en el `PATH`.

La publicación de versiones está automatizada en `.github/workflows/release.yml`:

```bash
git tag v1.0.1
git push origin v1.0.1
```

El workflow ejecuta las pruebas, compila los ejecutables en Windows y Linux, agrega los
[builds LGPL de FFmpeg de BtbN](https://github.com/BtbN/FFmpeg-Builds), comprueba que incluyan los
codificadores necesarios y publica los archivos junto con `SHA256SUMS.txt` en la página de la versión.

## Solución de problemas

| Problema | Solución |
| --- | --- |
| `FFmpeg/FFprobe not found` | Instala FFmpeg (ver arriba) y vuelve a abrir la terminal, o usa el paquete de la versión publicada, o define `FFMPEG_PATH`/`FFPROBE_PATH`. |
| `Your FFmpeg build lacks the encoder(s)` | Tu FFmpeg es un build mínimo. Instala uno completo (`Gyan.FFmpeg` en Windows, RPM Fusion en Fedora). |
| El QR no se puede leer | Agranda la terminal o usa Windows Terminal, o inicia sesión con `PAIRING_NUMBER`. |
| `logged out` | El dispositivo se desvinculó desde el celular. Borra `whatsapp_session/` y vuelve a vincular. |
| No pasa nada al enviar `!a` | El texto debe ser exactamente `!a` y el mensaje debe ser un video (no un GIF). Busca en la consola `[IN]` (recibido), `[SKIP]` (muy viejo) o `[ERR]` (falló, con la causa). Si no aparece ninguna línea, busca `[CONNECTION]`: el bot puede estar reconectando. |
| `closed: this session was opened somewhere else` | El bot está corriendo dos veces con la misma carpeta `whatsapp_session/`. Cierra la otra. |
| `fetch failed` / `ETIMEDOUT` | Problema de red con los servidores de medios de WhatsApp. El bot reintenta solo; revisa tu conexión o firewall. |
| El sticker llega sin sonido | La versión de WhatsApp de quien lo recibe quizá no soporta stickers con sonido (actualízala). Con `DEBUG=1`, usa `!t` para comparar codificaciones de audio. |
| El sonido va desfasado | Ajusta `AUDIO_LEAD_MS` (por ejemplo `0`, `100`, `200`). |
| Error `require() of ES Module` | Tu Node.js es anterior a 22.12. Actualízalo. |

---

## Seguridad, privacidad y riesgos

Este bot es pequeño, pero toca todo lo que hace riesgosos a los bots de mensajería: una cuenta, archivos de
otras personas, servidores y ejecutables. Lo que sigue aplica a **cualquier** bot de WhatsApp, Telegram,
Discord, Instagram o plataformas similares, y también a "convertidores" en línea y herramientas de IA.

### 1. El cifrado de extremo a extremo termina en el bot

WhatsApp cifra los mensajes entre dispositivos, pero **un bot es uno de esos dispositivos**. Cuando le envías
un video a un bot, se descifra en el computador o servidor de quien lo administra, y desde ahí esa persona
puede hacer lo que quiera con él: verlo, guardarlo, reenviarlo, usarlo para entrenar modelos o venderlo.
El cifrado protege el viaje, no lo que el receptor hace con el contenido.

- Este bot procesa cada video en una carpeta temporal y **lo borra** al terminar, salvo que quien lo opera
  active `SAVE_OUTPUTS=1`. Pero **no puedes comprobar eso desde afuera** con el bot de otra persona.
  Asume que todo lo que envías a un bot que no administras tú se queda guardado.

### 2. Qué no enviarle a un bot

- Videos o fotos con tu **cara o cuerpo en situaciones privadas**, **menores de edad**, tu casa, tu
  **documento de identidad**, documentos, información bancaria o médica, placas de vehículos o pantallas con
  datos personales.
- Nada que no quieras ver publicado: una vez que el sticker existe **se puede reenviar sin fin y no se puede
  recuperar**. Borrar el mensaje no borra las copias.
- **Metadatos**: los archivos enviados como *documento* conservan sus metadatos originales (fecha, modelo
  del celular y a veces la **ubicación GPS**). Mejor envía los archivos de forma normal o quítales los metadatos antes.
- **Imágenes de otras personas sin su consentimiento.** Convertir a alguien en sticker puede ser acoso y,
  según el país, un delito (derecho a la propia imagen, leyes de protección de datos como la Ley 1581 de 2012
  en Colombia o el RGPD en Europa). Respeta también los derechos de autor.

### 3. Tu cuenta y la carpeta de sesión

- `whatsapp_session/` contiene las llaves de un dispositivo vinculado: **quien la tenga puede leer y enviar
  tus mensajes** sin que en el celular se note algo evidente. Nunca la subas, la compartas, la incluyas en un
  commit ni en una copia de seguridad que no controles.
- El bot recibe (y descifra) **todos los mensajes de la cuenta vinculada**, no solo los comandos. Ejecútalo en
  un computador de confianza, con el sistema actualizado y con contraseña de usuario.
- Revisa con frecuencia **Dispositivos vinculados** en tu celular y cierra la sesión de lo que no reconozcas.
- Los clientes no oficiales pueden hacer que **suspendan** el número. Usa un número secundario; nunca el del trabajo.

### 4. Códigos, enlaces y bots falsos

- **Nunca compartas el código de verificación de 6 dígitos de WhatsApp** ni un código de vinculación con
  nadie, aunque te lo pida un "bot", "soporte técnico" o un amigo: así es como se roban las cuentas.
- Vincula dispositivos solo escaneando un QR o escribiendo un código **generado por ti** en tu propio
  computador. Nunca escanees un QR que alguien te mande "para activar el bot".
- Desconfía de bots que piden permisos, pagos, datos personales, o que envían enlaces o archivos APK.
  Un bot de stickers solo necesita un video.

### 5. Usar un bot en grupos

- Cualquier integrante puede activarlo, y se puede abusar de él para **gastar tu CPU y tu internet** o para
  enviar contenido indeseado en tu nombre. `MAX_PARALLEL_JOBS` y `MAX_SECONDS` limitan el costo.
- Todo lo que el bot envía sale **desde tu cuenta**: tú eres responsable.
- Avisa en el grupo que hay un bot: los mensajes de los demás se descifran en tu computador.

### 6. Registros (logs)

- La consola muestra números de teléfono / identificadores de chats y nombres de contactos. Con `DEBUG=1`
  muestra todavía más. **Ocúltalos antes de compartir un log** en un issue o en un chat.
- El bot ya oculta los volcados de sesiones Signal que imprime la librería interna, porque contienen llaves privadas.

### 7. Ejecutables y dependencias

- Descarga los ejecutables **solo desde la página oficial de versiones** y verifica el hash de
  `SHA256SUMS.txt`. Un ejecutable de "bot de stickers" alterado es una forma fácil de propagar malware.
- Los ejecutables no están firmados, por eso Windows muestra la advertencia de SmartScreen. Si prefieres no
  ejecutar un binario sin firma, usa la [Opción B](#opción-b-ejecutar-desde-el-código-fuente) y lee el código antes.
- Mantén Node.js, FFmpeg y las dependencias actualizados (`npm outdated`, `npm audit`). Baileys es una librería
  hecha por ingeniería inversa: los cambios en el protocolo de WhatsApp pueden romperla.

### Lista rápida

- [ ] Uso un número secundario para el bot.
- [ ] `whatsapp_session/` y `.env` se quedan solo en mi equipo.
- [ ] Solo envío archivos que no me molestaría ver publicados.
- [ ] Tengo el consentimiento de las personas que aparecen en los videos.
- [ ] Nunca comparto códigos de verificación ni de vinculación.
- [ ] Descargué el ejecutable de la página oficial y verifiqué su hash.
- [ ] Reviso de vez en cuando los dispositivos vinculados en mi celular.

---

## Licencia

[MIT](LICENSE) © 2026 Ismael Barrionuevo.

Los paquetes publicados incluyen binarios sin modificar de [FFmpeg](https://ffmpeg.org) con licencia
**LGPL v2.1 o posterior** (compilados por [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds)); ver
`FFMPEG-LICENSE.txt` y `FFMPEG-NOTICE.txt` dentro de cada paquete. WhatsApp es una marca registrada de Meta
Platforms, Inc.

Hecho con [Baileys](https://github.com/WhiskeySockets/Baileys), [FFmpeg](https://ffmpeg.org),
[pino](https://github.com/pinojs/pino) y [qrcode-terminal](https://github.com/gtanner/qrcode-terminal).
