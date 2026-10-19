<div align="center">

<img src="./easy-speak/public/favicon.svg" width="76" height="76" alt="EasySpeak" />

# EasySpeak · 轻松说

[简体中文](./README.md) · [English](./README.en.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md) · **Español** · [Français](./README.fr.md) · [Deutsch](./README.de.md)

**Practica el idioma que quieres hablar, como si charlaras con un amigo.**

</div>

EasySpeak (轻松说) es una aplicación web de conversación con IA para adultos, diseñada primero para móviles. Un interlocutor principal mantiene la charla y dos paneles de apoyo funcionan por separado: el superior sugiere qué decir después y el inferior comenta únicamente tu última intervención.

> **Código abierto bajo [Apache License 2.0](./LICENSE). Se permiten el uso comercial, la modificación y la distribución conforme a sus condiciones.** Conserva los avisos de licencia y atribución exigidos e identifica los cambios. Las dependencias mantienen sus propias licencias.

Cambia el idioma del README mediante los enlaces de arriba. La documentación técnica detallada está actualmente, en su mayoría, en chino.

## Funciones

- **Conversación por voz:** turnos semidúplex; el micrófono se activa cuando termina la IA. Incluye transcripción, respuesta en streaming y síntesis de voz. También admite texto.
- **Dos apoyos independientes:** ideas, expresiones y ejemplos desplegables arriba; comentarios sobre la última intervención del usuario abajo. Cada panel se actualiza y reintenta por separado.
- **Idiomas y niveles:** elige el idioma de apoyo y el de práctica, intercámbialos o introduce códigos de idioma. A1–C1 sirve como referencia de dificultad.
- **Práctica personalizada:** describe cualquier situación y añade artículos, un currículo, vocabulario u otro material. Revisa la importación antes de usarla y guarda plantillas.
- **Archivos e imágenes:** TXT, Markdown, CSV, PDF con texto, DOCX, PNG, JPG y WebP. Los documentos se convierten en texto localmente; las imágenes seleccionadas requieren un modelo con visión.
- **Proveedores:** MiniMax, DeepSeek, OpenAI, Qwen y API compatibles con Chat Completions. Los apoyos pueden usar distintos ID de modelo con el mismo proveedor y clave de conversación.
- **Voces y pausas:** doce voces MiniMax con nombre y preescucha, voces del dispositivo, ID personalizados y pausas de dos, tres o cinco segundos.
- **Aprendizaje:** doce lecciones comunicativas, expresiones guardadas, cuaderno de correcciones, repaso espaciado, objetivos y estadísticas por pareja de idiomas. Cuatro temas, subtítulos opcionales, traducción a petición, repetición tras corregir y exportación de texto.

**La cámara solo ofrece una vista previa local: la IA no recibe sus imágenes.** No se ha implementado comprensión de vídeo en directo. Leer una imagen seleccionada en la práctica personalizada es una carga explícita e independiente.

## Inicio rápido

Necesitas Node.js 22.13 o posterior (se recomienda 24), npm y un navegador moderno. Para el reconocimiento del navegador se recomienda Chrome / Edge; los idiomas disponibles dependen del servicio.

Desde la raíz del repositorio:

```sh
cd easy-speak
npm ci --cache .npm-cache
npm run dev
```

Abre la dirección indicada, normalmente <http://127.0.0.1:5173/>.

1. En los ajustes de la esquina superior derecha, selecciona un proveedor e introduce Base URL, tu clave API y el ID del modelo.
2. En las preferencias de voz, elige reconocimiento del navegador / voz del dispositivo o configura MiniMax ASR / TTS.
3. Permite el micrófono y habla cuando termine tu interlocutor. Sigue las indicaciones si se bloquean permisos o audio, o escribe.
4. Cambia idiomas o situaciones arriba. La práctica personalizada está dentro del selector de situaciones.

Sin clave solo está disponible una demostración local identificada, de inglés con ayuda en chino. Otras parejas de idiomas, la práctica personalizada y las respuestas reales requieren un proveedor. No se incluye una clave compartida ni una cuota gratuita; los cargos corresponden a tu cuenta.

### Opcional: proxy local MiniMax

En el directorio de la aplicación, copia el ejemplo:

```sh
# macOS / Linux
cp .env.example .env.local
```

```powershell
# Windows PowerShell
Copy-Item .env.example .env.local
```

