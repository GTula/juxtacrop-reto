import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_URL;

export default function App() {
  const [db, setDb] = useState("cargando...");

  useEffect(() => {
    fetch(`${API}/health/db`)
      .then((r) => r.json())
      .then((d) => setDb(`OK (PostGIS ${d.postgis})`))
      .catch(() => setDb("sin conexión"));
  }, []);

  return (
    <main style={{ fontFamily: "sans-serif", padding: 24 }}>
      <h1>JuxtaCrop</h1>
      <p>Backend + base de datos: {db}</p>
    </main>
  );
}
