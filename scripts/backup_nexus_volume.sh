#!/usr/bin/env bash
# Backup du volume Docker Nexus (nexus-data) vers une archive tar.gz sur l'hôte.
# Usage:
#   ./scripts/backup_nexus_volume.sh [VOLUME_NAME] [BACKUP_DIR]
# Exemple:
#   ./scripts/backup_nexus_volume.sh nexus-data ./backup
#
# Variables (facultatives) :
#   GZIP_LEVEL  niveau de compression, 1 (rapide, défaut) à 9. Les blobs de Nexus (images Docker, jars) sont déjà
#               compressés : un niveau élevé coûte beaucoup de temps pour un gain presque nul.
#   BACKUP_UID, BACKUP_GID  propriétaire de l'archive (défaut : l'utilisateur qui lance le script).
#
# Déroulement, dans cet ordre :
#   1. vérifie que le volume existe ;
#   2. arrête Nexus (docker compose down) et contrôle qu'AUCUN conteneur n'utilise encore le volume (un Nexus lancé hors
#      de ce dossier ne serait pas arrêté, et la sauvegarde à chaud serait incohérente) ;
#   3. affiche la taille du volume, puis écrit l'archive en affichant l'avancement toutes les 15 secondes ;
#   4. renomme l'archive et en donne la propriété à l'utilisateur qui lance le script.
# Nexus n'est PAS relancé : docker compose up -d.
#
# L'archive est écrite sous le nom *.partial puis renommée à la fin : une sauvegarde interrompue (Ctrl-C, erreur) ne
# laisse jamais un fichier .tar.gz incomplet qui ressemblerait à une sauvegarde valide. Dans ce cas le script supprime
# le .partial et arrête son conteneur ; si le processus est tué brutalement (kill -9, coupure), un .partial peut rester :
# il est sans danger (jamais pris pour une sauvegarde) et peut être supprimé à la main.

set -euo pipefail

VOLUME_NAME="${1:-nexus-data}"
BACKUP_DIR="${2:-./backup}"
GZIP_LEVEL="${GZIP_LEVEL:-1}"
OWNER="${BACKUP_UID:-$(id -u)}:${BACKUP_GID:-$(id -g)}"

TS="$(date +%Y%m%d_%H%M%S)"
ARCHIVE_NAME="nexus-data_${TS}.tar.gz"
CONTAINER="nexus-backup-${TS}"

command -v docker >/dev/null 2>&1 || { echo "ERREUR: docker introuvable."; exit 1; }

if ! docker volume inspect "${VOLUME_NAME}" >/dev/null 2>&1; then
  echo "ERREUR: le volume '${VOLUME_NAME}' n'existe pas."
  echo "Volumes disponibles:"
  docker volume ls
  exit 1
fi

mkdir -p "${BACKUP_DIR}"
ABS_BACKUP_DIR="$(cd "${BACKUP_DIR}" && pwd)"
PARTIAL="${ABS_BACKUP_DIR}/${ARCHIVE_NAME}.partial"
PROGRESS_PID=""

cleanup() {
  local rc=$?
  [[ -n "${PROGRESS_PID}" ]] && kill "${PROGRESS_PID}" 2>/dev/null || true
  # Si la sauvegarde tourne encore (Ctrl-C), on arrête son conteneur : sinon il continuerait à écrire.
  docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
  if [[ ${rc} -ne 0 ]]; then
    rm -f "${PARTIAL}" 2>/dev/null || true
    echo "" >&2
    echo "Sauvegarde interrompue ou en échec : l'archive incomplète a été supprimée." >&2
    echo "Nexus reste arrêté. Relance : docker compose up -d" >&2
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

echo "Arrêt de Nexus (obligatoire pour un backup cohérent) ..."
docker compose down

# 'docker compose down' ne s'applique qu'au projet de ce dossier : si Nexus a été lancé autrement (autre dossier,
# autre nom de projet), il tourne encore. On vérifie donc qu'AUCUN conteneur n'utilise le volume.
STILL_RUNNING="$(docker ps -q --filter "volume=${VOLUME_NAME}")"
if [[ -n "${STILL_RUNNING}" ]]; then
  echo "ERREUR: des conteneurs en cours d'exécution utilisent encore le volume '${VOLUME_NAME}' :" >&2
  docker ps --filter "volume=${VOLUME_NAME}" --format '  {{.Names}}  ({{.Status}}, projet compose : {{.Label "com.docker.compose.project"}})' >&2
  echo "Arrête-les (docker stop <nom>) puis relance : une sauvegarde à chaud serait incohérente." >&2
  exit 1
fi

SIZE="$(docker run --rm -v "${VOLUME_NAME}:/data:ro" alpine du -sh /data 2>/dev/null | cut -f1 || true)"
echo "Sauvegarde du volume '${VOLUME_NAME}' (${SIZE:-taille inconnue}) vers '${BACKUP_DIR}/${ARCHIVE_NAME}' ..."
echo "Compression niveau ${GZIP_LEVEL} : plusieurs minutes pour plusieurs Go. Ctrl-C annule proprement."

# Suivi de la taille écrite, toutes les 15 secondes.
( while sleep 15; do
    printf '  ... %s écrits\n' "$(du -h "${PARTIAL}" 2>/dev/null | cut -f1)"
  done ) &
PROGRESS_PID=$!

# En arrière-plan pour pouvoir réagir à Ctrl-C ; 'pipefail' pour qu'une erreur de tar fasse échouer la sauvegarde.
docker run --rm --name "${CONTAINER}" \
  -v "${VOLUME_NAME}:/data:ro" \
  -v "${ABS_BACKUP_DIR}:/backup" \
  alpine sh -c "
    set -eo pipefail
    tar -cf - -C /data . | gzip -${GZIP_LEVEL} > /backup/${ARCHIVE_NAME}.partial
    mv /backup/${ARCHIVE_NAME}.partial /backup/${ARCHIVE_NAME}
    chown ${OWNER} /backup/${ARCHIVE_NAME}
  " &
wait $!

kill "${PROGRESS_PID}" 2>/dev/null || true
PROGRESS_PID=""

echo "OK: backup créé: ${BACKUP_DIR}/${ARCHIVE_NAME} ($(du -h "${ABS_BACKUP_DIR}/${ARCHIVE_NAME}" | cut -f1))"
echo "Note: Nexus est arrêté. Relance manuelle:"
echo "  docker compose up -d"
