import { Timestamp } from 'firebase-admin/firestore';
import { assertCondition } from '../../domain/errors.js';
import type {
  Actor,
  EntityWithId,
  FeePreview,
  FinancialConfigDocument,
  MemberFeeChargeStatus,
  ReferencedMemberDocument,
} from '../../domain/models.js';
import type { AccountingDataAccess, AccountingTransactionManager } from '../../domain/ports.js';
import {
  assertIsRecord,
  buildFeePreview,
  ensureMemberCanBeBilled,
  ensureStaff,
  parseOptionalAccountingPeriod,
  parseOptionalIsoDate,
  parseOptionalNullableString,
  parseRequiredAccountingPeriod,
  parseRequiredString,
  validateLicenseRange,
} from '../shared.js';

export interface GenerateFeePreviewInput {
  memberId: string;
  period: string;
  forceAdministrativeExceptionReason?: string | null | undefined;
}

export interface GenerateCuotaInput extends GenerateFeePreviewInput {
  dueDate?: Date | undefined;
  notes?: string | null | undefined;
}

async function validateLicenseIfNeeded(
  member: EntityWithId<ReferencedMemberDocument>,
  config: EntityWithId<FinancialConfigDocument>,
): Promise<void> {
  const isLicense = member.typeCodeSnapshot === 'licencia' || member.status === 'license';
  if (!isLicense) {
    return;
  }

  assertCondition(member.licenseStartAt, 'failed-precondition', 'La licencia debe tener licenseStartAt.');
  assertCondition(member.licenseEndAt, 'failed-precondition', 'La licencia debe tener licenseEndAt.');
  validateLicenseRange(member.licenseStartAt.toDate(), member.licenseEndAt.toDate(), config.maxLicenseMonths);
}

async function buildPreviewForSingleMember(params: {
  dataAccess: AccountingDataAccess;
  member: EntityWithId<ReferencedMemberDocument>;
  period: string;
  forceAdministrativeExceptionReason?: string | null | undefined;
}): Promise<FeePreview> {
  const config = await params.dataAccess.financialConfigs.getActive();
  assertCondition(config, 'failed-precondition', 'No existe una configuración financiera activa.');

  if (params.member.membershipBillingExempt) {
    const preview = buildFeePreview({
      member: params.member,
      config,
      period: params.period,
    });
    return {
      ...preview,
      finalAmountMinor: 0,
      appliedPctBps: 0,
      explanation: [
        ...preview.explanation,
        `Exento de facturacion societaria${params.member.membershipBillingExemptReason ? `: ${params.member.membershipBillingExemptReason}` : '.'}`,
      ],
    };
  }

  ensureMemberCanBeBilled({
    member: params.member,
    config,
    forceAdministrativeExceptionReason: params.forceAdministrativeExceptionReason,
  });
  await validateLicenseIfNeeded(params.member, config);

  return buildFeePreview({
    member: params.member,
    config,
    period: params.period,
  });
}

export async function computeFeePreviewInternal(params: {
  dataAccess: AccountingDataAccess;
  memberId: string;
  period: string;
  forceAdministrativeExceptionReason?: string | null | undefined;
}): Promise<FeePreview> {
  const member = await params.dataAccess.members.getById(params.memberId);
  assertCondition(member, 'not-found', `No existe members/${params.memberId}.`);

  const preview = await buildPreviewForSingleMember({
    dataAccess: params.dataAccess,
    member,
    period: params.period,
    forceAdministrativeExceptionReason: params.forceAdministrativeExceptionReason,
  });

  if (preview.billingMode !== 'single_group_charge' || !member.familyGroupId) {
    return preview;
  }

  const familyGroup = await params.dataAccess.familyGroups.getById(member.familyGroupId);
  assertCondition(familyGroup, 'not-found', `No existe family_groups/${member.familyGroupId}.`);
  assertCondition(familyGroup.memberIds.length > 0, 'failed-precondition', 'El grupo familiar no tiene integrantes.');

  const memberPreviews = await Promise.all(
    familyGroup.memberIds.map(async (memberId) => {
      const familyMember = await params.dataAccess.members.getById(memberId);
      assertCondition(familyMember, 'not-found', `No existe members/${memberId}.`);
      return buildPreviewForSingleMember({
        dataAccess: params.dataAccess,
        member: familyMember,
        period: params.period,
        forceAdministrativeExceptionReason: params.forceAdministrativeExceptionReason,
      });
    }),
  );

  const finalAmountMinor = memberPreviews.reduce((total, item) => total + item.finalAmountMinor, 0);
  const explanation = [
    ...preview.explanation,
    `Modo single_group_charge: consolidado de ${memberPreviews.length} integrantes.`,
  ];

  return {
    ...preview,
    finalAmountMinor,
    holderMemberId: familyGroup.holderMemberId,
    familyGroupId: familyGroup.id,
    explanation,
  };
}

