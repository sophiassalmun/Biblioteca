// ===== Constantes =====
const MAX_CARACTERES = 500;
const PAUSA_MINIMA_MS = 1500;      // pausa mínima entre envíos
const TIEMPO_LIMITE_MS = 30000;    // 30 segundos de espera máxima
const CLAVE_SESION = "biblioteca_sessionId";

// ===== Referencias al DOM =====
const zonaDeChat = document.getElementById("zona-de-chat");
const zonaDeEscritura = document.getElementById("zona-de-escritura");
const campoMensaje = document.getElementById("campo-mensaje");
const botonEnviar = document.getElementById("boton-enviar");
const contador = document.getElementById("contador");

// ===== Estado =====
let sessionIdEnMemoria = null;
let ultimoEnvio = 0;
let enviando = false;

// ===== Sesión =====

// Genera un identificador único
function generarId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "id-" + Date.now() + "-" + Math.random().toString(36).slice(2);
}

// Obtiene el sessionId: lo crea una sola vez y lo reutiliza
function obtenerSessionId() {
  if (sessionIdEnMemoria) return sessionIdEnMemoria;
  try {
    let guardado = localStorage.getItem(CLAVE_SESION);
    if (!guardado) {
      guardado = generarId();
      localStorage.setItem(CLAVE_SESION, guardado);
    }
    sessionIdEnMemoria = guardado;
  } catch (e) {
    // Si no hay almacenamiento disponible, se usa solo la memoria
    sessionIdEnMemoria = generarId();
  }
  return sessionIdEnMemoria;
}

const sessionId = obtenerSessionId();

// ===== Funciones del chat =====

// Agrega una burbuja a la Zona de chat (siempre con textContent)
function agregarBurbuja(texto, tipo) {
  const burbuja = document.createElement("div");
  burbuja.className = "burbuja " + tipo;
  burbuja.textContent = texto;
  zonaDeChat.appendChild(burbuja);
  bajarChat();
  return burbuja;
}

// Muestra los tres puntitos mientras se espera la respuesta
function mostrarCargando() {
  const burbuja = document.createElement("div");
  burbuja.className = "burbuja cargando";
  for (let i = 0; i < 3; i++) {
    burbuja.appendChild(document.createElement("span"));
  }
  zonaDeChat.appendChild(burbuja);
  bajarChat();
  return burbuja;
}

function bajarChat() {
  zonaDeChat.scrollTop = zonaDeChat.scrollHeight;
}

// Habilita o deshabilita la Zona de escritura
function bloquearEscritura(bloquear) {
  botonEnviar.disabled = bloquear;
  campoMensaje.disabled = bloquear;
}

function actualizarContador() {
  contador.textContent = campoMensaje.value.length + "/" + MAX_CARACTERES;
}

// Ajusta la altura del textarea al contenido
function ajustarAltura() {
  campoMensaje.style.height = "auto";
  campoMensaje.style.height = campoMensaje.scrollHeight + "px";
}

function esperar(ms) {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

// ===== Webhook =====

function webhookSinConfigurar() {
  return !WEBHOOK_URL || WEBHOOK_URL.includes("ACA VA");
}

// Interpreta el texto recibido de Make y devuelve lo que se muestra
function interpretarRespuesta(texto) {
  if (texto.trim() === "") return "(respuesta vacía)";

  let datos;
  try {
    datos = JSON.parse(texto);
  } catch (e) {
    return texto; // No es JSON: se muestra tal cual (ej. "Accepted")
  }

  if (datos && typeof datos === "object" && !Array.isArray(datos)) {
    const claves = ["response", "respuesta", "message", "mensaje"];
    for (const clave of claves) {
      const valor = datos[clave];
      if (typeof valor === "string" && valor.trim() !== "") return valor;
    }
    return "Make respondió, pero sin el campo response";
  }

  return texto; // JSON válido pero no es un objeto
}

// Envía el mensaje al webhook y devuelve el texto a mostrar
async function enviarAlWebhook(mensaje) {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), TIEMPO_LIMITE_MS);

  try {
    const respuesta = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        mensaje,
        fecha: new Date().toISOString()
      }),
      signal: controlador.signal
    });

    const texto = await respuesta.text();

    if (!respuesta.ok) {
      const error = new Error("http");
      error.tipo = "http";
      error.codigo = respuesta.status;
      throw error;
    }

    return interpretarRespuesta(texto);
  } finally {
    clearTimeout(temporizador);
  }
}

// Convierte un error en un mensaje claro para la persona
function mensajeDeError(error) {
  if (error.tipo === "http") {
    return "Make respondió con error (código " + error.codigo + "). " +
      "Revisá que tu escenario esté en Active o que hayas apretado Run once.";
  }
  if (error.name === "AbortError") {
    return "Tiempo agotado: el servidor tardó más de 30 segundos en responder. Probá de nuevo.";
  }
  return "Falla de red: no se pudo conectar con el servidor. Revisá tu conexión.";
}

// ===== Envío del mensaje =====

async function manejarEnvio(evento) {
  evento.preventDefault();
  if (enviando) return;

  const mensaje = campoMensaje.value.trim();
  if (mensaje === "") return;

  // Validación de longitud
  if (mensaje.length > MAX_CARACTERES) {
    agregarBurbuja("El mensaje supera los " + MAX_CARACTERES + " caracteres.", "error");
    return;
  }

  // Pausa mínima entre envíos
  if (Date.now() - ultimoEnvio < PAUSA_MINIMA_MS) return;

  // Se muestra el mensaje de la persona
  agregarBurbuja(mensaje, "usuario");
  campoMensaje.value = "";
  actualizarContador();
  ajustarAltura();

  // Si falta configurar el webhook, no se hace el fetch
  if (webhookSinConfigurar()) {
    agregarBurbuja("Falta pegar la URL de tu webhook en config.js", "error");
    return;
  }

  enviando = true;
  ultimoEnvio = Date.now();
  bloquearEscritura(true);
  const indicador = mostrarCargando();

  try {
    const texto = await enviarAlWebhook(mensaje);   // éxito
    agregarBurbuja(texto, "agente");
  } catch (error) {
    agregarBurbuja(mensajeDeError(error), "error"); // error
  } finally {
    indicador.remove(); // nunca queda en estado "cargando"
    const restante = PAUSA_MINIMA_MS - (Date.now() - ultimoEnvio);
    if (restante > 0) await esperar(restante);
    enviando = false;
    bloquearEscritura(false);
    campoMensaje.focus();
  }
}

// ===== Eventos =====

zonaDeEscritura.addEventListener("submit", manejarEnvio);

campoMensaje.addEventListener("input", () => {
  actualizarContador();
  ajustarAltura();
});

// Enter envía; Shift+Enter agrega un salto de línea
campoMensaje.addEventListener("keydown", (evento) => {
  if (evento.key === "Enter" && !evento.shiftKey) {
    evento.preventDefault();
    zonaDeEscritura.requestSubmit();
  }
});

// ===== Inicio =====
agregarBurbuja(
  "¡Hola! Soy Biblioteca. Contame qué libros te gustan y qué tropos buscás, y te recomiendo lecturas.",
  "agente"
);
actualizarContador();
