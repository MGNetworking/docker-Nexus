#!/usr/bin/env bash
# Restaure une archive tar.gz dans le volume Docker Nexus (nexus-data).
# ATTENTION: écrase le contenu actuel du volume.
#
# Usage:
#   ./scripts/restore_nexus_volume.sh [VOLUME_NAME] <ARCHIVE_PATH>
# Exemple:
#   ./scripts/restore_nexus_volume.sh nexus-data ./backup/nexus-data_20251217_101500.tar.gz

set -euo pipefail

VOLUME_NAME="${1:-nexus-data}"
ARCHIVE_PATH="${2:?Archive manquante (ex: ./backup/nexus-data_YYYYMMDD_HHMMSS.tar.gz)}"

command -v docker >/dev/null 2>&1 || { echo "ERREUR: docker introuvable."; exit 1; }

if [[ ! -f "${ARCHIVE_PATH}" ]]; then
  echo "ERREUR: archive introuvable: ${ARCHIVE_PATH}"
  exit 1
fi

if ! docker volume inspect "${VOLUME_NAME}" >/dev/null 2>&1; then
  echo "ERREUR: le volume '${VOLUME_NAME}' n'existe pas."
  docker volume ls
  exit 1
fi

echo "Arrêt de Nexus (obligatoire pour restauration) ..."
docker compose down

echo "Nettoyage du volume '${VOLUME_NAME}' ..."
docker run --rm -v "${VOLUME_NAME}:/data" alpine sh -c "rm -rf /data/*"

echo "Restauration depuis '${ARCHIVE_PATH}' vers le volume '${VOLUME_NAME}' ..."
# On monte le dossier de l'archive dans /backup pour éviter les problèmes de chemins relatifs.
ARCHIVE_DIR="$(cd "$(dirname "${ARCHIVE_PATH}")" && pwd)"
ARCHIVE_FILE="$(basename "${ARCHIVE_PATH}")"

docker run --rm \
  -v "${VOLUME_NAME}:/data" \
  -v "${ARCHIVE_DIR}:/backup:ro" \
  alpine sh -c "tar -xzf /backup/${ARCHIVE_FILE} -C /data"

echo "OK: restauration terminée."
echo "Relance Nexus :"
echo "  docker compose up -d"
echo "Puis vérifiez :"
echo "  docker compose logs -f"
