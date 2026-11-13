# Revision y recuperacion contable - noviembre 2026

## Hallazgos comprobados
Alemán y Fabio Velásquez tienen horas de octubre pendientes con allowOvertime deshabilitado. Noviembre contiene cuotas emitidas; diciembre no se emite como deuda actual. El hosting anterior restauró el generador antiguo de reportes frente a reglas de servidor. Los planes completados no deben contarse como ingresos: solamente sus pagos.

## Cambios implementados
- Errores asincrónicos esperados dentro de los manejadores contables.
- Actualizaciones salariales conservan allowOvertime cuando se omite.
- Descuento de pago a tiempo también para períodos futuros, con desglose del adelanto y selección de varios meses sin máximo de 24 meses.
- Vista previa del servidor accountingPreviewMemberFeePayment, montos pendientes y meses cancelados.
- Registro transaccional de claves de operación de cobros y parciales en accounting_operations; misma clave con distintos datos se rechaza.
- Cierre del plan y cuotas en la misma transacción, con recálculo de deuda exigible y próximo mes no cubierto.
- Exclusión de planes principales en balances, reportes y cierres; permanecen visibles sus pagos efectivos.
- Reportes usan el generador del servidor y conservan nombre, historial y reglas de lectura existentes.

## Recuperación
Ejecutar `node scripts/recover-accounting.mjs` para preparar el inventario. `--execute` habilita exclusivamente las dos configuraciones autorizadas y guarda auditoría con precondiciones de versión. No registra pagos. Los planes antiguos sin asignación explícita se listan para selección administrativa por comprobantes; no se asignan por el mes del movimiento. No borrar ni volver a generar ingresos históricos.

## Contratos
accountingPreviewMemberFeePayment recibe memberId, periods (1-100), operationDate y devuelve lines con período, cargo, estado, importe base, descuento, abonado y saldo. El cobro reutiliza accountingRegisterMemberFeeBatchPayment. Los importes se expresan en centavos; las comisiones no cancelan capital de cuotas. El importe de cada período se fija cuando comienza su pago. Los adelantos generan caja en fecha de cobro y cobertura en el mes seleccionado.

## Publicación
Compilar funciones y web para publicar. Desplegar contratos, funciones y reglas antes que hosting desde el árbol actual coherente; nunca restaurar pantallas desde HEAD omitiendo sus dependencias. Conservar las versiones previas de hosting. No se ejecutan tests ni validaciones funcionales sin solicitud expresa.

## Escenarios de aceptación pendientes
Pago individual de horas de octubre tras sueldo; diciembre/enero adelantados con descuento; último parcial cancela cuota sin duplicar ingresos; deuda legítima de otros meses persiste; reportes nuevos conservan título e históricos; repetir solicitudes no duplica cobros. Recuperación de planes sin vínculos requiere revisión administrativa: sigue pendiente y no debe declararse resuelta por habilitar horas extras.


## Cierre de implementación del 12–13 de noviembre de 2026

Se trabajó sobre `15598f5`, conservando las correcciones existentes. No se registraron cobros reales ni se asociaron períodos históricos por suposición.

### Recorrido de usuario

- Caja y Renovaciones usan el mismo formulario. En escritorio, socio, cuenta, medio, importe y resumen están a la izquierda; las cuotas, descuentos y adelantos están a la derecha. En móvil se ordenan socio, conceptos y pago.
- Seleccionar un mes lo agrega al cobro. `Quitar mes` retira un adelanto agregado por error del formulario; no elimina documentos ni deudas. Las cuotas pagadas se muestran sin casilla de cobro.
- `Cobrar total` es la opción inicial. `Registrar abono` permite reducir el importe y muestra el saldo pendiente. `Ajustar saldo` está en opciones avanzadas y exige motivo y confirmación.
- `Revisar cobro` prepara el resumen; `Confirmar operación` registra el movimiento. Durante el envío se bloquean los campos y botones. El comprobante y `Ver movimiento` permanecen visibles al finalizar.
- Una operación demorada conserva clave y contenido en el navegador. `Consultar estado del cobro` consulta el resultado autenticado; `Reintentar el cobro original` usa los datos originales. No se libera la clave ante una respuesta desconocida ni ante un conflicto con un cobro existente.
- Los planes muestran pagos y datos a la izquierda. El movimiento seleccionado aparece a la derecha; inicialmente hay un estado vacío con icono. La barra informa porcentaje, pagado y saldo. Los abonos flexibles pueden anularse: el plan reabre su saldo y reserva nuevamente las cuotas hasta completarse.
- Mis recibos y Bandeja e historial siguen el patrón lista/detalle. No seleccionan automáticamente el primer registro. Se corrigieron separación del contador/importe, botones, foco y contraste de notificaciones.