function resolveChargeStatus(preview: FeePreview): MemberFeeChargeStatus {
  return preview.finalAmountMinor === 0 ? 'exempt' : 'pending';
}

export function buildMemberFeeChargeCreateData(params: {
  preview: FeePreview;
  actorUid: string;
  dueDate?: Date | null | undefined;
  notes?: string | null | undefined;
}) {
  const status = resolveChargeStatus(params.preview);
  return {
    memberId: params.preview.billingMode === 'single_group_charge'
      ? params.preview.holderMemberId ?? params.preview.memberId
      : params.preview.memberId,
    familyGroupId: params.preview.familyGroupId ?? null,
    holderMemberId: params.preview.holderMemberId ?? null,
    period: params.preview.period,
    configVersion: params.preview.configVersion,
    memberTypeCodeSnapshot: params.preview.memberTypeCodeSnapshot,
    billingMode: params.preview.billingMode,
    baseAmountMinor: params.preview.baseAmountMinor,
    appliedPctBps: params.preview.appliedPctBps,
    finalAmountMinor: params.preview.finalAmountMinor,
    status,
    dueDate: params.dueDate ? Timestamp.fromDate(params.dueDate) : null,
    generatedByUid: params.actorUid,
    paidMovementId: null,
    paymentMovementIds: [],
    paidAt: null,
    paidAmountMinor: 0,
    settlementAmountMinor: params.preview.finalAmountMinor,
    paidClubAmountMinor: 0,
    remainingAmountMinor: params.preview.finalAmountMinor,
    paymentDiscountPctBps: 0,
    paymentDiscountAmountMinor: 0,
    paymentDiscountMode: 'none' as const,
    notes: params.notes ?? null,
  };
}

export async function generateFeePreviewUseCase(params: {
  actor: Actor | null;
  input: GenerateFeePreviewInput;
  transactions: AccountingTransactionManager;
}): Promise<FeePreview> {
  ensureStaff(params.actor);
  return computeFeePreviewInternal({
    dataAccess: params.transactions.getDataAccess(),
    memberId: params.input.memberId,
    period: params.input.period,
    forceAdministrativeExceptionReason: params.input.forceAdministrativeExceptionReason,
  });
}

export async function generateCuotaUseCase(params: {
  actor: Actor | null;
  input: GenerateCuotaInput;
  transactions: AccountingTransactionManager;
}): Promise<{ memberFeeChargeId: string; status: MemberFeeChargeStatus; duplicate: boolean }> {
  const actor = ensureStaff(params.actor);

  return params.transactions.runInTransaction(async (dataAccess) => {
    const preview = await computeFeePreviewInternal({
      dataAccess,
      memberId: params.input.memberId,
      period: params.input.period,
      forceAdministrativeExceptionReason: params.input.forceAdministrativeExceptionReason,
    });

    const duplicate = await dataAccess.memberFeeCharges.findDuplicate({
      memberId: preview.billingMode === 'per_member' ? preview.memberId : preview.holderMemberId ?? null,
      familyGroupId: preview.billingMode === 'single_group_charge' ? preview.familyGroupId ?? null : null,
      period: preview.period,
      billingMode: preview.billingMode,
    });

    if (duplicate) {
      return {
        memberFeeChargeId: duplicate.id,
        status: duplicate.status,
        duplicate: true,
      };
    }

    const chargeData = buildMemberFeeChargeCreateData({
      preview,
      actorUid: actor.uid,
      dueDate: params.input.dueDate,
      notes: params.input.notes,
    });
    const memberFeeChargeId = await dataAccess.memberFeeCharges.create(
      chargeData,
      actor.uid,
    );

    return {
      memberFeeChargeId,
      status: chargeData.status,
      duplicate: false,
    };
  });
}

export function parseGenerateFeePreviewInput(payload: unknown): GenerateFeePreviewInput {
  const data = assertIsRecord(payload);

  return {
    memberId: parseRequiredString(data, 'memberId'),
    period: parseRequiredAccountingPeriod(data, 'period'),
    forceAdministrativeExceptionReason: parseOptionalNullableString(data, 'forceAdministrativeExceptionReason'),
  };
}

export function parseGenerateCuotaInput(payload: unknown): GenerateCuotaInput {
  const data = assertIsRecord(payload);

  return {
    memberId: parseRequiredString(data, 'memberId'),
    period: parseOptionalAccountingPeriod(data, 'period') ?? parseRequiredAccountingPeriod(data, 'period'),
    forceAdministrativeExceptionReason: parseOptionalNullableString(data, 'forceAdministrativeExceptionReason'),
    dueDate: parseOptionalIsoDate(data, 'dueDate'),
    notes: parseOptionalNullableString(data, 'notes'),
  };
}
