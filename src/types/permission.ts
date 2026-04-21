// Coleccion Firestore sugerida: permissions
import type { id_type, timestamp_type } from './common';

export type permission_type = {
  // ID del documento del permiso
  id: id_type;

  // Codigo tecnico unico del permiso
  codigo: string;

  // Nombre legible del permiso
  nombre: string;

  // Explicacion del alcance del permiso
  descripcion: string;

  // Modulo funcional al que pertenece
  modulo: string;

  // Define si el permiso puede seguir utilizandose
  activo: boolean;

  // Fecha de creacion
  created_at: timestamp_type;

  // Fecha de ultima modificacion
  updated_at: timestamp_type;
};