Configura MINIMAX_API_KEY en .env.local y reinicia el servidor. No uses el prefijo VITE_ para secretos ni incluyas .env.local en Git. El navegador solo recibe el estado y un valor de sustitución.

El proxy acepta únicamente conexiones de bucle local. Es para desarrollo; no acompaña al alojamiento estático ni sirve como backend público compartido. Consulta [proveedores](./easy-speak/docs/providers.md).

En Windows, después de instalar dependencias, puedes iniciar en segundo plano desde la raíz del repositorio:

```powershell
.\Start-EasySpeak.ps1
```

Reutiliza un servidor sano o lo inicia oculto, con los registros dentro del proyecto. No configura el inicio automático de Windows.

## Arquitectura, permisos y privacidad

La cadena es **ASR → modelo de lenguaje → TTS**. La respuesta principal y la revisión se ejecutan en paralelo; las sugerencias aparecen al terminar la respuesta. Las cancelaciones y versiones impiden que tareas antiguas sobrescriban la sesión nueva.

- El micrófono es necesario para hablar. MiniMax ASR recibe la grabación actual; el reconocimiento del navegador depende de su navegador y servicio.
- La cámara es opcional y local: no graba ni sube fotogramas; se libera al cerrarla, terminar la sesión o pasar a segundo plano.
- Solo se leen archivos seleccionados. Los documentos se procesan localmente; la comprensión de imágenes sube una copia comprimida. El material de texto aceptado se envía al modelo al comenzar.
- Las claves directas se guardan en sessionStorage de la pestaña, que no es una bóveda segura. La clave del proxy permanece en .env.local, excluido de Git; las preferencias persistentes y las exportaciones no incluyen claves.
- Historial, expresiones y plantillas guardadas explícitamente permanecen en el navegador. No hay cuentas ni sincronización en la nube; exporta antes de borrar datos.

## Desarrollo y documentación

La aplicación está en easy-speak/. src/ contiene componentes, hooks y módulos; server/ contiene el proxy y las comprobaciones de compilación; tests/ y docs/ contienen pruebas y especificaciones. Se conservan las claves antiguas de almacenamiento para mantener los datos existentes.

Dentro de la aplicación:

```sh
npm run format:check
npm run lint
npm test
npm run build
npm run preview
```

La salida está en easy-speak/dist; preview es solo para comprobación local. Genera un ZIP del código desde la raíz:

```powershell
.\Export-EasySpeak.ps1
```

Crea release/easy-speak-source.zip con una lista explícita y comprueba claves conocidas y patrones comunes. Excluye secretos de entorno, dependencias, cachés, registros, compilaciones y datos del navegador. No sube nada.

[Funciones](./easy-speak/docs/features.md) · [Arquitectura](./easy-speak/docs/architecture.md) · [Práctica personalizada](./easy-speak/docs/custom-training.md) · [Idiomas](./easy-speak/docs/languages.md) · [Voces](./easy-speak/docs/voices.md) · [Aprendizaje](./easy-speak/docs/learning.md) · [Permisos](./easy-speak/docs/permissions.md) · [Empaquetado](./easy-speak/docs/packaging.md) · [Despliegue](./easy-speak/DEPLOYMENT.md) · [Seguridad](./easy-speak/docs/security-review.md) · [Validación](./easy-speak/docs/verification.md)

Actualmente es una Web App, sin APK / IPA listo ni proyecto móvil nativo. El audio, Bluetooth y comportamiento en segundo plano requieren pruebas reales. No hay autenticación ni protección de cuotas y facturación para un backend público. La compatibilidad de modelos, idiomas, voces y CORS depende del proveedor. Los comentarios se basan en texto y no miden pronunciación ni fluidez real.

## Contribuciones y licencia

Consulta las [normas de desarrollo](./easy-speak/CONTRIBUTING.md) y [seguridad](./SECURITY.md). No publiques claves o material privado.

El código original está bajo [Apache License 2.0](./LICENSE), que permite uso comercial, modificación y distribución. Conserva los avisos aplicables de [NOTICE](./NOTICE) y copyright, adjunta la licencia al redistribuir y señala los cambios. No se conceden derechos de marca ni garantías; prevalece el texto inglés. Véanse los [avisos de terceros](./THIRD_PARTY_NOTICES.md).
