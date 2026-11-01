import React from 'react';
import { Platform } from 'react-native';
import { CalendarioWidget } from './CalendarioWidget';
import { calcularDatosWidget } from './datosWidget';
import { anchoWidgetDp } from './anchoWidget';

// Pide al widget que se redibuje. Si esta versión de la app no lleva el widget, no hace nada.
export async function actualizarWidget() {
  try {
    if (Platform.OS !== 'android') return;
    const { requestWidgetUpdate } = require('react-native-android-widget');
    await requestWidgetUpdate({
      widgetName: 'CalendarioMes',
      renderWidget: async (info) => <CalendarioWidget data={await calcularDatosWidget()} ancho={anchoWidgetDp(info)} />,
      widgetNotFound: () => {},
    });
  } catch (e) {}
}