### Correcciones adicionales encontradas durante las comprobaciones

1. La cotización intentaba volver a emitir cuotas históricas existentes y podía rechazarlas por la fecha de ingreso del socio. Ahora consulta primero los cargos guardados y sólo calcula una emisión nueva si no existen.
2. Los distintos cargos de un mismo mes conservan su identidad: uno pagado no oculta otro pendiente. Se cotizan todos y se deduplican por identificador. Los cargos individuales de otro familiar no alteran el estado del socio.
3. Se eliminaron los cortes silenciosos de 25 cuotas y de 100 recibos. Las consultas de deuda, historial de reportes y recibos recorren sus páginas. Las confirmaciones conservan el máximo técnico de 100 cuotas por operación.
4. Los resúmenes de movimientos y de Caja excluyen los planes principales; sus abonos efectivos se cuentan una sola vez. Original y contraasiento se compensan en balances y reportes.
5. Anular un abono directo conserva los demás pagos y reabre solamente el capital aplicado. En planes flexibles, la cuota vuelve a quedar reservada para su plan. Las lecturas relacionadas se preparan antes de escribir.
6. El cierre recalcula todos los movimientos de la jornada dentro de la transacción. Ya no usa solamente el efectivo esperado al abrir. Se rechazan movimientos para una jornada cerrada.
7. Se usa el cálculo compartido del estado del socio en cobros directos, lotes, planes, conciliación, anulación y emisión mensual. Pagar un mes lejano no cubre meses omitidos; una cuota futura pendiente no constituye deuda exigible hoy.
8. La comisión utilizada por el formulario proviene del servidor. Si cambia antes de confirmar, se rechaza la cotización antes de registrar dinero.
9. Reportes abre el informe generado, actualiza los estados en curso, ignora respuestas de consultas anteriores y conserva el intento durante reintentos y recargas. Un identificador de solicitud queda ligado a nombre y filtros. Se preservan las filas de informes históricos sin bloques y se toleran importes opcionales ausentes sin mostrar `NaN`.
10. Los errores internos se registran con referencia de soporte; la interfaz traduce los errores de negocio y evita códigos técnicos. Se conservaron los permisos de aprobación y pago de horas extras.

### Contratos añadidos y compatibilidad

- `accountingGetOperationStatus({operationKey, kind})`: consulta de personal autorizado, limitada a operaciones del mismo usuario. Devuelve `completed` con comprobante o `unknown`; la ausencia de resultado no significa que sea seguro generar otra operación.
- `accountingPreviewMemberFeePayment`: admite medio de pago opcional y devuelve su comisión vigente junto a los cargos. El cliente consulta períodos en lotes de hasta 100 y conserva las filas durante la recarga.
- La confirmación admite `expectedCommissionPctBps`, además del saldo esperado por cargo. Clientes anteriores pueden omitir los campos nuevos durante la transición.
- Códigos de negocio: `QUOTE_CHANGED`, `ACTIVE_PAYMENT_PLAN`, `OPERATION_ALREADY_RECORDED`, `INTERNAL_ERROR`. Las acciones sugeridas son actualizar cotización, abrir plan o consultar resultado. Los detalles técnicos no se presentan como mensajes al cliente.
- `accountingRecoverMemberFeePlan`: exclusivo de Directivo/Comité Ejecutivo. La vista previa identifica socio, pagos efectivos, cuotas candidatas y cambios. La aplicación exige cuotas elegidas expresamente, motivo, igualdad del capital y revisión vigente. Conserva dinero y fechas de movimientos y registra actor, motivo, estado anterior del plan y valores anteriores/posteriores de cuotas en `accounting_operations`.
- Una asociación de un plan con saldo reserva las cuotas; la cancelación ocurre al completar los abonos. La reparación se rechaza si hay pagos ajenos, documentos ambiguos, una asociación previa auditada o diferencias de capital que requieren revisión individual.

### Inventario histórico y decisión del usuario

La consulta de producción fue de solo lectura. Las dos configuraciones de horas extra ya estaban habilitadas. Se encontraron seis planes sin asociación explícita:

