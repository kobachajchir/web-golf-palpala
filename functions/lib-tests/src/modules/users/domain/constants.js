export const USERS_COLLECTIONS = {
    users: 'users',
    roles: 'roles',
    permissions: 'permissions',
    rolePermissions: 'role_permissions',
    memberTypes: 'member_types',
    familyGroups: 'family_groups',
    members: 'members',
    employees: 'employees',
    handicaps: 'handicaps',
};
export const SYSTEM_ACTOR_UID = 'system';
export const DEFAULT_PRIMARY_ROLE_ID = 'socio';
export const STAFF_ROLE_IDS = ['directivo', 'administrativo'];
export const CLAIM_ROLE_IDS = ['directivo', 'administrativo', 'empleado', 'socio'];
export const PRIMARY_ROLE_PRECEDENCE = ['directivo', 'administrativo', 'empleado', 'socio'];
export const MAX_LICENSE_MONTHS = 6;
export const MAX_FAMILY_GROUP_SIZE = 99;
export const MEMBER_TYPE_IDS = {
    pleno: 'pleno',
    vitalicio: 'vitalicio',
    menor: 'menor',
    licencia: 'licencia',
    grupoFamiliarAsociado: 'grupo_familiar_asociado',
    grupoFamiliarTitular: 'grupo_familiar_titular',
};
export const DEFAULT_ROLES = [
    {
        name: 'Directivo',
        description: 'Administra permisos, roles y decisiones sensibles del club.',
        permissionIds: ['users.roles.manage', 'users.members.manage', 'users.employees.manage', 'users.handicaps.manage'],
        system: true,
        active: true,
        sortOrder: 10,
    },
    {
        name: 'Administrativo',
        description: 'Opera altas, bajas y mantenimiento administrativo.',
        permissionIds: ['users.members.manage', 'users.employees.manage', 'users.handicaps.manage'],
        system: true,
        active: true,
        sortOrder: 20,
    },
    {
        name: 'Empleado',
        description: 'Rol operativo para personal del club.',
        permissionIds: [],
        system: true,
        active: true,
        sortOrder: 30,
    },
    {
        name: 'Socio',
        description: 'Rol base para usuarios vinculados a un socio.',
        permissionIds: [],
        system: true,
        active: true,
        sortOrder: 40,
    },
];
export const DEFAULT_PERMISSIONS = [
    {
        id: 'users.roles.manage',
        module: 'users',
        action: 'roles.manage',
        name: 'Gestionar roles',
        description: 'Permite asignar y revocar roles de usuario.',
        active: true,
    },
    {
        id: 'users.members.manage',
        module: 'users',
        action: 'members.manage',
        name: 'Gestionar socios',
        description: 'Permite crear y modificar socios, grupos familiares y licencias.',
        active: true,
    },
    {
        id: 'users.employees.manage',
        module: 'users',
        action: 'employees.manage',
        name: 'Gestionar empleados',
        description: 'Permite crear y modificar empleados.',
        active: true,
    },
    {
        id: 'users.handicaps.manage',
        module: 'users',
        action: 'handicaps.manage',
        name: 'Gestionar handicap',
        description: 'Permite registrar y administrar handicap de socios.',
        active: true,
    },
];
export const DEFAULT_ROLE_PERMISSIONS = [
    {
        id: 'directivo__users.roles.manage',
        roleId: 'directivo',
        permissionId: 'users.roles.manage',
        active: true,
        grantedByUid: SYSTEM_ACTOR_UID,
        grantedAt: null,
    },
    {
        id: 'directivo__users.members.manage',
        roleId: 'directivo',
        permissionId: 'users.members.manage',
        active: true,
        grantedByUid: SYSTEM_ACTOR_UID,
        grantedAt: null,
    },
    {
        id: 'directivo__users.employees.manage',
        roleId: 'directivo',
        permissionId: 'users.employees.manage',
        active: true,
        grantedByUid: SYSTEM_ACTOR_UID,
        grantedAt: null,
    },
    {
        id: 'directivo__users.handicaps.manage',
        roleId: 'directivo',
        permissionId: 'users.handicaps.manage',
        active: true,
        grantedByUid: SYSTEM_ACTOR_UID,
        grantedAt: null,
    },
    {
        id: 'administrativo__users.members.manage',
        roleId: 'administrativo',
        permissionId: 'users.members.manage',
        active: true,
        grantedByUid: SYSTEM_ACTOR_UID,
        grantedAt: null,
    },
    {
        id: 'administrativo__users.employees.manage',
        roleId: 'administrativo',
        permissionId: 'users.employees.manage',
        active: true,
        grantedByUid: SYSTEM_ACTOR_UID,
        grantedAt: null,
    },
    {
        id: 'administrativo__users.handicaps.manage',
        roleId: 'administrativo',
        permissionId: 'users.handicaps.manage',
        active: true,
        grantedByUid: SYSTEM_ACTOR_UID,
        grantedAt: null,
    },
];
export const DEFAULT_MEMBER_TYPES = [
    {
        id: MEMBER_TYPE_IDS.pleno,
        label: 'Pleno',
        billingConfigKey: 'FULL',
        requiresFamilyGroup: false,
        canBeFamilyHolder: true,
        active: true,
        sortOrder: 10,
    },
    {
        id: MEMBER_TYPE_IDS.vitalicio,
        label: 'Vitalicio',
        billingConfigKey: 'LIFETIME',
        requiresFamilyGroup: false,
        canBeFamilyHolder: true,
        active: true,
        sortOrder: 20,
    },
    {
        id: MEMBER_TYPE_IDS.menor,
        label: 'Menor',
        billingConfigKey: 'MINOR',
        requiresFamilyGroup: false,
        canBeFamilyHolder: false,
        active: true,
        sortOrder: 30,
    },
    {
        id: MEMBER_TYPE_IDS.licencia,
        label: 'Licencia',
        billingConfigKey: 'LICENSE',
        requiresFamilyGroup: false,
        canBeFamilyHolder: false,
        active: true,
        sortOrder: 40,
    },
    {
        id: MEMBER_TYPE_IDS.grupoFamiliarAsociado,
        label: 'Grupo Familiar Asociado',
        billingConfigKey: 'FAMILY_ASSOC',
        requiresFamilyGroup: true,
        canBeFamilyHolder: false,
        active: true,
        sortOrder: 50,
    },
    {
        id: MEMBER_TYPE_IDS.grupoFamiliarTitular,
        label: 'Grupo Familiar Titular',
        billingConfigKey: 'FULL',
        requiresFamilyGroup: true,
        canBeFamilyHolder: true,
        active: true,
        sortOrder: 60,
    },
];
//# sourceMappingURL=constants.js.map