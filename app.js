const { useState, useEffect, useCallback } = React;

// ---------- helpers ----------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const nowISO = () => new Date().toISOString();
const fmtGs = (n) => "₲ " + new Intl.NumberFormat("es-PY").format(Math.round(n || 0));
const fmtBRL = (n) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);
const fmtMoney = (n, cur) => (cur === "GS" ? fmtGs(n) : fmtBRL(n));
const fmtDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString("es-PY", { dateStyle: "short", timeStyle: "short" }) : "-";
const todayStr = () => new Date().toISOString().slice(0, 10);
const dayOf = (iso) => iso.slice(0, 10);

// Intenta mandar el ticket directo al servidor de impresión local (sin diálogo de Windows).
// Si no está prendido o falla, devuelve false para que la app avise con un cartel de advertencia.
async function imprimirDirecto({ lines, logo, cortar = true }) {
  try {
    const res = await fetch("http://localhost:5555/imprimir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines, logo: logo || null, cortar }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    return !!data.ok;
  } catch (err) {
    return false;
  }
}

// Arma una línea con dos columnas: texto a la izquierda, texto a la derecha, alineados con espacios,
// tal como se ve en una impresora térmica (fuente monoespaciada). ANCHO_TICKET = caracteres por línea.
const ANCHO_TICKET = 42;
function filaTicket(izq, der, ancho = ANCHO_TICKET) {
  izq = String(izq); der = String(der);
  const espacios = Math.max(1, ancho - izq.length - der.length);
  return izq + " ".repeat(espacios) + der;
}

// Arma las líneas del ticket de venta, listas para mandar al servidor de impresión.
function construirLineasTicketVenta(venta, config) {
  const nombreNegocio = config?.nombreNegocio?.trim() || "TAP CONTROL";
  const L = [];
  L.push({ text: nombreNegocio, bold: true, big: true, align: "center" });
  if (config?.direccion?.trim()) L.push({ text: config.direccion.trim(), align: "center" });
  L.push({ text: "" });
  L.push({ text: `Empleado: ${venta.operador}` });
  L.push({ text: "................................" });
  venta.items.forEach((i) => {
    L.push({ text: filaTicket(i.nombre, fmtMoney(i.subtotal, venta.moneda)) });
    L.push({ text: `  ${i.qty} x ${fmtMoney(i.precioUnit, venta.moneda)}` });
  });
  L.push({ text: "................................" });
  L.push({ text: filaTicket("Total", fmtMoney(venta.total, venta.moneda)), bold: true, big: true });
  L.push({ text: filaTicket(venta.metodoPago === "efectivo" ? "Efectivo" : "Tarjeta", fmtMoney(venta.total, venta.moneda)) });
  L.push({ text: "................................" });
  L.push({ text: "Gracias por su preferencia", align: "center" });
  L.push({ text: "" });
  L.push({ text: filaTicket(fmtDateTime(venta.fecha), `#${String(venta.numero ?? "-").padStart(4, "0")}`) });
  return L;
}

// Achica una foto (File) y la devuelve como texto base64 listo para guardar.
// maxDim = tamaño máximo en píxeles del lado más largo. quality = calidad JPG (0 a 1).
function resizeImageToBase64(file, maxDim = 220, quality = 0.6) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Archivo de imagen inválido"));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) { height = Math.round((height * maxDim) / width); width = maxDim; }
        else if (height > maxDim) { width = Math.round((width * maxDim) / height); height = maxDim; }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        // El PNG se mantiene como PNG (conserva transparencia); todo lo demás se guarda como JPG.
        const outMime = file.type === "image/png" ? "image/png" : "image/jpeg";
        resolve(canvas.toDataURL(outMime, outMime === "image/jpeg" ? quality : undefined));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const CATS = [
  { id: "chop", label: "Chop / Tirada", emoji: "🍺" },
  { id: "botella_cerveza", label: "Botella Cerveza", emoji: "🍾" },
  { id: "agua", label: "Agua", emoji: "💧" },
];

const SEED_PRODUCTS = [
  { id: uid(), nombre: "Chop Brahma 300ml", marca: "Brahma", categoria: "chop", tamano: "300ml", precioGs: 8000, precioBRL: 6, activo: true },
  { id: uid(), nombre: "Chop Brahma 500ml", marca: "Brahma", categoria: "chop", tamano: "500ml", precioGs: 12000, precioBRL: 9, activo: true },
  { id: uid(), nombre: "Chop Stella Artois 300ml", marca: "Stella Artois", categoria: "chop", tamano: "300ml", precioGs: 10000, precioBRL: 8, activo: true },
  { id: uid(), nombre: "Chop Stella Artois 500ml", marca: "Stella Artois", categoria: "chop", tamano: "500ml", precioGs: 15000, precioBRL: 12, activo: true },
  { id: uid(), nombre: "Cerveza Botella Brahma", marca: "Brahma", categoria: "botella_cerveza", tamano: "Unidad", precioGs: 10000, precioBRL: 8, activo: true },
  { id: uid(), nombre: "Agua Mineral", marca: "Crystal", categoria: "agua", tamano: "500ml", precioGs: 5000, precioBRL: 4, activo: true },
];

// ---------- Firestore wrapper (colección "tapcontrol", un doc por lista) ----------
const coll = () => db.collection("tapcontrol");
const APP_VERSION = "1.8.0";
const APP_VERSION_FECHA = "12/07/2026";
function persist(docName, items) {
  return coll().doc(docName).set({ items });
}

// Devuelve el próximo número de ticket, consecutivo, sin importar qué cajero está vendiendo.
// Usa una transacción de Firestore para que dos ventas al mismo tiempo nunca repitan número.
function nextTicketNumber() {
  const ref = coll().doc("contador_ventas");
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const actual = snap.exists ? snap.data().ultimo || 0 : 0;
    const siguiente = actual + 1;
    tx.set(ref, { ultimo: siguiente });
    return siguiente;
  });
}

