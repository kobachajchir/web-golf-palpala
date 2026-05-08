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

async function computeFeePreviewInternal(params: {
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

    const status = resolveChargeStatus(preview);
    const memberFeeChargeId = await dataAccess.memberFeeCharges.create(
      {
        memberId: preview.billingMode === 'single_group_charge' ? preview.holderMemberId ?? preview.memberId : preview.memberId,
        familyGroupId: preview.familyGroupId ?? null,
        holderMemberId: preview.holderMemberId ?? null,
        period: preview.period,
        configVersion: preview.configVersion,
        memberTypeCodeSnapshot: preview.memberTypeCodeSnapshot,
        billingMode: preview.billingMode,
        baseAmountMinor: preview.baseAmountMinor,
        appliedPctBps: preview.appliedPctBps,
        finalAmountMinor: preview.finalAmountMinor,
        status,
        dueDate: params.input.dueDate ? Timestamp.fromDate(params.input.dueDate) : null,
        generatedByUid: actor.uid,
        paidMovementId: null,
        notes: params.input.notes ?? null,
      },
      actor.uid,
    );

    return {
      memberFeeChargeId,
      status,
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
