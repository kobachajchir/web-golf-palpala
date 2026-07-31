import { getVisibleRoleIds, ROLE_LABELS, type RoleType } from '../constants/roles';

export function RoleChipList({
  roleIds,
  emptyLabel = 'Sin roles asignados',
  showInternalRoles = false,
}: {
  roleIds: RoleType[];
  emptyLabel?: string;
  showInternalRoles?: boolean;
}) {
  const visibleRoleIds = getVisibleRoleIds(roleIds, showInternalRoles);

  return (
    <div className="role-chip-list">
      {visibleRoleIds.length > 0 ? (
        visibleRoleIds.map((roleId) => (
          <span key={roleId} className="role-chip-list__item">
            {ROLE_LABELS[roleId] ?? roleId}
          </span>
        ))
      ) : (
        <span className="role-chip-list__item role-chip-list__item--empty">{emptyLabel}</span>
      )}
    </div>
  );
}