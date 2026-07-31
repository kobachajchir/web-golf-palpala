import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { CompactDetailsToggle } from '../../../components/CompactDetailsToggle';
import { DescriptionList } from '../../../components/DescriptionList';
import { IconActionMenu } from '../../../components/IconActionMenu';
import { PersonProfileHeader } from '../../../components/PersonProfileHeader';
import { RoleChipList } from '../../../components/RoleChipList';
import { ROLES } from '../../../constants/roles';

test('perfil de persona expone resumen visual y detalles colapsados', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <PersonProfileHeader
        eyebrow="Perfil de membresia"
        title="Ana Socia"
        avatarLabel="Ana Socia"
        subtitle={<span>Socio #15 | Pleno</span>}
        badges={<span className="status-pill">Activo</span>}
      />
      <CompactDetailsToggle>
        <DescriptionList items={[{ label: 'ID interno', value: 'member-15' }]} />
      </CompactDetailsToggle>
    </MemoryRouter>,
  );

  assert.match(html, /person-profile-header/);
  assert.match(html, /Ana Socia/);
  assert.match(html, /Mas detalles/);
  assert.doesNotMatch(html, /member-15/);
});

test('roles se muestran como chips y las acciones usan icon buttons cuadrados', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <RoleChipList roleIds={[ROLES.SOCIO, ROLES.COMISION_DIRECTIVA]} />
      <IconActionMenu
        label="Agregar rol"
        icon={<span>+</span>}
        open
        items={[
          {
            id: ROLES.COMITE_EJECUTIVO,
            label: 'Comite Ejecutivo',
            onSelect: () => undefined,
          },
        ]}
        onToggle={() => undefined}
      />
    </MemoryRouter>,
  );

  assert.match(html, /role-chip-list__item/);
  assert.match(html, /member-icon-button/);
  assert.match(html, /member-actions-menu/);
  assert.match(html, /Comite Ejecutivo/);
});

test('el rol desarrollador queda oculto salvo para su propia vista interna', () => {
  const hiddenHtml = renderToStaticMarkup(
    <RoleChipList roleIds={[ROLES.SOCIO, ROLES.DESARROLLADOR]} />,
  );
  const privateHtml = renderToStaticMarkup(
    <RoleChipList roleIds={[ROLES.SOCIO, ROLES.DESARROLLADOR]} showInternalRoles />,
  );

  assert.doesNotMatch(hiddenHtml, /Desarrollador/);
  assert.match(privateHtml, /Desarrollador/);
});
