import { Timestamp } from 'firebase-admin/firestore';
import { FINANCIAL_INCOME_CATEGORY_IDS, PAYMENT_METHOD_IDS } from '../../domain/constants.js';
import { assertCondition } from '../../domain/errors.js';
import type { Actor, ThirdPartyType } from '../../domain/models.js';
import type { AccountingTransactionManager } from '../../domain/ports.js';
import {
  assertIsRecord,
  calculateEarlyPaymentDiscount,
  calculateMembershipRenewalDueDate,
  ensureStaff,
  parseOptionalAmountMinor,
  parseOptionalIsoDate,
  parseOptionalNullableString,
  parseOptionalRecord,
  parseRequiredAmountMinor,
  parseRequiredIsoDate,
  parseRequiredString,
  toClubAccountingPeriod,
} from '../shared.js';
import { createPostedMovement } from '../movement-helpers.js';

export interface RegisterPaymentInput {
  sourceType: string;
  sourceId?: string | null | undefined;
  memberId?: string | null | undefined;
  thirdPartyType?: ThirdPartyType | null | undefined;
  thirdPartyId?: string | null | undefined;
  categoryId: string;
  paymentMethodId: string;
  paymentReference?: string | null | undefined;
  grossAmountMinor: number;
  operationDate: Date;
  notes?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

function buildReceiptNumber(operationDate: Date, movementId: string): string {
  const year = operationDate.getUTCFullYear();
  const month = String(operationDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(operationDate.getUTCDate()).padStart(2, '0');
  return `REC-${year}${month}${day}-${movementId.slice(0, 8).toUpperCase()}`;
}

function getReceiptNumberFromMovementMetadata(metadata: Record<string, unknown> | undefined): string | null {
  const receiptNumber = metadata?.receiptNumber;
  return typeof receiptNumber === 'string' && receiptNumber.trim().length > 0 ? receiptNumber : null;
}

export async function registerPaymentUseCase(params: {
  actor: Actor | null;
  input: RegisterPaymentInput;
  transactions: AccountingTransactionManager;
}): Promise<{ movementId: string; netAmountMinor: number; duplicate: boolean; receiptNumber: string | null }> {
  const actor = ensureStaff(params.actor);

  return params.transactions.runInTransaction(async (dataAccess) => {
    const category = await dataAccess.financialIncomeCategories.getById(params.input.categoryId);
    assertCondition(category, 'not-found', `No existe financial_income_categories/${params.input.categoryId}.`);
    assertCondition(category.active, 'failed-precondition', `La categoría ${params.input.categoryId} está inactiva.`);

    const paymentMethod = await dataAccess.paymentMethods.getById(params.input.paymentMethodId);
    assertCondition(paymentMethod, 'not-found', `No existe payment_methods/${params.input.paymentMethodId}.`);
    assertCondition(paymentMethod.active, 'failed-precondition', `El medio de pago ${params.input.paymentMethodId} está inactivo.`);
    const paymentReference = params.input.paymentReference?.trim() || null;
    const paymentReferenceRequired =
      params.input.sourceType !== 'manual_income' && paymentMethod.id !== PAYMENT_METHOD_IDS.cash;
    assertCondition(
      !paymentReferenceRequired || Boolean(paymentReference),
      'invalid-argument',
      'La referencia de pago es obligatoria para medios distintos de efectivo.',
    );

    if (params.input.memberId) {
      const member = await dataAccess.members.getById(params.input.memberId);
      assertCondition(member, 'not-found', `No existe members/${params.input.memberId}.`);
      assertCondition(
        member.status !== 'inactive' && member.status !== 'suspended',
        'failed-precondition',
        'No se pueden registrar pagos nuevos para socios dados de baja o suspendidos.',
      );
    }

    let memberFeeChargeToPay: Awaited<ReturnType<typeof dataAccess.memberFeeCharges.getById>> = null;
    let feePaymentSnapshot: {
      paidAmountMinor: number;
      discountPctBps: number;
      discountAmountMinor: number;
      qualifies: boolean;
    } | null = null;
    let feePaymentAccountingPeriod: string | null = null;
    let isFeePaymentOutsidePeriod = false;

    if (params.input.sourceType === 'member_fee_charge') {
      assertCondition(params.input.sourceId, 'invalid-argument', 'sourceId es obligatorio para member_fee_charge.');
      const memberFeeCharge = await dataAccess.memberFeeCharges.getById(params.input.sourceId);
      assertCondition(memberFeeCharge, 'not-found', `No existe member_fee_charges/${params.input.sourceId}.`);
      memberFeeChargeToPay = memberFeeCharge;

      if (memberFeeCharge.status === 'paid' && memberFeeCharge.paidMovementId) {
        const existingMovement = await dataAccess.financialMovements.getById(memberFeeCharge.paidMovementId);
        assertCondition(existingMovement, 'failed-precondition', 'La cuota ya fue pagada y el movimiento vinculado no existe.');
        return {
          movementId: existingMovement.id,
          netAmountMinor: existingMovement.netAmountMinor,
          duplicate: true,
          receiptNumber: getReceiptNumberFromMovementMetadata(existingMovement.metadata),
        };
      }

      assertCondition(
        memberFeeCharge.status === 'pending' || memberFeeCharge.status === 'overdue',
        'failed-precondition',
        'Solo se pueden cobrar cuotas pendientes o vencidas.',
      );

      const chargeMemberId = memberFeeCharge.memberId ?? memberFeeCharge.holderMemberId ?? null;
      assertCondition(chargeMemberId, 'failed-precondition', 'La cuota no tiene socio asociado para validar el cobro.');
      const chargeMember = await dataAccess.members.getById(chargeMemberId);
      assertCondition(chargeMember, 'not-found', `No existe members/${chargeMemberId}.`);
      assertCondition(
        chargeMember.status !== 'inactive' && chargeMember.status !== 'suspended',
        'failed-precondition',
        'No se pueden cobrar cuotas de socios dados de baja o suspendidos.',
      );

      const activeConfig = await dataAccess.financialConfigs.getActive();
      assertCondition(activeConfig, 'failed-precondition', 'No existe una configuración financiera activa.');
      feePaymentAccountingPeriod = toClubAccountingPeriod(params.input.operationDate);
      isFeePaymentOutsidePeriod = feePaymentAccountingPeriod !== memberFeeCharge.period;
      feePaymentSnapshot = calculateEarlyPaymentDiscount({
        chargeAmountMinor: memberFeeCharge.finalAmountMinor,
        config: activeConfig,
        chargePeriod: memberFeeCharge.period,
        operationDate: params.input.operationDate,
      });
    }

    let handicapChargeId: string | null = null;
    if (params.input.sourceType === 'handicap' && params.input.sourceId) {
      const handicapCharge = await dataAccess.handicapCharges.getById(params.input.sourceId);
      assertCondition(handicapCharge, 'not-found', `No existe handicap_charges/${params.input.sourceId}.`);
      if (handicapCharge.incomeMovementId) {
        const existingMovement = await dataAccess.financialMovements.getById(handicapCharge.incomeMovementId);
        if (existingMovement) {
          return {
            movementId: existingMovement.id,
            netAmountMinor: existingMovement.netAmountMinor,
            duplicate: true,
            receiptNumber: getReceiptNumberFromMovementMetadata(existingMovement.metadata),
          };
        }
      }
      handicapChargeId = handicapCharge.id;
    }

    if (params.input.sourceType === 'handicap' && !params.input.sourceId) {
      const metadata = params.input.metadata ?? {};
      const period = typeof metadata.period === 'string' ? metadata.period : null;
      const associationName = typeof metadata.associationName === 'string' ? metadata.associationName : null;
      const transferAmountMinor = typeof metadata.transferAmountMinor === 'number' ? metadata.transferAmountMinor : params.input.grossAmountMinor;
      assertCondition(params.input.memberId, 'invalid-argument', 'memberId es obligatorio para crear handicap_charges al cobrar handicap.');
      assertCondition(period, 'invalid-argument', 'metadata.period es obligatorio para crear handicap_charges.');
      assertCondition(associationName, 'invalid-argument', 'metadata.associationName es obligatorio para crear handicap_charges.');

      const existingCharge = await dataAccess.handicapCharges.findByMemberAndPeriod(params.input.memberId, period);
      if (existingCharge?.incomeMovementId) {
        const existingMovement = await dataAccess.financialMovements.getById(existingCharge.incomeMovementId);
        if (existingMovement) {
          return {
            movementId: existingMovement.id,
            netAmountMinor: existingMovement.netAmountMinor,
            duplicate: true,
            receiptNumber: getReceiptNumberFromMovementMetadata(existingMovement.metadata),
          };
        }
      }

      handicapChargeId = existingCharge?.id
        ?? await dataAccess.handicapCharges.create(
          {
            memberId: params.input.memberId,
            handicapId: typeof metadata.handicapId === 'string' ? metadata.handicapId : null,
            period,
            collectionAmountMinor: params.input.grossAmountMinor,
            transferAmountMinor,
            associationName,
            incomeMovementId: null,
            expenseMovementId: null,
            status: 'pending_collection',
            transferDueDate: null,
            notes: params.input.notes ?? null,
          },
          actor.uid,
        );
    }

    const feeMemberId = memberFeeChargeToPay?.memberId ?? memberFeeChargeToPay?.holderMemberId ?? null;
    const resolvedMemberId = feeMemberId ?? params.input.memberId ?? null;
    const thirdPartyType = params.input.thirdPartyType
      ?? (resolvedMemberId ? 'member' : null);
    const thirdPartyId = params.input.thirdPartyId
      ?? resolvedMemberId
      ?? null;
    const effectiveGrossAmountMinor = feePaymentSnapshot?.paidAmountMinor ?? params.input.grossAmountMinor;

    const movement = await createPostedMovement({
      dataAccess,
      actorUid: actor.uid,
      movementType: 'income',
      categoryId: category.id,
      categoryCodeSnapshot: category.id,
      grossAmountMinor: effectiveGrossAmountMinor,
      operationDate: params.input.operationDate,
      originType: params.input.sourceType,
      originCollection:
        params.input.sourceType === 'member_fee_charge'
          ? 'member_fee_charges'
          : params.input.sourceType === 'handicap'
            ? 'handicap_charges'
            : null,
      originId: params.input.sourceId ?? handicapChargeId,
      thirdPartyType,
      thirdPartyId,
      paymentMethodId: paymentMethod.id,
      bancarizado: paymentMethod.bancarizado,
      imputableImpositivo: true,
      metadata: {
        ...(params.input.metadata ?? {}),
        ...(paymentReference ? { paymentReference } : {}),
        specialReportingType: paymentMethod.specialReportingType ?? null,
        ...(feePaymentSnapshot
          ? {
              originalFeeAmountMinor: memberFeeChargeToPay?.finalAmountMinor ?? params.input.grossAmountMinor,
              earlyPaymentDiscountPctBps: feePaymentSnapshot.discountPctBps,
              earlyPaymentDiscountAmountMinor: feePaymentSnapshot.discountAmountMinor,
              paidWithinEarlyPaymentWindow: feePaymentSnapshot.qualifies,
              feeChargePeriod: memberFeeChargeToPay?.period ?? null,
              feePaymentAccountingPeriod,
              isFeePaymentOutsidePeriod,
            }
          : {}),
      },
      notes: params.input.notes ?? null,
      applyPaymentCommission: paymentMethod.id === 'credit',
    });
    const receiptNumber = buildReceiptNumber(params.input.operationDate, movement.movementId);
    await dataAccess.financialMovements.update(
      movement.movementId,
      {
        metadata: {
          ...(params.input.metadata ?? {}),
          ...(paymentReference ? { paymentReference } : {}),
          receiptNumber,
          receiptIssuedAt: Timestamp.fromDate(params.input.operationDate),
          receiptSource: params.input.sourceType,
          specialReportingType: paymentMethod.specialReportingType ?? null,
          ...(feePaymentSnapshot
            ? {
                originalFeeAmountMinor: memberFeeChargeToPay?.finalAmountMinor ?? params.input.grossAmountMinor,
                earlyPaymentDiscountPctBps: feePaymentSnapshot.discountPctBps,
                earlyPaymentDiscountAmountMinor: feePaymentSnapshot.discountAmountMinor,
                paidWithinEarlyPaymentWindow: feePaymentSnapshot.qualifies,
                feeChargePeriod: memberFeeChargeToPay?.period ?? null,
                feePaymentAccountingPeriod,
                isFeePaymentOutsidePeriod,
              }
            : {}),
        },
      },
      actor.uid,
    );

    if (params.input.sourceType === 'member_fee_charge' && params.input.sourceId) {
      await dataAccess.memberFeeCharges.update(
        params.input.sourceId,
        {
          status: 'paid',
          paidMovementId: movement.movementId,
          paidAt: Timestamp.fromDate(params.input.operationDate),
          paidAmountMinor: effectiveGrossAmountMinor,
          paymentDiscountPctBps: feePaymentSnapshot?.discountPctBps ?? 0,
          paymentDiscountAmountMinor: feePaymentSnapshot?.discountAmountMinor ?? 0,
        },
        actor.uid,
      );

      const memberIdToUpdate = feeMemberId;
      if (memberIdToUpdate) {
        await dataAccess.members.update(
          memberIdToUpdate,
          {
            lastFeePaymentAt: Timestamp.fromDate(params.input.operationDate),
            membershipRenewalDueAt: Timestamp.fromDate(calculateMembershipRenewalDueDate(params.input.operationDate)),
            membershipRenewalStatus: 'current',
            lastFeePaidAmountMinor: effectiveGrossAmountMinor,
            lastFeeDiscountPctBps: feePaymentSnapshot?.discountPctBps ?? 0,
            lastFeeDiscountAmountMinor: feePaymentSnapshot?.discountAmountMinor ?? 0,
          },
          actor.uid,
        );
      }
    }

    if (handicapChargeId) {
      await dataAccess.handicapCharges.update(
        handicapChargeId,
        {
          collectionAmountMinor: params.input.grossAmountMinor,
          incomeMovementId: movement.movementId,
          status: 'collected',
        },
        actor.uid,
      );
    }

    if (params.input.sourceType === 'member_fee_charge' && category.id !== FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria) {
      await dataAccess.financialMovements.update(
        movement.movementId,
        {
          metadata: {
            ...(params.input.metadata ?? {}),
            ...(paymentReference ? { paymentReference } : {}),
            receiptNumber,
            receiptIssuedAt: Timestamp.fromDate(params.input.operationDate),
            receiptSource: params.input.sourceType,
            specialReportingType: paymentMethod.specialReportingType ?? null,
            ...(feePaymentSnapshot
              ? {
                  originalFeeAmountMinor: memberFeeChargeToPay?.finalAmountMinor ?? params.input.grossAmountMinor,
                  earlyPaymentDiscountPctBps: feePaymentSnapshot.discountPctBps,
                  earlyPaymentDiscountAmountMinor: feePaymentSnapshot.discountAmountMinor,
                  paidWithinEarlyPaymentWindow: feePaymentSnapshot.qualifies,
                  feeChargePeriod: memberFeeChargeToPay?.period ?? null,
                  feePaymentAccountingPeriod,
                  isFeePaymentOutsidePeriod,
                }
              : {}),
            warning: 'El cobro de cuota se registró con una categoría distinta de cuota_societaria.',
          },
        },
        actor.uid,
      );
    }

    return {
      movementId: movement.movementId,
      netAmountMinor: movement.netAmountMinor,
      duplicate: false,
      receiptNumber,
    };
  });
}

export function parseRegisterPaymentInput(payload: unknown): RegisterPaymentInput {
  const data = assertIsRecord(payload);

  return {
    sourceType: parseRequiredString(data, 'sourceType'),
    sourceId: parseOptionalNullableString(data, 'sourceId'),
    memberId: parseOptionalNullableString(data, 'memberId'),
    thirdPartyType: parseOptionalNullableString(data, 'thirdPartyType') as ThirdPartyType | null | undefined,
    thirdPartyId: parseOptionalNullableString(data, 'thirdPartyId'),
    categoryId: parseRequiredString(data, 'categoryId'),
    paymentMethodId: parseRequiredString(data, 'paymentMethodId'),
    paymentReference: parseOptionalNullableString(data, 'paymentReference'),
    grossAmountMinor: parseRequiredAmountMinor(data, 'grossAmountMinor'),
    operationDate: parseOptionalIsoDate(data, 'operationDate') ?? parseRequiredIsoDate(data, 'operationDate'),
    notes: parseOptionalNullableString(data, 'notes'),
    metadata: parseOptionalRecord(data, 'metadata'),
  };
}
