#!/usr/bin/env bash
# Backup du volume Docker Nexus (nexus-data) vers une archive tar.gz sur l'hôte.
# Usage:
#   ./scripts/backup_nexus_volume.sh [VOLUME_NAME] [BACKUP_DIR]
# Exemple:
#   ./scripts/backup_nexus_volume.sh nexus-data ./backup

set -euo pipefail

VOLUME_NAME="${1:-nexus-data}"
BACKUP_DIR="${2:-./backup}"

TS="$(date +%Y%m%d_%H%M%S)"
ARCHIVE_NAME="nexus-data_${TS}.tar.gz"

command -v docker >/dev/null 2>&1 || { echo "ERREUR: docker introuvable."; exit 1; }

if ! docker volume inspect "${VOLUME_NAME}" >/dev/null 2>&1; then
  echo "ERREUR: le volume '${VOLUME_NAME}' n'existe pas."
  echo "Volumes disponibles:"
  docker volume ls
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

echo "Arrêt de Nexus (obligatoire pour un backup cohérent) ..."
docker compose down

echo "Sauvegarde du volume '${VOLUME_NAME}' vers '${BACKUP_DIR}/${ARCHIVE_NAME}' ..."
docker run --rm \
  -v "${VOLUME_NAME}:/data:ro" \
  -v "$(pwd)/${BACKUP_DIR#./}:/backup" \
  alpine sh -c "tar -czf /backup/${ARCHIVE_NAME} -C /data ."

echo "OK: backup créé: ${BACKUP_DIR}/${ARCHIVE_NAME}"
echo "Note: Nexus est arrêté. Relance manuelle:"
echo "  docker compose up -d"
