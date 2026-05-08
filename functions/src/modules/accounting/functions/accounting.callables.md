# ACCOUNTING Callables

## `accounting.upsertFinancialConfig`
Genera una nueva versión de `financial_configs`, desactiva la activa anterior y conserva histórico.

Payload ejemplo:
```json
{
  "fullMemberFeeMinor": 11000000,
  "familyAssociatePctBps": 5000,
  "lifetimePctBps": 5000,
  "minorPctBps": 3000,
  "licensePctBps": 0,
  "maxLicenseMonths": 6,
  "creditCommissionPctBps": 300,
  "familyGroupBillingMode": "per_member",
  "allowStandaloneMinor": true,
  "membershipChargePersistenceMode": "member_fee_charges",
  "greenFeeAppliesToMembers": true,
  "cantineroContractMode": "fixed_monthly",
  "advertisingDefaultPeriodicity": "monthly",
  "requireApprovalForExpensePosting": true,
  "requireApprovalForOvertimePosting": true,
  "notes": "Actualización abril 2026"
}
```

## `accounting.setCreditCommissionRule`
Versiona la comisión activa para pagos con tarjeta de crédito.

Payload ejemplo:
```json
{
  "percentageBps": 300,
  "validFrom": "2026-04-24T00:00:00.000Z",
  "notes": "Comisión inicial"
}
```

## `accounting.generateFeePreview`
Calcula la cuota sin generar deuda ni movimiento.

Payload ejemplo:
```json
{
  "memberId": "member-123",
  "period": "2026-04"
}
```

## `accounting.generateCuota`
Crea `member_fee_charges`, evita duplicados y deja la cuota pendiente o exenta.

Payload ejemplo:
```json
{
  "memberId": "member-123",
  "period": "2026-04",
  "dueDate": "2026-04-10T00:00:00.000Z",
  "notes": "Emisión mensual"
}
```

## `accounting.registerPayment`
Registra ingresos reales en `financial_movements` y sincroniza cuota o handicap si corresponde.

Payload ejemplo:
```json
{
  "sourceType": "member_fee_charge",
  "sourceId": "fee-charge-123",
  "memberId": "member-123",
  "categoryId": "cuota_societaria",
  "paymentMethodId": "credit",
  "grossAmountMinor": 5500000,
  "operationDate": "2026-04-24T12:00:00.000Z",
  "notes": "Pago de cuota abril",
  "metadata": {
    "cashierDesk": "recepcion"
  }
}
```

## `accounting.createMacroDebitSettlement`
Importa una liquidación de Débito Macro y vincula sus movimientos.

Payload ejemplo:
```json
{
  "month": "2026-04",
  "externalBatchRef": "macro-2026-04-lote-001",
  "movementIds": ["mov-1", "mov-2"],
  "accreditedAt": "2026-04-24T00:00:00.000Z",
  "bankName": "Banco Macro",
  "commissionAmountMinor": 15000
}
```

## `accounting.reconcileMacroSettlement`
Recalcula y valida una liquidación importada.

Payload ejemplo:
```json
{
  "settlementId": "settlement-123",
  "expectedGrossAmountMinor": 1000000,
  "expectedCommissionAmountMinor": 15000,
  "expectedNetAmountMinor": 985000,
  "close": true
}
```

## `accounting.submitExpense`
Carga una rendición de gasto operativa.

Payload ejemplo:
```json
{
  "employeeId": "employee-123",
  "categoryId": "combustible",
  "description": "Carga de tractor",
  "expenseDate": "2026-04-22T00:00:00.000Z",
  "amountMinor": 450000,
  "liters": 35,
  "vendorName": "YPF"
}
```

## `accounting.reviewExpense`
Aprueba o rechaza una rendición cargada.

Payload ejemplo:
```json
{
  "expenseSubmissionId": "expense-123",
  "decision": "approved"
}
```

## `accounting.postExpenseMovement`
Convierte una rendición aprobada en `financial_movement`.

Payload ejemplo:
```json
{
  "expenseSubmissionId": "expense-123",
  "notes": "Pago operativo"
}
```

## `accounting.upsertSalaryConfiguration`
Versiona la configuración salarial de un empleado sin tocar `employees`.

Payload ejemplo:
```json
{
  "employeeId": "employee-123",
  "contractType": "monthly",
  "baseAmountMinor": 25000000,
  "periodicity": "monthly",
  "effectiveFrom": "2026-04-01T00:00:00.000Z",
  "allowOvertime": true
}
```

## `accounting.postSalaryPayment`
Postea el pago salarial y genera uno o más movimientos contables.

Payload ejemplo:
```json
{
  "employeeId": "employee-123",
  "period": "2026-04",
  "salaryGrossMinor": 25000000,
  "bankedAmountMinor": 24000000,
  "nonBankedAmountMinor": 1000000,
  "overtimeHours": 6,
  "overtimeAmountMinor": 1800000
}
```

## `accounting.recordExternalReference`
Registra F931, obra social, ART u otras referencias externas sin cálculo interno.

Payload ejemplo:
```json
{
  "referenceType": "F931",
  "period": "2026-04",
  "amountMinor": 3300000,
  "referenceNumber": "F931-2026-04"
}
```

## `accounting.createHandicapCharge`
Crea el cargo de handicap y opcionalmente lo cobra en el mismo acto.

Payload ejemplo:
```json
{
  "memberId": "member-123",
  "period": "2026-04",
  "collectionAmountMinor": 120000,
  "transferAmountMinor": 120000,
  "associationName": "AAG",
  "collectNow": true,
  "paymentMethodId": "transfer"
}
```

## `accounting.transferHandicapToAssociation`
Registra el egreso del handicap hacia la asociación.

Payload ejemplo:
```json
{
  "handicapChargeId": "handicap-charge-123",
  "paymentMethodId": "transfer",
  "notes": "Transferencia AAG"
}
```

## `accounting.voidFinancialMovement`
Anula un movimiento y crea reverso si ya estaba `posted`.

Payload ejemplo:
```json
{
  "movementId": "movement-123",
  "reason": "Cobro cargado por duplicado"
}
```