function App() {
  const [ready, setReady] = useState(false);
  const [productos, setProductos] = useState([]);
  const [cajas, setCajas] = useState([]);
  const [ventas, setVentas] = useState([]);
  const [movimientos, setMovimientos] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [config, setConfig] = useState(null);
  const [view, setView] = useState("home");
  const [operador, setOperador] = useState("");
  const [activeCajaId, setActiveCajaId] = useState(null);
  const [toast, setToast] = useState(null);
  const [connError, setConnError] = useState(false);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  useEffect(() => {
    let unsubs = [];
    const flags = { productos: false, cajas: false, ventas: false, movimientos: false, usuarios: false, config: false };
    const checkReady = () => {
      if (Object.values(flags).every(Boolean)) setReady(true);
    };

    auth.signInAnonymously().catch((err) => {
      console.error(err);
      setConnError(true);
    });

    const unsubAuth = auth.onAuthStateChanged((user) => {
      if (!user) return;

      unsubs.push(
        coll().doc("productos").onSnapshot((snap) => {
          if (snap.exists) setProductos(snap.data().items || []);
          else coll().doc("productos").set({ items: SEED_PRODUCTS });
          flags.productos = true; checkReady();
        }, (e) => { console.error(e); setConnError(true); })
      );
      unsubs.push(
        coll().doc("cajas").onSnapshot((snap) => {
          setCajas(snap.exists ? snap.data().items || [] : []);
          flags.cajas = true; checkReady();
        }, (e) => { console.error(e); setConnError(true); })
      );
      unsubs.push(
        coll().doc("ventas").onSnapshot((snap) => {
          setVentas(snap.exists ? snap.data().items || [] : []);
          flags.ventas = true; checkReady();
        }, (e) => { console.error(e); setConnError(true); })
      );
      unsubs.push(
        coll().doc("movimientos").onSnapshot((snap) => {
          setMovimientos(snap.exists ? snap.data().items || [] : []);
          flags.movimientos = true; checkReady();
        }, (e) => { console.error(e); setConnError(true); })
      );
      unsubs.push(
        coll().doc("usuarios").onSnapshot((snap) => {
          setUsuarios(snap.exists ? snap.data().items || [] : []);
          flags.usuarios = true; checkReady();
        }, (e) => { console.error(e); setConnError(true); })
      );
      unsubs.push(
        coll().doc("config").onSnapshot((snap) => {
          setConfig(snap.exists ? snap.data() : {});
          flags.config = true; checkReady();
        }, (e) => { console.error(e); setConnError(true); })
      );
    });

    return () => { unsubAuth(); unsubs.forEach((u) => u()); };
  }, []);

  const persistProductos = async (next) => { setProductos(next); await persist("productos", next); };
  const persistCajas = async (next) => { setCajas(next); await persist("cajas", next); };
  const persistVentas = async (next) => { setVentas(next); await persist("ventas", next); };
  const persistMovimientos = async (next) => { setMovimientos(next); await persist("movimientos", next); };
  const persistUsuarios = async (next) => { setUsuarios(next); await persist("usuarios", next); };
  const persistConfig = async (next) => { setConfig(next); await coll().doc("config").set(next); };

  const activeCaja = cajas.find((c) => c.id === activeCajaId);

  if (connError) {
    return (
      <div style={styles.loadingScreen}>
        <div style={{ fontSize: 40 }}>⚠️</div>
        <p style={{ marginTop: 12, color: "#B91C1C", fontWeight: 700, textAlign: "center", padding: "0 24px" }}>
          No se pudo conectar a la base de datos.<br />
          Revisa que completaste firebase-config.js y que habilitaste Firestore + Autenticación anónima.
        </p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div style={styles.loadingScreen}>
        <div style={{ fontSize: 40 }}>🍺</div>
        <p style={{ marginTop: 12, color: "#7C5E3C", fontWeight: 600 }}>Cargando sistema…</p>
      </div>
    );
  }

  return (
    <div style={styles.app}>
      <style>{`
        * { box-sizing: border-box; font-family: 'Inter', system-ui, sans-serif; }
        button { cursor: pointer; font-family: inherit; }
        input, select, textarea { font-family: inherit; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-thumb { background: #D8C7A8; border-radius: 3px; }
        @page {
          size: 80mm auto;
          margin: 0;
        }
        @media print {
          body * { visibility: hidden; }
          .print-area, .print-area * { visibility: visible; }
          .print-area { position: absolute; top: 0; left: 0; width: 80mm; padding: 4mm; }
        }
      `}</style>

      {toast && <div style={styles.toast}>{toast}</div>}

      {view === "home" && (
        <Home config={config} onOperador={() => setView("operador-login")} onBackOffice={() => setView("admin-gate")} />
      )}

      {view === "admin-gate" && (
        <AdminGate
          config={config}
          onBack={() => setView("home")}
          onConfigured={async (password) => { await persistConfig({ ...config, adminPassword: password }); }}
          onSuccess={() => setView("backoffice")}
        />
      )}

      {view === "operador-login" && (
        <OperadorLogin
          usuarios={usuarios}
          onBack={() => setView("home")}
          onEnter={(nombre) => {
            setOperador(nombre);
            const abierta = cajas.find((c) => c.operador === nombre && c.estado === "abierta");
            if (abierta) { setActiveCajaId(abierta.id); setView("pos"); }
            else setView("apertura");
          }}
        />
      )}

      {view === "apertura" && (
        <Apertura
          operador={operador}
          onBack={() => setView("operador-login")}
          onAbrir={async (aperturaGs, aperturaBRL) => {
            const caja = {
              id: uid(), operador, fechaApertura: nowISO(), aperturaGs, aperturaBRL,
              fechaCierre: null, cierreGs: null, cierreBRL: null, estado: "abierta",
            };
            await persistCajas([...cajas, caja]);
            setActiveCajaId(caja.id);
            setView("pos");
            showToast("Caja abierta correctamente");
          }}
        />
      )}

      {view === "pos" && activeCaja && (
        <POS
          caja={activeCaja}
          productos={productos.filter((p) => p.activo !== false)}
          onSalir={() => { setView("home"); setOperador(""); setActiveCajaId(null); }}
          onVenta={async (venta) => { await persistVentas([...ventas, venta]); showToast("Venta registrada"); }}
          onMovimiento={async (mov) => { await persistMovimientos([...movimientos, mov]); showToast("Movimiento registrado"); }}
          onIrACierre={() => setView("cierre")}
          showToast={showToast}
          config={config}
        />
      )}

      {view === "cierre" && activeCaja && (
        <Cierre
          caja={activeCaja}
          ventas={ventas.filter((v) => v.cajaId === activeCaja.id)}
          movimientos={movimientos.filter((m) => m.cajaId === activeCaja.id)}
          onBack={() => setView("pos")}
          onCerrar={async (cierreGs, cierreBRL, esperado) => {
            const next = cajas.map((c) =>
              c.id === activeCaja.id
                ? { ...c, estado: "cerrada", fechaCierre: nowISO(), cierreGs, cierreBRL,
                    esperadoGs: esperado.gs, esperadoBRL: esperado.brl,
                    diferenciaGs: cierreGs - esperado.gs, diferenciaBRL: cierreBRL - esperado.brl }
                : c
            );
            await persistCajas(next);
            showToast("Caja cerrada");
          }}
          onFinalizar={() => { setView("home"); setOperador(""); setActiveCajaId(null); }}
          showToast={showToast}
          config={config}
        />
      )}

      {view === "backoffice" && (
        <BackOffice
          onBack={() => setView("home")}
          productos={productos}
          setProductos={persistProductos}
          cajas={cajas}
          setCajas={persistCajas}
          ventas={ventas}
          setVentas={persistVentas}
          movimientos={movimientos}
          usuarios={usuarios}
          setUsuarios={persistUsuarios}
          config={config}
          setConfig={persistConfig}
          showToast={showToast}
        />
      )}
    </div>
  );
}

// ================= HOME =================
function Home({ config, onOperador, onBackOffice }) {
  return (
    <div style={styles.centerScreen}>
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        {config?.logo
          ? <img src={config.logo} alt="Logo" style={{ maxWidth: 140, maxHeight: 140, objectFit: "contain" }} />
          : <div style={{ fontSize: 52 }}>🍺</div>}
        <h1 style={styles.h1}>Tap Control</h1>
        <p style={styles.subtitle}>Sistema de ventas para chopería</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%", maxWidth: 340 }}>
        <button style={styles.bigButton} onClick={onOperador}>🍺 Operador · Ventas</button>
        <button style={{ ...styles.bigButton, background: "#292118" }} onClick={onBackOffice}>⚙️ Back Office</button>
      </div>
      <div style={{ marginTop: 32, fontSize: 11, color: "#D8C7A8" }}>Tap Control v{APP_VERSION} · {APP_VERSION_FECHA}</div>
    </div>
  );
}