| Plan | Capital | Pagos efectivos | Situación |
|---|---:|---:|---|
| `0xFHM4VbbLyRVs6GoVPM` | $117.000 | $117.000 | Completo, falta identificar cuotas |
| `3w7OOgwcQ41ysCWFEoUf` | $60.000 | $60.000 | Completo, falta identificar cuotas |
| `KP04Z8FMR2FYKNbnl9IN` | $130.000 | $65.000 | Con saldo, falta identificar cuotas |
| `c8Lpbusm7pc5DDmb7ARL` | $117.000 | $117.000 | Completo, falta identificar cuotas |
| `dbdqkBBlU5uqIj6RI2Aj` | $99.000 | $99.000 | Completo, falta identificar cuotas |
| `tj1uSFPkMXNr5ytcnrjF` | $110.000 | $110.000 | Completo, falta identificar cuotas |

El usuario confirmó que no dispone del detalle de períodos y pidió dejarlos funcionales. Se conservan consulta, comprobantes y abonos del plan con saldo; la pantalla advierte que falta la asociación. No se cancelan cuotas por la fecha del movimiento ni se generan ingresos para repararlas. La asociación queda disponible en Cuotas → Sincronización → Asociar cuotas a un plan antiguo.

`scripts/recover-accounting.mjs` genera el inventario con pagos, cuotas candidatas y motivos; `--plan-id=ID` lo acota. `--execute` conserva su alcance anterior: habilitar exclusivamente las configuraciones de horas extras autorizadas si hiciera falta. No aplica asociaciones históricas.

### Evidencia y escenarios

Pruebas dirigidas autorizadas, sin cobros reales. Resultado final de código: 35 pruebas de lógica y 5 de utilidades aprobadas; compilaciones de funciones/web y comprobación de tipos aprobadas:

- Pruebas de lógica: importes, estado familiar, cargos distintos de un mes, cotización vencida, comisión cambiada, plan activo, reintentos, finalización y anulación de abonos, reparación auditada, paginación de 125 recibos y cierres con 225 movimientos.
- Utilidades: decimales `100.50`, `100,50`, `1.500,50`; formatos ambiguos; centavos visibles; mensajes en español; clave y contenido conservados hasta resolver.
- Integración real con Auth, Functions y Firestore emulados: adelantos de diciembre/enero con 10%, un comprobante al reintentar, consulta de resultado, anulación total, abonos intermedio/final, bloqueo por plan, anulación/reposición de abono, deuda legítima, horas de octubre después de un sueldo pagado y reporte con nombre/filtros ligados.
- El reporte de integración con 233 movimientos coincidió con los ingresos, egresos y saldo de los movimientos efectivos. El cierre de la jornada ficticia recalculó los movimientos posteriores a su apertura y resultó sin diferencia.
- Navegador local: consulta de 28 cuotas, selección inicial del mes actual, diciembre/enero conservados con descuento, error dentro del formulario con foco, cobro ficticio con comprobante, distribución horizontal y móvil sin desborde, selección y retiro de un adelanto sin registrar dinero.
- Evidencia visual en `docs/accounting/evidencia/`.

Reproducción aislada: iniciar los emuladores con proyecto `demo-web-golf-palpala`, cargar el usuario administrativo de prueba y el seed contable; ejecutar `scripts/seed-accounting-flow-emulator.mjs` y después los scripts de `scripts/tests/`. Los scripts de integración exigen explícitamente los hosts locales y el proyecto demo. La contraseña de prueba se proporciona mediante `ACCOUNTING_TEST_PASSWORD`. El fixture se prepara antes de una nueva ejecución completa.

Límites: no se indujo un timeout real de navegador ni una carrera entre dos pestañas físicas. Se comprobaron la conservación y reutilización de la operación y la respuesta idempotente del servidor. La anulación de cuotas programadas antiguas conserva su bloqueo y exige revisar el cronograma; la reapertura implementada corresponde a abonos flexibles. Los seis casos históricos no se declaran conciliados sin identificar sus cuotas.

### Publicación y reversión

Versión de hosting previa: `sites/webgolfclub/versions/b6229965befd0b9f`, release del 11/11/2026 a las 21:09:40 UTC. Se conserva en el historial de Firebase para reversión. La publicación debe incluir primero funciones compatibles y después el sitio generado desde este árbol de trabajo. No restaurar pantallas desde `HEAD` sobre archivos nuevos.

Estado de publicación: pendiente de registrar el resultado del despliegue. El cierre de código y de publicación no equivale a haber conciliado los seis casos históricos.
