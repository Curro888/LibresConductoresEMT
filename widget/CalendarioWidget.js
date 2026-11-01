import React from 'react';
import { FlexWidget, ListWidget, TextWidget } from 'react-native-android-widget';

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const LETRAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const ESQUEMA = 'libresconductores';
const ALTO_FILA = 30;

function Mes({ mes, anchoCelda }) {
  const { anio, mIdx, hoy, primerDia, dias, estilos } = mes;
  const filas = [];
  let fila = [];
  for (let i = 0; i < primerDia; i++) fila.push(null);
  for (let d = 1; d <= dias; d++) {
    fila.push(d);
    if (fila.length === 7) { filas.push(fila); fila = []; }
  }
  if (fila.length) { while (fila.length < 7) fila.push(null); filas.push(fila); }

  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{ width: 'match_parent', flexDirection: 'column', paddingHorizontal: 6, paddingVertical: 4 }}
    >
      <FlexWidget style={{ width: 'match_parent', height: 24, alignItems: 'center', justifyContent: 'center' }}>
        <TextWidget text={MESES[mIdx] + ' ' + anio} style={{ fontSize: 15, fontWeight: 'bold', color: '#ffffff' }} />
      </FlexWidget>
      <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', height: 18 }}>
        {LETRAS.map(l => (
          <FlexWidget key={l} style={anchoCelda ? { width: anchoCelda, alignItems: 'center' } : { flex: 1, alignItems: 'center' }}>
            <TextWidget text={l} style={{ fontSize: 11, color: '#a5b4fc', fontWeight: 'bold' }} />
          </FlexWidget>
        ))}
      </FlexWidget>
      {filas.map((f, i) => (
        <FlexWidget key={i} style={{ flexDirection: 'row', width: 'match_parent', height: ALTO_FILA }}>
          {f.map((d, j) => {
            if (!d) return <FlexWidget key={j} style={anchoCelda ? { width: anchoCelda, height: ALTO_FILA } : { flex: 1, height: ALTO_FILA }} />;
            const st = estilos[d] || { bg: '#f1f5f9', fg: '#334155' };
            const esHoy = hoy === d;
            return (
              <FlexWidget
                key={j}
                clickAction="OPEN_URI"
                clickActionData={{ uri: ESQUEMA + '://dia/' + anio + '/' + mIdx + '/' + d }}
                style={anchoCelda ? { width: anchoCelda, height: ALTO_FILA, padding: 1 } : { flex: 1, height: ALTO_FILA, padding: 1 }}
              >
                <FlexWidget
                  style={{
                    flex: 1, width: 'match_parent', height: 'match_parent', alignItems: 'center', justifyContent: 'center',
                    backgroundColor: st.bg, borderRadius: 6,
                    borderWidth: esHoy ? 2 : 0, borderColor: esHoy ? '#facc15' : st.bg,
                  }}
                >
                  <TextWidget text={String(d)} style={{ fontSize: 12, color: st.fg, fontWeight: esHoy ? 'bold' : 'normal' }} />
                </FlexWidget>
              </FlexWidget>
            );
          })}
        </FlexWidget>
      ))}
    </FlexWidget>
  );
}

export function CalendarioWidget({ data, ancho }) {
  // Ancho de cada día en dp (7 columnas, menos el margen del mes); sin dato, se reparte con flex
  const anchoCelda = ancho ? Math.floor((ancho - 14) / 7) : 0;
  return (
    <ListWidget
      style={{ height: 'match_parent', width: 'match_parent', backgroundColor: '#1e1b4b', borderRadius: 16 }}
    >
      {data.meses.map(m => <Mes key={m.anio + '-' + m.mIdx} mes={m} anchoCelda={anchoCelda} />)}
    </ListWidget>
  );
}
