import React from 'react';
import { FlexWidget, TextWidget } from 'react-native-android-widget';

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const LETRAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

// data = { anio, mIdx, hoy, celdas: [{ d, bg, fg, borde }] , primerDia }
export function CalendarioWidget({ data }) {
  const { anio, mIdx, hoy, primerDia, dias, estilos } = data;
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
      style={{ height: 'match_parent', width: 'match_parent', backgroundColor: '#1e1b4b', borderRadius: 16, padding: 8, flexDirection: 'column' }}
    >
      <TextWidget
        text={MESES[mIdx] + ' ' + anio}
        style={{ fontSize: 15, fontWeight: 'bold', color: '#ffffff', textAlign: 'center', width: 'match_parent' }}
      />
      <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', marginTop: 4 }}>
        {LETRAS.map(l => (
          <FlexWidget key={l} style={{ flex: 1, alignItems: 'center' }}>
            <TextWidget text={l} style={{ fontSize: 11, color: '#a5b4fc', fontWeight: 'bold' }} />
          </FlexWidget>
        ))}
      </FlexWidget>
      {filas.map((f, i) => (
        <FlexWidget key={i} style={{ flexDirection: 'row', width: 'match_parent', flex: 1 }}>
          {f.map((d, j) => {
            if (!d) return <FlexWidget key={j} style={{ flex: 1 }} />;
            const st = estilos[d] || { bg: '#f1f5f9', fg: '#334155' };
            const esHoy = hoy === d;
            return (
              <FlexWidget
                key={j}
                clickAction="OPEN_URI"
                clickActionData={{ uri: 'libresconductores://dia/' + anio + '/' + mIdx + '/' + d }}
                style={{ flex: 1, height: 'match_parent', padding: 1 }}
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
