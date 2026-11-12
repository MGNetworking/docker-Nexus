#!/usr/bin/env bash
# Restaure une archive tar.gz dans le volume Docker Nexus (nexus-data).
# ATTENTION: écrase le contenu actuel du volume.
#
# Usage:
#   ./scripts/restore_nexus_volume.sh [VOLUME_NAME] <ARCHIVE_PATH>
# Exemple:
#   ./scripts/restore_nexus_volume.sh nexus-data ./backup/nexus-data_20251217_101500.tar.gz
#
# Déroulement, dans cet ordre :
#   1. vérifie l'intégrité de l'archive (gzip -t), AVANT de toucher à quoi que ce soit : une archive tronquée
#      (sauvegarde interrompue) est refusée et le volume reste intact ;
#   2. vérifie que le volume existe ;
#   3. arrête Nexus (docker compose down) et contrôle qu'AUCUN conteneur n'utilise encore le volume ;
#   4. vide entièrement le volume (fichiers cachés compris), puis extrait l'archive dedans.
# Nexus n'est PAS relancé : docker compose up -d, puis docker compose logs -f.
#
# Variable : SKIP_VERIFY=1 ignore la vérification de l'étape 1 (déconseillé).

set -euo pipefail

VOLUME_NAME="${1:-nexus-data}"
ARCHIVE_PATH="${2:?Archive manquante (ex: ./backup/nexus-data_YYYYMMDD_HHMMSS.tar.gz)}"

command -v docker >/dev/null 2>&1 || { echo "ERREUR: docker introuvable."; exit 1; }

if [[ ! -f "${ARCHIVE_PATH}" ]]; then
  echo "ERREUR: archive introuvable: ${ARCHIVE_PATH}"
  exit 1
fi

# Vérifié AVANT d'arrêter Nexus et de vider le volume : restaurer une archive tronquée (sauvegarde interrompue)
# détruirait les données actuelles sans rien pouvoir remettre à la place. SKIP_VERIFY=1 pour ignorer (déconseillé).
if [[ "${SKIP_VERIFY:-0}" != "1" ]]; then
  echo "Vérification de l'intégrité de l'archive (gzip -t) ..."
  if ! gzip -t "${ARCHIVE_PATH}" 2>/dev/null; then
    echo "ERREUR: l'archive est corrompue ou incomplète (sauvegarde interrompue ?) : ${ARCHIVE_PATH}"
    echo "Rien n'a été modifié : Nexus tourne toujours et le volume est intact. Choisis une autre archive."
    exit 1
  fi
fi

if ! docker volume inspect "${VOLUME_NAME}" >/dev/null 2>&1; then
  echo "ERREUR: le volume '${VOLUME_NAME}' n'existe pas."
  docker volume ls
  exit 1
fi

echo "Arrêt de Nexus (obligatoire pour restauration) ..."
docker compose down

# 'docker compose down' ne s'applique qu'au projet de ce dossier : un Nexus lancé autrement tourne encore, et vider
# le volume sous ses pieds le corromprait. On vérifie donc qu'AUCUN conteneur n'utilise le volume.
STILL_RUNNING="$(docker ps -q --filter "volume=${VOLUME_NAME}")"
if [[ -n "${STILL_RUNNING}" ]]; then
  echo "ERREUR: des conteneurs en cours d'exécution utilisent encore le volume '${VOLUME_NAME}' :" >&2
  docker ps --filter "volume=${VOLUME_NAME}" --format '  {{.Names}}  ({{.Status}}, projet compose : {{.Label "com.docker.compose.project"}})' >&2
  echo "Arrête-les (docker stop <nom>) puis relance. Le volume n'a pas été modifié." >&2
  exit 1
fi

echo "Nettoyage du volume '${VOLUME_NAME}' ..."
docker run --rm -v "${VOLUME_NAME}:/data" alpine sh -c "find /data -mindepth 1 -delete"

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
