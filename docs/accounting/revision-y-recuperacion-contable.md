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
