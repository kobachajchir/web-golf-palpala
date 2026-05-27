import { useMemo, useState } from 'react';
import type { EntityWithId, MemberDocument } from '../../../modules/users/domain/models';
import { getPersonDisplayName } from '../utils/accountingFormatters';

export function MemberSearchPanel({
  members,
  selectedMemberId,
  onSelectMember,
  loading,
}: {
  members: Array<EntityWithId<MemberDocument>>;
  selectedMemberId: string;
  onSelectMember: (memberId: string) => void;
  loading?: boolean;
}) {
  const [query, setQuery] = useState('');
  const visibleMembers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return members.slice(0, 40);
    }

    return members
      .filter((member) =>
        [member.memberNumber, member.firstName, member.lastName, member.dni]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedQuery)),
      )
      .slice(0, 60);
  }, [members, query]);

  return (
    <section className="floating-card accounting-panel accounting-member-search">
      <div className="accounting-section-header">
        <div>
          <p className="eyebrow">Socio</p>
          <h2>Buscar y seleccionar</h2>
        </div>
      </div>
      <label className="form-field">
        <span>Busqueda</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Numero, apellido, DNI"
        />
      </label>
      <div className="accounting-list accounting-member-results">
        {loading && <div className="empty-state empty-state--inline">Cargando socios...</div>}
        {!loading && visibleMembers.map((member) => (
          <button
            key={member.id}
            type="button"
            className={`accounting-row accounting-row--button ${selectedMemberId === member.id ? 'accounting-row--selected' : ''}`}
            onClick={() => onSelectMember(member.id)}
          >
            <span className="accounting-row__main">
              <strong>{getPersonDisplayName(member)}</strong>
              <small>Socio {member.memberNumber} - {member.status}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
