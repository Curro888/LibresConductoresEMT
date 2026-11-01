import React from 'react';
import { CalendarioWidget } from './CalendarioWidget';
import { calcularDatosWidget } from './datosWidget';
import { anchoWidgetDp } from './anchoWidget';

export async function widgetTaskHandler(props) {
  try {
    switch (props.widgetAction) {
      case 'WIDGET_ADDED':
      case 'WIDGET_UPDATE':
      case 'WIDGET_RESIZED': {
        const data = await calcularDatosWidget();
        props.renderWidget(<CalendarioWidget data={data} ancho={anchoWidgetDp(props.widgetInfo)} />);
        break;
      }
      default:
        break;
    }
  } catch (e) {
    console.log('Widget:', e?.message || e);
  }
}
