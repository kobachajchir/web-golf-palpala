import { ROLE_LABELS, type RoleType } from '../constants/roles';

export function RoleChipList({
  roleIds,
  emptyLabel = 'Sin roles asignados',
}: {
  roleIds: RoleType[];
  emptyLabel?: string;
}) {
  return (
    <div className="role-chip-list">
      {roleIds.length > 0 ? (
        roleIds.map((roleId) => (
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