// ================= ADMIN GATE =================
function AdminGate({ config, onBack, onConfigured, onSuccess }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Todavía no existe una contraseña de administrador: hay que crearla primero.
  if (config && !config.adminPassword) {
    const crear = async () => {
      if (password.length < 4) { setError("La contraseña debe tener al menos 4 caracteres."); return; }
      if (password !== confirmPassword) { setError("Las contraseñas no coinciden."); return; }
      setSaving(true);
      await onConfigured(password);
      setSaving(false);
      onSuccess();
    };
    return (
      <div style={styles.centerScreen}>
        <BackBar onBack={onBack} title="Crear contraseña de administrador" />
        <div style={styles.card}>
          <p style={{ color: "#7C5E3C", marginBottom: 16, fontSize: 13 }}>
            Es la primera vez que entrás al Back Office. Elegí una contraseña para vos como administrador — te la va a pedir cada vez que quieras entrar.
          </p>
          <label style={styles.label}>Nueva contraseña</label>
          <input style={styles.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          <label style={{ ...styles.label, marginTop: 12 }}>Repetir contraseña</label>
          <input style={styles.input} type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          {error && <p style={{ color: "#B91C1C", fontSize: 12, marginTop: 8 }}>{error}</p>}
          <button style={{ ...styles.primaryButton, marginTop: 16 }} disabled={saving} onClick={crear}>
            {saving ? "Guardando…" : "Crear contraseña y entrar"}
          </button>
        </div>
      </div>
    );
  }

  // Ya existe una contraseña: pedirla para entrar.
  const entrar = () => {
    if (password === config.adminPassword) onSuccess();
    else setError("Contraseña incorrecta.");
  };
  return (
    <div style={styles.centerScreen}>
      <BackBar onBack={onBack} title="Back Office" />
      <div style={styles.card}>
        <label style={styles.label}>Contraseña de administrador</label>
        <input style={styles.input} type="password" value={password} autoFocus
          onChange={(e) => { setPassword(e.target.value); setError(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") entrar(); }} />
        {error && <p style={{ color: "#B91C1C", fontSize: 12, marginTop: 8 }}>{error}</p>}
        <button style={{ ...styles.primaryButton, marginTop: 16 }} disabled={!password} onClick={entrar}>
          Entrar
        </button>
      </div>
    </div>
  );
}

// ================= OPERADOR LOGIN =================
function OperadorLogin({ onBack, onEnter, usuarios }) {
  const [selected, setSelected] = useState(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const activos = (usuarios || []).filter((u) => u.activo !== false);

  if (!selected) {
    return (
      <div style={styles.centerScreen}>
        <BackBar onBack={onBack} title="Identificación" />
        <div style={{ width: "100%", maxWidth: 380 }}>
          {activos.length === 0 && (
            <div style={styles.card}>
              <p style={{ color: "#7C5E3C", fontSize: 13 }}>
                Todavía no hay cajeros creados. Pedile al administrador que cree tu usuario en <b>Back Office → Usuarios</b>.
              </p>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            {activos.map((u) => (
              <button key={u.id} style={styles.productRow} onClick={() => { setSelected(u); setPin(""); setError(""); }}>
                <div style={{ flex: 1, textAlign: "left", fontWeight: 700 }}>👤 {u.nombre}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const validar = () => {
    if (pin === selected.pin) onEnter(selected.nombre);
    else setError("PIN incorrecto.");
  };

  return (
    <div style={styles.centerScreen}>
      <BackBar onBack={() => setSelected(null)} title={selected.nombre} />
      <div style={styles.card}>
        <label style={styles.label}>Ingresá tu PIN</label>
        <input style={{ ...styles.input, letterSpacing: 6, textAlign: "center", fontSize: 20 }} type="password" inputMode="numeric" maxLength={4}
          value={pin} autoFocus
          onChange={(e) => { setPin(e.target.value.replace(/\D/g, "").slice(0, 4)); setError(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") validar(); }} />
        {error && <p style={{ color: "#B91C1C", fontSize: 12, marginTop: 8 }}>{error}</p>}
        <button style={{ ...styles.primaryButton, marginTop: 16 }} disabled={pin.length !== 4} onClick={validar}>
          Ingresar
        </button>
      </div>
    </div>
  );
}

// ================= APERTURA DE CAJA =================
function Apertura({ operador, onBack, onAbrir }) {
  const [gs, setGs] = useState("");
  const [brl, setBrl] = useState("");
  return (
    <div style={styles.centerScreen}>
      <BackBar onBack={onBack} title={`Apertura de caja · ${operador}`} />
      <div style={styles.card}>
        <p style={{ color: "#7C5E3C", marginBottom: 16 }}>Declara el efectivo con el que inicias el turno en cada moneda.</p>
        <label style={styles.label}>Monto inicial en Guaraníes (₲)</label>
        <input style={styles.input} type="number" value={gs} onChange={(e) => setGs(e.target.value)} placeholder="0" />
        <label style={{ ...styles.label, marginTop: 12 }}>Monto inicial en Reales (R$)</label>
        <input style={styles.input} type="number" value={brl} onChange={(e) => setBrl(e.target.value)} placeholder="0" />
        <button style={{ ...styles.primaryButton, marginTop: 20 }} onClick={() => onAbrir(Number(gs) || 0, Number(brl) || 0)}>
          Abrir caja
        </button>
      </div>
    </div>
  );
}

// ================= POS =================
function POS({ caja, productos, onSalir, onVenta, onMovimiento, onIrACierre, showToast, config }) {
  const [catFiltro, setCatFiltro] = useState("todos");
  const [cart, setCart] = useState([]);
  const [showCheckout, setShowCheckout] = useState(false);
  const [showMov, setShowMov] = useState(false);
  const [ticket, setTicket] = useState(null);

  const addToCart = (p) => {
    setCart((prev) => {
      const found = prev.find((i) => i.productId === p.id);
      if (found) return prev.map((i) => (i.productId === p.id ? { ...i, qty: i.qty + 1 } : i));
      return [...prev, { productId: p.id, qty: 1 }];
    });
  };
  const changeQty = (productId, delta) => {
    setCart((prev) => prev.map((i) => (i.productId === productId ? { ...i, qty: i.qty + delta } : i)).filter((i) => i.qty > 0));
  };
  const removeItem = (productId) => setCart((prev) => prev.filter((i) => i.productId !== productId));

  const cartDetailed = cart.map((i) => ({ ...i, p: productos.find((pp) => pp.id === i.productId) })).filter((i) => i.p);
  const filtered = catFiltro === "todos" ? productos : productos.filter((p) => p.categoria === catFiltro);

  return (
    <div style={styles.posLayout}>
      <div style={styles.posHeader}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{caja.operador}</div>
          <div style={{ fontSize: 12, color: "#B08968" }}>Turno desde {fmtDateTime(caja.fechaApertura)}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={styles.iconButton} title="Movimiento de caja" onClick={() => setShowMov(true)}>🔁</button>
          <button style={styles.iconButton} title="Cerrar caja" onClick={onIrACierre}>📋</button>
          <button style={styles.iconButton} title="Salir" onClick={onSalir}>🚪</button>
        </div>
      </div>

      <div style={styles.catRow}>
        <CatChip active={catFiltro === "todos"} label="Todos" onClick={() => setCatFiltro("todos")} />
        {CATS.map((c) => (
          <CatChip key={c.id} active={catFiltro === c.id} label={`${c.emoji} ${c.label}`} onClick={() => setCatFiltro(c.id)} />
        ))}
      </div>

      <div style={styles.productGrid}>
        {filtered.map((p) => (
          <button key={p.id} style={styles.productCard} onClick={() => addToCart(p)}>
            {p.imagen
              ? <img src={p.imagen} alt={p.nombre} style={styles.productImg} />
              : <div style={{ ...styles.productImg, ...styles.thumbPlaceholder, fontSize: 28 }}>🍺</div>}
            <div style={{ fontWeight: 700, fontSize: 14 }}>{p.nombre}</div>
            <div style={{ fontSize: 11, color: "#B08968", marginTop: 2 }}>{p.marca}</div>
            <div style={{ marginTop: 8, fontSize: 13, color: "#B45309", fontWeight: 700 }}>{fmtGs(p.precioGs)}</div>
            <div style={{ fontSize: 12, color: "#166534", fontWeight: 600 }}>{fmtBRL(p.precioBRL)}</div>
          </button>
        ))}
        {filtered.length === 0 && <p style={{ color: "#B08968" }}>No hay productos en esta categoría.</p>}
      </div>

      <div style={styles.cartPanel}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Carrito ({cartDetailed.length})</div>
        {cartDetailed.length === 0 && <p style={{ color: "#B08968", fontSize: 13 }}>Toca un producto para agregarlo.</p>}
        <div style={{ maxHeight: 160, overflowY: "auto" }}>
          {cartDetailed.map((i) => (
            <div key={i.productId} style={styles.cartRow}>
              <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 600 }}>{i.p.nombre}</div></div>
              <button style={styles.qtyBtn} onClick={() => changeQty(i.productId, -1)}>−</button>
              <span style={{ width: 22, textAlign: "center" }}>{i.qty}</span>
              <button style={styles.qtyBtn} onClick={() => changeQty(i.productId, 1)}>+</button>
              <button style={{ ...styles.qtyBtn, marginLeft: 6, color: "#B91C1C" }} onClick={() => removeItem(i.productId)}>🗑</button>
            </div>
          ))}
        </div>
        <button style={{ ...styles.primaryButton, marginTop: 12 }} disabled={cartDetailed.length === 0} onClick={() => setShowCheckout(true)}>
          Cobrar
        </button>
      </div>

      {showCheckout && (
        <CheckoutModal
          cartDetailed={cartDetailed}
          onClose={() => setShowCheckout(false)}
          onConfirm={async (moneda, metodoPago) => {
            const items = cartDetailed.map((i) => {
              const precioUnit = moneda === "GS" ? i.p.precioGs : i.p.precioBRL;
              return { productId: i.p.id, nombre: i.p.nombre, qty: i.qty, precioUnit, subtotal: precioUnit * i.qty };
            });
            const total = items.reduce((s, i) => s + i.subtotal, 0);
            const numero = await nextTicketNumber();
            const venta = { id: uid(), numero, cajaId: caja.id, operador: caja.operador, fecha: nowISO(), items, moneda, metodoPago, total };
            onVenta(venta);
            setShowCheckout(false);
            setTicket(venta);
            setCart([]);
            const ok = await imprimirDirecto({ lines: construirLineasTicketVenta(venta, config), logo: config?.logo });
            if (!ok) showToast("⚠️ No se pudo imprimir. Revisá que el servidor de impresión esté prendido.");
          }}
        />
      )}

      {showMov && (
        <MovimientoModal
          onClose={() => setShowMov(false)}
          onConfirm={(mov) => { onMovimiento({ id: uid(), cajaId: caja.id, fecha: nowISO(), ...mov }); setShowMov(false); }}
        />
      )}

      {ticket && <TicketVenta venta={ticket} caja={caja} onClose={() => setTicket(null)} showToast={showToast} config={config} />}
    </div>
  );
}

function CatChip({ active, label, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "8px 14px", borderRadius: 20, border: active ? "1px solid #B45309" : "1px solid #E7DCC9",
      background: active ? "#B45309" : "#fff", color: active ? "#fff" : "#292118", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap",
    }}>{label}</button>
  );
}

function CheckoutModal({ cartDetailed, onClose, onConfirm }) {
  const [moneda, setMoneda] = useState("GS");
  const [metodoPago, setMetodoPago] = useState("efectivo");
  const total = cartDetailed.reduce((s, i) => s + (moneda === "GS" ? i.p.precioGs : i.p.precioBRL) * i.qty, 0);
  return (
    <ModalWrap onClose={onClose} title="Cobrar venta">
      <label style={styles.label}>Moneda de cobro</label>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <ToggleBtn active={moneda === "GS"} label="Guaraníes ₲" onClick={() => setMoneda("GS")} />
        <ToggleBtn active={moneda === "BRL"} label="Reales R$" onClick={() => setMoneda("BRL")} />
      </div>
      <label style={styles.label}>Método de pago</label>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <ToggleBtn active={metodoPago === "efectivo"} label="Efectivo" onClick={() => setMetodoPago("efectivo")} />
        <ToggleBtn active={metodoPago === "tarjeta"} label="Tarjeta" onClick={() => setMetodoPago("tarjeta")} />
      </div>
      <div style={styles.totalBox}><span>Total</span><strong>{fmtMoney(total, moneda)}</strong></div>
      <button style={{ ...styles.primaryButton, marginTop: 16 }} onClick={() => onConfirm(moneda, metodoPago)}>✓ Confirmar venta</button>
    </ModalWrap>
  );
}

function MovimientoModal({ onClose, onConfirm }) {
  const [tipo, setTipo] = useState("retiro");
  const [moneda, setMoneda] = useState("GS");
  const [monto, setMonto] = useState("");
  const [usuario, setUsuario] = useState("");
  const [observacion, setObservacion] = useState("");
  const valido = Number(monto) > 0 && usuario.trim() && observacion.trim();
  return (
    <ModalWrap onClose={onClose} title="Movimiento de caja">
      <label style={styles.label}>Tipo</label>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <ToggleBtn active={tipo === "retiro"} label="Retiro" onClick={() => setTipo("retiro")} />
        <ToggleBtn active={tipo === "ingreso"} label="Ingreso" onClick={() => setTipo("ingreso")} />
      </div>
      <label style={styles.label}>Moneda</label>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <ToggleBtn active={moneda === "GS"} label="Guaraníes ₲" onClick={() => setMoneda("GS")} />
        <ToggleBtn active={moneda === "BRL"} label="Reales R$" onClick={() => setMoneda("BRL")} />
      </div>
      <label style={styles.label}>Monto</label>
      <input style={styles.input} type="number" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0" />
      <label style={{ ...styles.label, marginTop: 12 }}>Realizado por (tesorero/encargado)</label>
      <input style={styles.input} value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="Nombre" />
      <label style={{ ...styles.label, marginTop: 12 }}>Observación</label>
      <textarea style={{ ...styles.input, minHeight: 60 }} value={observacion} onChange={(e) => setObservacion(e.target.value)} placeholder="Motivo del retiro / ingreso" />
      <button style={{ ...styles.primaryButton, marginTop: 16 }} disabled={!valido}
        onClick={() => onConfirm({ tipo, moneda, monto: Number(monto), usuario: usuario.trim(), observacion: observacion.trim() })}>
        Guardar movimiento
      </button>
    </ModalWrap>
  );
}

function TicketVenta({ venta, caja, onClose, showToast, config }) {
  const reimprimir = async () => {
    const ok = await imprimirDirecto({ lines: construirLineasTicketVenta(venta, config), logo: config?.logo });
    showToast(ok ? "Ticket reenviado a la impresora" : "⚠️ No se pudo imprimir. Revisá que el servidor de impresión esté prendido.");
  };

  return (
    <ModalWrap onClose={onClose} title="✓ Venta realizada" big>
      <div className="print-area" style={styles.ticket}>
        <div style={{ textAlign: "center", fontWeight: 700 }}>TAP CONTROL</div>
        <div style={{ textAlign: "center", fontSize: 11 }}>Comprobante de venta</div>
        <div style={{ textAlign: "center", fontSize: 12, fontWeight: 700, marginTop: 2 }}>Ticket N° {String(venta.numero ?? "-").padStart(6, "0")}</div>
        <hr style={styles.ticketHr} />
        <div style={styles.ticketRow}><span>Fecha</span><span>{fmtDateTime(venta.fecha)}</span></div>
        <div style={styles.ticketRow}><span>Operador</span><span>{venta.operador}</span></div>
        <div style={styles.ticketRow}><span>Pago</span><span>{venta.metodoPago}</span></div>
        <hr style={styles.ticketHr} />
        {venta.items.map((i, idx) => (
          <div key={idx} style={{ marginBottom: 4 }}>
            <div>{i.nombre}</div>
            <div style={styles.ticketRow}><span>{i.qty} x {fmtMoney(i.precioUnit, venta.moneda)}</span><span>{fmtMoney(i.subtotal, venta.moneda)}</span></div>
          </div>
        ))}
        <hr style={styles.ticketHr} />
        <div style={{ ...styles.ticketRow, fontWeight: 700, fontSize: 14 }}><span>TOTAL</span><span>{fmtMoney(venta.total, venta.moneda)}</span></div>
        <div style={{ textAlign: "center", fontSize: 11, marginTop: 8 }}>¡Gracias por su compra!</div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button style={styles.secondaryButton} onClick={reimprimir}>🖨 Reimprimir</button>
        <button style={styles.primaryButton} onClick={onClose}>Nueva venta</button>
      </div>
    </ModalWrap>
  );
}

// ================= CIERRE DE CAJA =================
function Cierre({ caja, ventas, movimientos, onBack, onCerrar, onFinalizar, showToast, config }) {
  const [cerrada, setCerrada] = useState(caja.estado === "cerrada");
  const [contadoGs, setContadoGs] = useState("");
  const [contadoBrl, setContadoBrl] = useState("");

  // Estos cálculos se usan solo para guardar el dato — el cajero NO los ve (cierre ciego).
  // El detalle completo queda disponible para el administrador en Back Office > Turnos.
  const sum = (arr, f) => arr.filter((v) => !v.anulada).filter(f).reduce((s, v) => s + v.total, 0);
  const ventasEfectivoGs = sum(ventas, (v) => v.moneda === "GS" && v.metodoPago === "efectivo");
  const ventasEfectivoBrl = sum(ventas, (v) => v.moneda === "BRL" && v.metodoPago === "efectivo");

  const retirosGs = movimientos.filter((m) => m.tipo === "retiro" && m.moneda === "GS").reduce((s, m) => s + m.monto, 0);
  const ingresosGs = movimientos.filter((m) => m.tipo === "ingreso" && m.moneda === "GS").reduce((s, m) => s + m.monto, 0);
  const retirosBrl = movimientos.filter((m) => m.tipo === "retiro" && m.moneda === "BRL").reduce((s, m) => s + m.monto, 0);
  const ingresosBrl = movimientos.filter((m) => m.tipo === "ingreso" && m.moneda === "BRL").reduce((s, m) => s + m.monto, 0);

  const esperadoGs = caja.aperturaGs + ventasEfectivoGs + ingresosGs - retirosGs;
  const esperadoBrl = caja.aperturaBRL + ventasEfectivoBrl + ingresosBrl - retirosBrl;

  const finalContadoGs = cerrada ? caja.cierreGs : Number(contadoGs) || 0;
  const finalContadoBrl = cerrada ? caja.cierreBRL : Number(contadoBrl) || 0;

  return (
    <div style={styles.centerScreen}>
      <BackBar onBack={onBack} title="Cierre de caja" />
      <div style={{ ...styles.card, maxWidth: 420 }}>
        <SectionTitle>Cierre de turno · {caja.operador}</SectionTitle>
        <MiniRow label="Apertura ₲" value={fmtGs(caja.aperturaGs)} />
        <MiniRow label="Apertura R$" value={fmtBRL(caja.aperturaBRL)} />
        <MiniRow label="Ingresos ₲ / retiros ₲" value={`${fmtGs(ingresosGs)} / ${fmtGs(retirosGs)}`} />
        <MiniRow label="Ingresos R$ / retiros R$" value={`${fmtBRL(ingresosBrl)} / ${fmtBRL(retirosBrl)}`} />

        {!cerrada ? (
          <>
            <hr style={{ margin: "12px 0", border: "none", borderTop: "1px solid #E7DCC9" }} />
            <p style={{ color: "#7C5E3C", fontSize: 13, marginBottom: 4 }}>Contá el efectivo que tenés en caja y cargalo acá.</p>
            <label style={{ ...styles.label, marginTop: 12 }}>Efectivo contado ₲</label>
            <input style={styles.input} type="number" value={contadoGs} onChange={(e) => setContadoGs(e.target.value)} />
            <label style={{ ...styles.label, marginTop: 12 }}>Efectivo contado R$</label>
            <input style={styles.input} type="number" value={contadoBrl} onChange={(e) => setContadoBrl(e.target.value)} />
            <button style={{ ...styles.primaryButton, marginTop: 16 }}
              onClick={() => { onCerrar(Number(contadoGs) || 0, Number(contadoBrl) || 0, { gs: esperadoGs, brl: esperadoBrl }); setCerrada(true); }}>
              Cerrar caja
            </button>
          </>
        ) : (
          <>
            <hr style={{ margin: "12px 0", border: "none", borderTop: "1px solid #E7DCC9" }} />
            <MiniRow label="Contado ₲" value={fmtGs(finalContadoGs)} />
            <MiniRow label="Contado R$" value={fmtBRL(finalContadoBrl)} />
            <div className="print-area" style={{ ...styles.ticket, marginTop: 16 }}>
              <div style={{ textAlign: "center", fontWeight: 700 }}>TAP CONTROL</div>
              <div style={{ textAlign: "center", fontSize: 11 }}>Comprobante de cierre de caja</div>
              <hr style={styles.ticketHr} />
              <div style={styles.ticketRow}><span>Operador</span><span>{caja.operador}</span></div>
              <div style={styles.ticketRow}><span>Apertura</span><span>{fmtDateTime(caja.fechaApertura)}</span></div>
              <div style={styles.ticketRow}><span>Cierre</span><span>{fmtDateTime(caja.fechaCierre)}</span></div>
              <hr style={styles.ticketHr} />
              <div style={styles.ticketRow}><span>Contado ₲</span><span>{fmtGs(finalContadoGs)}</span></div>
              <div style={styles.ticketRow}><span>Contado R$</span><span>{fmtBRL(finalContadoBrl)}</span></div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button style={styles.secondaryButton}
                onClick={async () => {
                  const nombreNegocio = config?.nombreNegocio?.trim() || "TAP CONTROL";
                  const ok = await imprimirDirecto({
                    lines: [
                      { text: nombreNegocio, bold: true, big: true, align: "center" },
                      { text: "Cierre de caja", align: "center" },
                      { text: "................................" },
                      { text: `Empleado: ${caja.operador}` },
                      { text: `Apertura: ${fmtDateTime(caja.fechaApertura)}` },
                      { text: `Cierre: ${fmtDateTime(caja.fechaCierre)}` },
                      { text: "................................" },
                      { text: filaTicket("Contado Gs", fmtGs(finalContadoGs)) },
                      { text: filaTicket("Contado R$", fmtBRL(finalContadoBrl)) },
                      { text: "" },
                    ],
                    logo: config?.logo,
                  });
                  if (!ok) showToast("⚠️ No se pudo imprimir. Revisá que el servidor de impresión esté prendido.");
                }}>
                🖨 Imprimir
              </button>
              <button style={styles.primaryButton} onClick={onFinalizar}>Finalizar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ================= BACK OFFICE =================
function BackOffice({ onBack, productos, setProductos, cajas, setCajas, ventas, setVentas, movimientos, usuarios, setUsuarios, config, setConfig, showToast }) {
  const [tab, setTab] = useState("reportes");
  return (
    <div style={styles.boLayout}>
      <BackBar onBack={onBack} title="Back Office" />
      <div style={styles.tabRow}>
        <TabBtn active={tab === "reportes"} label="Reportes" emoji="📊" onClick={() => setTab("reportes")} />
        <TabBtn active={tab === "productos"} label="Productos" emoji="🍺" onClick={() => setTab("productos")} />
        <TabBtn active={tab === "turnos"} label="Turnos" emoji="📋" onClick={() => setTab("turnos")} />
        <TabBtn active={tab === "ventas"} label="Ventas" emoji="🧾" onClick={() => setTab("ventas")} />
        <TabBtn active={tab === "movimientos"} label="Movimientos" emoji="🔁" onClick={() => setTab("movimientos")} />
        <TabBtn active={tab === "usuarios"} label="Usuarios" emoji="👤" onClick={() => setTab("usuarios")} />
        <TabBtn active={tab === "config"} label="Configuración" emoji="🎨" onClick={() => setTab("config")} />
      </div>
      <div style={{ padding: "0 16px 32px" }}>
        {tab === "reportes" && <Reportes ventas={ventas} cajas={cajas} productos={productos} />}
        {tab === "productos" && <Productos productos={productos} setProductos={setProductos} showToast={showToast} />}
        {tab === "turnos" && <Turnos cajas={cajas} setCajas={setCajas} ventas={ventas} movimientos={movimientos} showToast={showToast} />}
        {tab === "ventas" && <VentasAdmin ventas={ventas} setVentas={setVentas} showToast={showToast} />}
        {tab === "movimientos" && <MovimientosHistorial movimientos={movimientos} />}
        {tab === "usuarios" && <Usuarios usuarios={usuarios} setUsuarios={setUsuarios} config={config} setConfig={setConfig} showToast={showToast} />}
        {tab === "config" && <Configuracion config={config} setConfig={setConfig} showToast={showToast} />}
      </div>
    </div>
  );
}

function Reportes({ ventas, cajas, productos }) {
  const [modo, setModo] = useState("hoy");
  const [desde, setDesde] = useState(todayStr());
  const [hasta, setHasta] = useState(todayStr());

  let rangoDesde, rangoHasta;
  const hoy = new Date();
  if (modo === "hoy") { rangoDesde = todayStr(); rangoHasta = todayStr(); }
  else if (modo === "mes") { rangoDesde = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-01`; rangoHasta = todayStr(); }
  else { rangoDesde = desde; rangoHasta = hasta; }

  const ventasFiltradas = ventas.filter((v) => !v.anulada).filter((v) => { const d = dayOf(v.fecha); return d >= rangoDesde && d <= rangoHasta; });

  const totalGs = ventasFiltradas.filter((v) => v.moneda === "GS").reduce((s, v) => s + v.total, 0);
  const totalBrl = ventasFiltradas.filter((v) => v.moneda === "BRL").reduce((s, v) => s + v.total, 0);
  const efectivoGs = ventasFiltradas.filter((v) => v.moneda === "GS" && v.metodoPago === "efectivo").reduce((s, v) => s + v.total, 0);
  const tarjetaGs = ventasFiltradas.filter((v) => v.moneda === "GS" && v.metodoPago === "tarjeta").reduce((s, v) => s + v.total, 0);
  const efectivoBrl = ventasFiltradas.filter((v) => v.moneda === "BRL" && v.metodoPago === "efectivo").reduce((s, v) => s + v.total, 0);
  const tarjetaBrl = ventasFiltradas.filter((v) => v.moneda === "BRL" && v.metodoPago === "tarjeta").reduce((s, v) => s + v.total, 0);

  const porProducto = {};
  ventasFiltradas.forEach((v) => {
    v.items.forEach((it) => {
      if (!porProducto[it.nombre]) porProducto[it.nombre] = { qty: 0, gs: 0, brl: 0 };
      porProducto[it.nombre].qty += it.qty;
      if (v.moneda === "GS") porProducto[it.nombre].gs += it.subtotal; else porProducto[it.nombre].brl += it.subtotal;
    });
  });

  const cajasEnRango = cajas.filter((c) => { const d = dayOf(c.fechaApertura); return d >= rangoDesde && d <= rangoHasta; });

  return (
    <div>
      <SectionTitle>Período</SectionTitle>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <ToggleBtn active={modo === "hoy"} label="Hoy" onClick={() => setModo("hoy")} />
        <ToggleBtn active={modo === "mes"} label="Este mes" onClick={() => setModo("mes")} />
        <ToggleBtn active={modo === "rango"} label="Rango" onClick={() => setModo("rango")} />
      </div>
      {modo === "rango" && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input style={styles.input} type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          <input style={styles.input} type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
      )}

      <SectionTitle>Venta total</SectionTitle>
      <div style={styles.reportGrid}>
        <StatBox label="Total ₲" value={fmtGs(totalGs)} />
        <StatBox label="Total R$" value={fmtBRL(totalBrl)} />
        <StatBox label="Efectivo ₲" value={fmtGs(efectivoGs)} />
        <StatBox label="Tarjeta ₲" value={fmtGs(tarjetaGs)} />
        <StatBox label="Efectivo R$" value={fmtBRL(efectivoBrl)} />
        <StatBox label="Tarjeta R$" value={fmtBRL(tarjetaBrl)} />
      </div>

      <SectionTitle>Venta por producto</SectionTitle>
      <TableBox headers={["Producto", "Cant.", "Total ₲", "Total R$"]}
        rows={Object.entries(porProducto).map(([nombre, d]) => [nombre, d.qty, fmtGs(d.gs), fmtBRL(d.brl)])}
        empty="Sin ventas en el período" />

      <SectionTitle>Venta por turno</SectionTitle>
      <TableBox headers={["Operador", "Apertura", "Cierre", "Total ₲", "Total R$", "Estado"]}
        rows={cajasEnRango.map((c) => {
          const vs = ventas.filter((v) => v.cajaId === c.id && !v.anulada);
          const tg = vs.filter((v) => v.moneda === "GS").reduce((s, v) => s + v.total, 0);
          const tb = vs.filter((v) => v.moneda === "BRL").reduce((s, v) => s + v.total, 0);
          return [c.operador, fmtDateTime(c.fechaApertura), fmtDateTime(c.fechaCierre), fmtGs(tg), fmtBRL(tb), c.estado];
        })}
        empty="Sin turnos en el período" />
    </div>
  );
}

function Productos({ productos, setProductos, showToast }) {
  const [editing, setEditing] = useState(null);
  const save = (data) => {
    if (data.id) setProductos(productos.map((p) => (p.id === data.id ? data : p)));
    else setProductos([...productos, { ...data, id: uid() }]);
    setEditing(null);
    showToast("Producto guardado");
  };
  const remove = (id) => { setProductos(productos.filter((p) => p.id !== id)); showToast("Producto eliminado"); };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <SectionTitle>Productos ({productos.length})</SectionTitle>
        <button style={styles.secondaryButton} onClick={() => setEditing("new")}>➕ Nuevo</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {productos.map((p) => (
          <div key={p.id} style={styles.productRow}>
            {p.imagen
              ? <img src={p.imagen} alt={p.nombre} style={styles.thumb} />
              : <div style={{ ...styles.thumb, ...styles.thumbPlaceholder }}>🍺</div>}
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{p.nombre} {p.activo === false && <span style={{ color: "#B91C1C", fontSize: 11 }}>(inactivo)</span>}</div>
              <div style={{ fontSize: 12, color: "#B08968" }}>{p.marca} · {CATS.find((c) => c.id === p.categoria)?.label} · {p.tamano}</div>
              <div style={{ fontSize: 12, marginTop: 2 }}>{fmtGs(p.precioGs)} · {fmtBRL(p.precioBRL)}</div>
            </div>
            <button style={styles.iconButtonSm} onClick={() => setEditing(p)}>✎</button>
            <button style={{ ...styles.iconButtonSm, color: "#B91C1C" }} onClick={() => remove(p.id)}>🗑</button>
          </div>
        ))}
      </div>
      {editing && <ProductoForm producto={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSave={save} />}
    </div>
  );
}

function ProductoForm({ producto, onClose, onSave }) {
  const [nombre, setNombre] = useState(producto?.nombre || "");
  const [marca, setMarca] = useState(producto?.marca || "");
  const [categoria, setCategoria] = useState(producto?.categoria || "chop");
  const [tamano, setTamano] = useState(producto?.tamano || "");
  const [precioGs, setPrecioGs] = useState(producto?.precioGs ?? "");
  const [precioBRL, setPrecioBRL] = useState(producto?.precioBRL ?? "");
  const [activo, setActivo] = useState(producto?.activo !== false);
  const [imagen, setImagen] = useState(producto?.imagen || "");
  const [subiendo, setSubiendo] = useState(false);
  const [errorImg, setErrorImg] = useState("");
  const valido = nombre.trim() && precioGs !== "" && precioBRL !== "";

  const elegirFoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite volver a elegir el mismo archivo si hace falta
    if (!file) return;
    if (!/^image\/(jpe?g|png)$/i.test(file.type)) { setErrorImg("Elegí una foto en formato JPG o PNG."); return; }
    setErrorImg(""); setSubiendo(true);
    try {
      const base64 = await resizeImageToBase64(file);
      setImagen(base64);
    } catch (err) {
      setErrorImg("No se pudo procesar la foto. Probá con otra.");
    } finally {
      setSubiendo(false);
    }
  };

  return (
    <ModalWrap onClose={onClose} title={producto ? "Editar producto" : "Nuevo producto"}>
      <label style={styles.label}>Foto del producto (JPG o PNG)</label>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        {imagen
          ? <img src={imagen} alt="Vista previa" style={{ ...styles.thumb, width: 64, height: 64 }} />
          : <div style={{ ...styles.thumb, ...styles.thumbPlaceholder, width: 64, height: 64, fontSize: 24 }}>🍺</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ ...styles.secondaryButton, textAlign: "center", display: "inline-block" }}>
            {subiendo ? "Procesando…" : imagen ? "Cambiar foto" : "Elegir foto"}
            <input type="file" accept="image/jpeg,image/jpg,image/png" onChange={elegirFoto} style={{ display: "none" }} />
          </label>
          {imagen && <button style={{ ...styles.secondaryButton, color: "#B91C1C", borderColor: "#B91C1C" }} onClick={() => setImagen("")}>Quitar foto</button>}
        </div>
      </div>
      {errorImg && <p style={{ color: "#B91C1C", fontSize: 12, marginBottom: 8 }}>{errorImg}</p>}

      <label style={{ ...styles.label, marginTop: 12 }}>Nombre</label>
      <input style={styles.input} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Chop Brahma 300ml" />
      <label style={{ ...styles.label, marginTop: 12 }}>Marca</label>
      <input style={styles.input} value={marca} onChange={(e) => setMarca(e.target.value)} placeholder="Ej: Brahma" />
      <label style={{ ...styles.label, marginTop: 12 }}>Categoría</label>
      <select style={styles.input} value={categoria} onChange={(e) => setCategoria(e.target.value)}>
        {CATS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
      <label style={{ ...styles.label, marginTop: 12 }}>Tamaño / presentación</label>
      <input style={styles.input} value={tamano} onChange={(e) => setTamano(e.target.value)} placeholder="300ml / 500ml / Unidad" />
      <label style={{ ...styles.label, marginTop: 12 }}>Precio en Guaraníes</label>
      <input style={styles.input} type="number" value={precioGs} onChange={(e) => setPrecioGs(e.target.value)} />
      <label style={{ ...styles.label, marginTop: 12 }}>Precio en Reales</label>
      <input style={styles.input} type="number" value={precioBRL} onChange={(e) => setPrecioBRL(e.target.value)} />
      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
        <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} /> Activo (visible para la venta)
      </label>
      <button style={{ ...styles.primaryButton, marginTop: 16 }} disabled={!valido || subiendo}
        onClick={() => onSave({ id: producto?.id, nombre: nombre.trim(), marca: marca.trim(), categoria, tamano: tamano.trim(), precioGs: Number(precioGs), precioBRL: Number(precioBRL), activo, imagen })}>
        Guardar
      </button>
    </ModalWrap>
  );
}

// ================= CONFIGURACIÓN (logo del negocio) =================
function Configuracion({ config, setConfig, showToast }) {
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState("");

  const elegirLogo = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/^image\/(jpe?g|png)$/i.test(file.type)) { setError("Elegí una imagen en formato JPG o PNG."); return; }
    setError(""); setSubiendo(true);
    try {
      const base64 = await resizeImageToBase64(file, 480, 0.85);
      await setConfig({ ...config, logo: base64 });
      showToast("Logo actualizado");
    } catch (err) {
      setError("No se pudo procesar la imagen. Probá con otra.");
    } finally {
      setSubiendo(false);
    }
  };

  const quitarLogo = async () => {
    await setConfig({ ...config, logo: "" });
    showToast("Logo quitado");
  };

  return (
    <div>
      <SectionTitle>Logo del negocio</SectionTitle>
      <div style={styles.card}>
        <p style={{ color: "#7C5E3C", fontSize: 13, marginBottom: 12 }}>
          Este logo aparece en la pantalla de inicio, en lugar del ícono de chop 🍺. Se acepta JPG o PNG (si tiene fondo transparente, se conserva).
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {config?.logo
            ? <img src={config.logo} alt="Logo actual" style={{ width: 72, height: 72, borderRadius: 12, objectFit: "contain", border: "1px solid #E7DCC9", background: "#fff" }} />
            : <div style={{ ...styles.thumb, ...styles.thumbPlaceholder, width: 72, height: 72, fontSize: 28 }}>🍺</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ ...styles.secondaryButton, textAlign: "center", display: "inline-block" }}>
              {subiendo ? "Procesando…" : config?.logo ? "Cambiar logo" : "Subir logo"}
              <input type="file" accept="image/jpeg,image/jpg,image/png" onChange={elegirLogo} style={{ display: "none" }} />
            </label>
            {config?.logo && <button style={{ ...styles.secondaryButton, color: "#B91C1C", borderColor: "#B91C1C" }} onClick={quitarLogo}>Quitar logo</button>}
          </div>
        </div>
        {error && <p style={{ color: "#B91C1C", fontSize: 12, marginTop: 8 }}>{error}</p>}
      </div>

      <DatosNegocio config={config} setConfig={setConfig} showToast={showToast} />
    </div>
  );
}

function DatosNegocio({ config, setConfig, showToast }) {
  const [nombreNegocio, setNombreNegocio] = useState(config?.nombreNegocio || "");
  const [direccion, setDireccion] = useState(config?.direccion || "");

  const guardar = async () => {
    await setConfig({ ...config, nombreNegocio: nombreNegocio.trim(), direccion: direccion.trim() });
    showToast("Datos del negocio actualizados");
  };

  return (
    <>
      <SectionTitle>Datos del negocio (para el ticket impreso)</SectionTitle>
      <div style={styles.card}>
        <label style={styles.label}>Nombre del negocio</label>
        <input style={styles.input} value={nombreNegocio} onChange={(e) => setNombreNegocio(e.target.value)} placeholder="Ej: The Brick Beer Bar" />
        <label style={{ ...styles.label, marginTop: 12 }}>Dirección (opcional)</label>
        <input style={styles.input} value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Ej: Shopping Paris, Ciudad del Este" />
        <p style={{ color: "#B08968", fontSize: 12, marginTop: 8 }}>
          Si dejás el nombre vacío, el ticket va a mostrar "TAP CONTROL" por defecto.
        </p>
        <button style={{ ...styles.primaryButton, marginTop: 12 }} onClick={guardar}>Guardar</button>
      </div>
    </>
  );
}

// ================= USUARIOS (cajeros + contraseña admin) =================
function Usuarios({ usuarios, setUsuarios, config, setConfig, showToast }) {
  const [editing, setEditing] = useState(null);

  const save = (data) => {
    if (data.id) setUsuarios(usuarios.map((u) => (u.id === data.id ? data : u)));
    else setUsuarios([...usuarios, { ...data, id: uid() }]);
    setEditing(null);
    showToast("Usuario guardado");
  };
  const remove = (id) => { setUsuarios(usuarios.filter((u) => u.id !== id)); showToast("Usuario eliminado"); };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <SectionTitle>Cajeros ({usuarios.length})</SectionTitle>
        <button style={styles.secondaryButton} onClick={() => setEditing("new")}>➕ Nuevo</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {usuarios.map((u) => (
          <div key={u.id} style={styles.productRow}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>👤 {u.nombre} {u.activo === false && <span style={{ color: "#B91C1C", fontSize: 11 }}>(inactivo)</span>}</div>
              <div style={{ fontSize: 12, color: "#B08968" }}>PIN: {u.pin}</div>
            </div>
            <button style={styles.iconButtonSm} onClick={() => setEditing(u)}>✎</button>
            <button style={{ ...styles.iconButtonSm, color: "#B91C1C" }} onClick={() => remove(u.id)}>🗑</button>
          </div>
        ))}
        {usuarios.length === 0 && <p style={{ color: "#B08968" }}>Todavía no creaste ningún cajero.</p>}
      </div>
      {editing && <UsuarioForm usuario={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSave={save} />}

      <SectionTitle>Contraseña de administrador</SectionTitle>
      <CambiarPasswordAdmin config={config} setConfig={setConfig} showToast={showToast} />
    </div>
  );
}

function UsuarioForm({ usuario, onClose, onSave }) {
  const [nombre, setNombre] = useState(usuario?.nombre || "");
  const [pin, setPin] = useState(usuario?.pin || "");
  const [activo, setActivo] = useState(usuario?.activo !== false);
  const valido = nombre.trim() && pin.length === 4;

  return (
    <ModalWrap onClose={onClose} title={usuario ? "Editar cajero" : "Nuevo cajero"}>
      <label style={styles.label}>Nombre del cajero</label>
      <input style={styles.input} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Marcos" autoFocus />
      <label style={{ ...styles.label, marginTop: 12 }}>PIN de 4 dígitos</label>
      <input style={{ ...styles.input, letterSpacing: 4 }} inputMode="numeric" maxLength={4}
        value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="0000" />
      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
        <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} /> Activo (puede iniciar sesión)
      </label>
      <button style={{ ...styles.primaryButton, marginTop: 16 }} disabled={!valido}
        onClick={() => onSave({ id: usuario?.id, nombre: nombre.trim(), pin, activo })}>
        Guardar
      </button>
    </ModalWrap>
  );
}

function CambiarPasswordAdmin({ config, setConfig, showToast }) {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [error, setError] = useState("");

  const guardar = async () => {
    if (actual !== config?.adminPassword) { setError("La contraseña actual no es correcta."); return; }
    if (nueva.length < 4) { setError("La nueva contraseña debe tener al menos 4 caracteres."); return; }
    if (nueva !== confirmar) { setError("Las contraseñas nuevas no coinciden."); return; }
    await setConfig({ ...config, adminPassword: nueva });
    setActual(""); setNueva(""); setConfirmar(""); setError("");
    showToast("Contraseña actualizada");
  };

  return (
    <div style={styles.card}>
      <label style={styles.label}>Contraseña actual</label>
      <input style={styles.input} type="password" value={actual} onChange={(e) => setActual(e.target.value)} />
      <label style={{ ...styles.label, marginTop: 12 }}>Nueva contraseña</label>
      <input style={styles.input} type="password" value={nueva} onChange={(e) => setNueva(e.target.value)} />
      <label style={{ ...styles.label, marginTop: 12 }}>Repetir nueva contraseña</label>
      <input style={styles.input} type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} />
      {error && <p style={{ color: "#B91C1C", fontSize: 12, marginTop: 8 }}>{error}</p>}
      <button style={{ ...styles.primaryButton, marginTop: 16 }} disabled={!actual || !nueva || !confirmar} onClick={guardar}>
        Actualizar contraseña
      </button>
    </div>
  );
}

function Turnos({ cajas, setCajas, ventas, movimientos, showToast }) {
  const [detalle, setDetalle] = useState(null);
  const [contadoGs, setContadoGs] = useState("");
  const [contadoBrl, setContadoBrl] = useState("");
  const ordenadas = [...cajas].sort((a, b) => new Date(b.fechaApertura) - new Date(a.fechaApertura));

  const abrirDetalle = (c) => { setDetalle(c); setContadoGs(""); setContadoBrl(""); };

  const ventasDelTurno = detalle ? ventas.filter((v) => v.cajaId === detalle.id) : [];
  const ventasValidas = ventasDelTurno.filter((v) => !v.anulada);
  const sum = (f) => ventasValidas.filter(f).reduce((s, v) => s + v.total, 0);
  const ventasEfectivoGs = detalle ? sum((v) => v.moneda === "GS" && v.metodoPago === "efectivo") : 0;
  const ventasTarjetaGs = detalle ? sum((v) => v.moneda === "GS" && v.metodoPago === "tarjeta") : 0;
  const ventasEfectivoBrl = detalle ? sum((v) => v.moneda === "BRL" && v.metodoPago === "efectivo") : 0;
  const ventasTarjetaBrl = detalle ? sum((v) => v.moneda === "BRL" && v.metodoPago === "tarjeta") : 0;

  const movsDelTurno = detalle ? movimientos.filter((m) => m.cajaId === detalle.id) : [];
  const retirosGs = movsDelTurno.filter((m) => m.tipo === "retiro" && m.moneda === "GS").reduce((s, m) => s + m.monto, 0);
  const ingresosGs = movsDelTurno.filter((m) => m.tipo === "ingreso" && m.moneda === "GS").reduce((s, m) => s + m.monto, 0);
  const retirosBrl = movsDelTurno.filter((m) => m.tipo === "retiro" && m.moneda === "BRL").reduce((s, m) => s + m.monto, 0);
  const ingresosBrl = movsDelTurno.filter((m) => m.tipo === "ingreso" && m.moneda === "BRL").reduce((s, m) => s + m.monto, 0);

  const esperadoGs = detalle ? detalle.aperturaGs + ventasEfectivoGs + ingresosGs - retirosGs : 0;
  const esperadoBrl = detalle ? detalle.aperturaBRL + ventasEfectivoBrl + ingresosBrl - retirosBrl : 0;

  const cerrarDesdeAdmin = async () => {
    const cierreGs = Number(contadoGs) || 0;
    const cierreBRL = Number(contadoBrl) || 0;
    const next = cajas.map((c) =>
      c.id === detalle.id
        ? { ...c, estado: "cerrada", fechaCierre: nowISO(), cierreGs, cierreBRL,
            esperadoGs, esperadoBRL: esperadoBrl,
            diferenciaGs: cierreGs - esperadoGs, diferenciaBRL: cierreBRL - esperadoBrl }
        : c
    );
    await setCajas(next);
    showToast("Caja cerrada desde el Back Office");
    setDetalle(null);
  };

  return (
    <div>
      <SectionTitle>Historial de turnos ({cajas.length})</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {ordenadas.map((c) => (
          <button key={c.id} style={styles.productRow} onClick={() => abrirDetalle(c)}>
            <div style={{ flex: 1, textAlign: "left" }}>
              <div style={{ fontWeight: 700 }}>{c.operador} · <span style={{ color: c.estado === "abierta" ? "#166534" : "#7C5E3C" }}>{c.estado}</span></div>
              <div style={{ fontSize: 12, color: "#B08968" }}>{fmtDateTime(c.fechaApertura)} → {c.fechaCierre ? fmtDateTime(c.fechaCierre) : "en curso"}</div>
            </div>
          </button>
        ))}
        {ordenadas.length === 0 && <p style={{ color: "#B08968" }}>Aún no hay turnos registrados.</p>}
      </div>
      {detalle && (
        <ModalWrap onClose={() => setDetalle(null)} title={`Turno de ${detalle.operador}`}>
          <MiniRow label="Apertura ₲ / R$" value={`${fmtGs(detalle.aperturaGs)} / ${fmtBRL(detalle.aperturaBRL)}`} />
          <MiniRow label="Ventas efectivo ₲ / tarjeta ₲" value={`${fmtGs(ventasEfectivoGs)} / ${fmtGs(ventasTarjetaGs)}`} />
          <MiniRow label="Ventas efectivo R$ / tarjeta R$" value={`${fmtBRL(ventasEfectivoBrl)} / ${fmtBRL(ventasTarjetaBrl)}`} />
          <MiniRow label="Ingresos ₲ / retiros ₲" value={`${fmtGs(ingresosGs)} / ${fmtGs(retirosGs)}`} />
          <MiniRow label="Ingresos R$ / retiros R$" value={`${fmtBRL(ingresosBrl)} / ${fmtBRL(retirosBrl)}`} />
          <MiniRow label="Esperado en caja ₲ / R$" value={`${fmtGs(esperadoGs)} / ${fmtBRL(esperadoBrl)}`} bold />

          {detalle.estado === "cerrada" ? (
            <>
              <MiniRow label="Cierre ₲ / R$" value={`${fmtGs(detalle.cierreGs)} / ${fmtBRL(detalle.cierreBRL)}`} />
              <MiniRow label="Diferencia ₲" value={fmtGs(detalle.diferenciaGs)} highlight={detalle.diferenciaGs !== 0} />
              <MiniRow label="Diferencia R$" value={fmtBRL(detalle.diferenciaBRL)} highlight={detalle.diferenciaBRL !== 0} />
            </>
          ) : (
            <>
              <hr style={{ margin: "12px 0", border: "none", borderTop: "1px solid #E7DCC9" }} />
              <p style={{ color: "#7C5E3C", fontSize: 13, marginBottom: 8 }}>Esta caja sigue abierta. Podés cerrarla vos mismo desde acá si hace falta.</p>
              <label style={styles.label}>Efectivo contado ₲</label>
              <input style={styles.input} type="number" value={contadoGs} onChange={(e) => setContadoGs(e.target.value)} />
              <label style={{ ...styles.label, marginTop: 12 }}>Efectivo contado R$</label>
              <input style={styles.input} type="number" value={contadoBrl} onChange={(e) => setContadoBrl(e.target.value)} />
              <button style={{ ...styles.primaryButton, marginTop: 12 }} onClick={cerrarDesdeAdmin}>Cerrar esta caja</button>
            </>
          )}

          <SectionTitle>Ventas del turno</SectionTitle>
          <TableBox headers={["N°", "Hora", "Total", "Moneda", "Pago", "Estado"]}
            rows={ventasDelTurno.map((v) => [
              v.numero ?? "-",
              fmtDateTime(v.fecha),
              fmtMoney(v.total, v.moneda),
              v.moneda,
              v.metodoPago,
              v.anulada ? "Anulada" : "OK",
            ])}
            empty="Sin ventas" />
          <SectionTitle>Movimientos del turno</SectionTitle>
          <TableBox headers={["Hora", "Tipo", "Monto", "Por", "Obs."]}
            rows={movsDelTurno.map((m) => [fmtDateTime(m.fecha), m.tipo, fmtMoney(m.monto, m.moneda), m.usuario, m.observacion])}
            empty="Sin movimientos" />
        </ModalWrap>
      )}
    </div>
  );
}

// ================= VENTAS (anular / cambiar método de pago) =================
function VentasAdmin({ ventas, setVentas, showToast }) {
  const [anulando, setAnulando] = useState(null);
  const [busqueda, setBusqueda] = useState("");

  const ordenadas = [...ventas].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  const filtradas = busqueda.trim()
    ? ordenadas.filter((v) => String(v.numero ?? "").includes(busqueda.trim()) || v.operador.toLowerCase().includes(busqueda.trim().toLowerCase()))
    : ordenadas.slice(0, 100); // por defecto, últimas 100 para no saturar la pantalla

  const cambiarPago = (venta) => {
    const nuevo = venta.metodoPago === "efectivo" ? "tarjeta" : "efectivo";
    setVentas(ventas.map((v) => (v.id === venta.id ? { ...v, metodoPago: nuevo } : v)));
    showToast(`Ticket #${venta.numero ?? ""} → ahora figura como ${nuevo}`);
  };

  const confirmarAnular = () => {
    setVentas(ventas.map((v) => (v.id === anulando.id ? { ...v, anulada: true } : v)));
    showToast(`Ticket #${anulando.numero ?? ""} anulado`);
    setAnulando(null);
  };

  const reactivar = (venta) => {
    setVentas(ventas.map((v) => (v.id === venta.id ? { ...v, anulada: false } : v)));
    showToast(`Ticket #${venta.numero ?? ""} reactivado`);
  };

  return (
    <div>
      <SectionTitle>Ventas ({ventas.length})</SectionTitle>
      <input style={{ ...styles.input, marginBottom: 12 }} placeholder="Buscar por N° de ticket u operador…"
        value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
      {!busqueda.trim() && <p style={{ fontSize: 12, color: "#B08968", marginTop: -6, marginBottom: 10 }}>Mostrando las últimas 100 ventas. Buscá por número u operador para encontrar otras.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtradas.map((v) => (
          <div key={v.id} style={{ ...styles.productRow, alignItems: "flex-start", opacity: v.anulada ? 0.6 : 1 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>
                Ticket #{v.numero ?? "-"} {v.anulada && <span style={{ color: "#B91C1C", fontSize: 11 }}>(ANULADO)</span>}
              </div>
              <div style={{ fontSize: 12, color: "#B08968" }}>{fmtDateTime(v.fecha)} · {v.operador}</div>
              <div style={{ fontSize: 13, marginTop: 2 }}>{fmtMoney(v.total, v.moneda)} · <b>{v.metodoPago}</b></div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {!v.anulada ? (
                <>
                  <button style={styles.secondaryButton} onClick={() => cambiarPago(v)}>
                    Cambiar a {v.metodoPago === "efectivo" ? "tarjeta" : "efectivo"}
                  </button>
                  <button style={{ ...styles.secondaryButton, color: "#B91C1C", borderColor: "#B91C1C" }} onClick={() => setAnulando(v)}>
                    Anular
                  </button>
                </>
              ) : (
                <button style={styles.secondaryButton} onClick={() => reactivar(v)}>Reactivar</button>
              )}
            </div>
          </div>
        ))}
        {filtradas.length === 0 && <p style={{ color: "#B08968" }}>No se encontraron ventas.</p>}
      </div>

      {anulando && (
        <ModalWrap onClose={() => setAnulando(null)} title="Anular ticket">
          <p style={{ color: "#7C5E3C", fontSize: 14 }}>
            ¿Confirmás anular el <b>ticket #{anulando.numero ?? "-"}</b> por {fmtMoney(anulando.total, anulando.moneda)}?
          </p>
          <p style={{ color: "#B08968", fontSize: 12, marginTop: 8 }}>
            El ticket queda marcado como anulado y se descuenta de los reportes de venta, pero no se borra (queda el registro para auditoría).
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button style={styles.secondaryButton} onClick={() => setAnulando(null)}>Cancelar</button>
            <button style={{ ...styles.primaryButton, background: "#B91C1C" }} onClick={confirmarAnular}>Sí, anular</button>
          </div>
        </ModalWrap>
      )}
    </div>
  );
}

function MovimientosHistorial({ movimientos }) {
  const ordenados = [...movimientos].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  return (
    <div>
      <SectionTitle>Movimientos de caja ({movimientos.length})</SectionTitle>
      <TableBox headers={["Fecha", "Tipo", "Monto", "Realizado por", "Observación"]}
        rows={ordenados.map((m) => [fmtDateTime(m.fecha), m.tipo, fmtMoney(m.monto, m.moneda), m.usuario, m.observacion])}
        empty="Aún no hay movimientos registrados" />
    </div>
  );
}

// ================= UI atoms =================
function BackBar({ onBack, title }) {
  return (
    <div style={styles.backBar}>
      <button style={styles.iconButton} onClick={onBack}>‹</button>
      <span style={{ fontWeight: 700 }}>{title}</span>
    </div>
  );
}
function SectionTitle({ children }) { return <div style={styles.sectionTitle}>{children}</div>; }
function MiniRow({ label, value, bold, highlight }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
      <span style={{ color: "#7C5E3C" }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 600, color: highlight ? "#B91C1C" : "#292118" }}>{value}</span>
    </div>
  );
}
function StatBox({ label, value }) {
  return (
    <div style={styles.statBox}>
      <div style={{ fontSize: 11, color: "#B08968" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
function TableBox({ headers, rows, empty }) {
  return (
    <div style={{ overflowX: "auto", marginBottom: 16 }}>
      <table style={styles.table}>
        <thead><tr>{headers.map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={headers.length} style={{ ...styles.td, color: "#B08968", textAlign: "center" }}>{empty}</td></tr>}
          {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={styles.td}>{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}
function ToggleBtn({ active, label, onClick }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: "10px 12px", borderRadius: 10, border: active ? "1px solid #B45309" : "1px solid #E7DCC9",
      background: active ? "#B45309" : "#fff", color: active ? "#fff" : "#292118", fontWeight: 600, fontSize: 13,
    }}>{label}</button>
  );
}
function TabBtn({ active, label, emoji, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", borderRadius: 10, border: "none",
      background: active ? "#292118" : "transparent", color: active ? "#fff" : "#292118", fontWeight: 600, fontSize: 13, whiteSpace: "nowrap",
    }}>{emoji} {label}</button>
  );
}
function ModalWrap({ onClose, title, big, children }) {
  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modal}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontWeight: 800, fontSize: big ? 24 : 16, color: big ? "#166534" : "#292118" }}>{title}</span>
          <button style={styles.iconButtonSm} onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ================= styles =================
const styles = {
  app: { minHeight: "100vh", background: "#FAF6EE", color: "#292118" },
  loadingScreen: { minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#FAF6EE" },
  centerScreen: { minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", padding: "40px 20px", background: "#FAF6EE" },
  h1: { fontSize: 30, fontWeight: 800, margin: "12px 0 4px", letterSpacing: -0.5 },
  subtitle: { color: "#B08968", fontSize: 14 },
  bigButton: { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "16px 20px", borderRadius: 14, border: "none", background: "#B45309", color: "#fff", fontWeight: 700, fontSize: 15 },
  card: { background: "#fff", border: "1px solid #E7DCC9", borderRadius: 16, padding: 24, width: "100%", maxWidth: 380, marginTop: 12 },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#7C5E3C", marginBottom: 6 },
  input: { width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #E7DCC9", fontSize: 14, background: "#FEFCF8" },
  primaryButton: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "12px 16px", borderRadius: 10, border: "none", background: "#B45309", color: "#fff", fontWeight: 700, fontSize: 14 },
  secondaryButton: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 14px", borderRadius: 10, border: "1px solid #B45309", background: "#fff", color: "#B45309", fontWeight: 700, fontSize: 13 },
  iconButton: { display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 10, border: "1px solid #E7DCC9", background: "#fff", color: "#292118" },
  iconButtonSm: { display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 8, border: "1px solid #E7DCC9", background: "#fff", color: "#292118" },
  backBar: { display: "flex", alignItems: "center", gap: 10, width: "100%", maxWidth: 420, marginBottom: 4 },
  posLayout: { minHeight: "100vh", display: "flex", flexDirection: "column", background: "#FAF6EE" },
  posHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", background: "#292118", color: "#fff" },
  catRow: { display: "flex", gap: 8, padding: "12px 16px", overflowX: "auto" },
  productGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, padding: "0 16px", flex: 1, alignContent: "start" },
  productCard: { textAlign: "left", background: "#fff", border: "1px solid #E7DCC9", borderRadius: 12, padding: 12 },
  cartPanel: { background: "#fff", borderTop: "1px solid #E7DCC9", padding: 16, position: "sticky", bottom: 0 },
  cartRow: { display: "flex", alignItems: "center", gap: 6, padding: "6px 0", borderBottom: "1px solid #F3ECDD" },
  qtyBtn: { width: 26, height: 26, borderRadius: 8, border: "1px solid #E7DCC9", background: "#FAF6EE", display: "flex", alignItems: "center", justifyContent: "center" },
  toast: { position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", background: "#292118", color: "#fff", padding: "10px 18px", borderRadius: 10, fontSize: 13, zIndex: 999 },
  modalOverlay: { position: "fixed", inset: 0, background: "rgba(41,33,24,0.5)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 100 },
  modal: { background: "#fff", borderRadius: "18px 18px 0 0", padding: 20, width: "100%", maxWidth: 460, maxHeight: "88vh", overflowY: "auto" },
  totalBox: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "#FAF6EE", borderRadius: 10, padding: "12px 14px", fontSize: 16 },
  ticket: { background: "#FEFCF8", border: "1px dashed #D8C7A8", borderRadius: 8, padding: 14, fontFamily: "monospace", fontSize: 12 },
  ticketHr: { border: "none", borderTop: "1px dashed #D8C7A8", margin: "6px 0" },
  ticketRow: { display: "flex", justifyContent: "space-between" },
  boLayout: { minHeight: "100vh", background: "#FAF6EE", padding: "16px 0" },
  tabRow: { display: "flex", gap: 6, padding: "12px 16px", overflowX: "auto" },
  sectionTitle: { fontWeight: 700, fontSize: 14, margin: "16px 0 10px", color: "#7C2D12", textTransform: "uppercase", letterSpacing: 0.4 },
  reportGrid: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 8 },
  statBox: { background: "#fff", border: "1px solid #E7DCC9", borderRadius: 10, padding: 12 },
  productRow: { display: "flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #E7DCC9", borderRadius: 10, padding: 10, textAlign: "left" },
  thumb: { width: 44, height: 44, borderRadius: 8, objectFit: "cover", flexShrink: 0, border: "1px solid #E7DCC9" },
  thumbPlaceholder: { display: "flex", alignItems: "center", justifyContent: "center", background: "#FAF6EE", color: "#D8C7A8" },
  productImg: { width: "100%", height: 80, borderRadius: 8, objectFit: "cover", marginBottom: 6, display: "flex", alignItems: "center", justifyContent: "center" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12, background: "#fff", borderRadius: 10, overflow: "hidden" },
  th: { textAlign: "left", padding: "8px 10px", background: "#292118", color: "#fff", fontWeight: 600 },
  td: { padding: "8px 10px", borderBottom: "1px solid #F3ECDD" },
};

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
